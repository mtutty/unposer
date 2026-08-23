jest.mock('./llm', () => ({
  resolveToolCall: jest.fn(),
  streamWithTemperatureFallback: jest.fn(),
  structuredCall: jest.fn()
}));

const mockEvidenceToolInvoke = jest.fn();
const mockBuildEvidenceSearchTool = jest.fn((_userId: string, _audience: 'candidate' | 'recruiter') => ({
  invoke: mockEvidenceToolInvoke
}));
jest.mock('./evidence-search.tool', () => ({
  buildEvidenceSearchTool: mockBuildEvidenceSearchTool
}));

import { resolveToolCall, streamWithTemperatureFallback, structuredCall } from './llm';
import { streamSandboxChat, runSandboxChat, identifySandboxCitations, SandboxChatParams } from './sandbox-chat.chain';
import { AppError } from '../types';

const mockResolveToolCall = resolveToolCall as jest.Mock;
const mockStreamWithTemperatureFallback = streamWithTemperatureFallback as jest.Mock;
const mockStructuredCall = structuredCall as jest.Mock;

function profileFixture(): any {
  return {
    headline: 'Product-minded engineer',
    summary: 'Summary',
    workHistory: [],
    insights: [],
    workStyle: {},
    goals: {},
    preferences: {},
    starStories: []
  };
}

function baseParams(overrides: Partial<SandboxChatParams> = {}): SandboxChatParams {
  return {
    profile: profileFixture(),
    history: [],
    question: 'Tell me about yourself.',
    userId: 'u1',
    ...overrides
  };
}

// Drains an async generator into a flat array, so `for await` output is easy to assert on.
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

async function* chunksOf(parts: string[]) {
  for (const p of parts) yield p;
}

describe('streamSandboxChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveToolCall.mockResolvedValue({ tool_calls: [] });
    mockStreamWithTemperatureFallback.mockReturnValue(chunksOf(['Hello!']));
  });

  it('builds the evidence-search tool scoped to this userId and audience, defaulting audience to candidate', async () => {
    await drain(streamSandboxChat(baseParams()));

    expect(mockBuildEvidenceSearchTool).toHaveBeenCalledWith('u1', 'candidate');
  });

  it('omits the recruiter-only score/label guardrail from the system prompt for the candidate audience', async () => {
    await drain(streamSandboxChat(baseParams()));

    const [messages] = mockResolveToolCall.mock.calls[0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).not.toMatch(/never state a raw numeric score/);
  });

  it('adds the recruiter-only guardrail when audience is recruiter', async () => {
    await drain(streamSandboxChat(baseParams({ audience: 'recruiter' })));

    expect(mockBuildEvidenceSearchTool).toHaveBeenCalledWith('u1', 'recruiter');
    const [messages] = mockResolveToolCall.mock.calls[0];
    expect(messages[0].content).toMatch(/never state a raw numeric score/);
  });

  it('streams with the original messages unchanged when the model makes no tool call', async () => {
    const chunks = await drain(streamSandboxChat(baseParams()));

    expect(chunks).toEqual(['Hello!']);
    const [streamedMessages] = mockStreamWithTemperatureFallback.mock.calls[0];
    expect(streamedMessages[streamedMessages.length - 1]).toEqual({ role: 'human', content: 'Tell me about yourself.' });
    expect(mockEvidenceToolInvoke).not.toHaveBeenCalled();
  });

  it('invokes every tool call and folds the results in as extra context ahead of the question when the model asks for evidence', async () => {
    mockResolveToolCall.mockResolvedValue({
      tool_calls: [
        { name: 'search_candidate_evidence', args: { query: 'leadership' } },
        { name: 'search_candidate_evidence', args: { query: 'conflict' } }
      ]
    });
    mockEvidenceToolInvoke.mockResolvedValueOnce('evidence about leadership').mockResolvedValueOnce({ content: 'evidence about conflict' });

    await drain(streamSandboxChat(baseParams()));

    expect(mockEvidenceToolInvoke).toHaveBeenCalledTimes(2);
    const [streamedMessages] = mockStreamWithTemperatureFallback.mock.calls[0];
    const evidenceMsg = streamedMessages[streamedMessages.length - 2];
    expect(evidenceMsg.role).toBe('system');
    expect(evidenceMsg.content).toContain('evidence about leadership');
    expect(evidenceMsg.content).toContain('evidence about conflict');
    // The question itself still comes last, after the folded-in evidence.
    expect(streamedMessages[streamedMessages.length - 1]).toEqual({ role: 'human', content: 'Tell me about yourself.' });
  });

  it('wraps a failure from resolveToolCall in an AppError', async () => {
    mockResolveToolCall.mockRejectedValue(new Error('provider down'));

    await expect(drain(streamSandboxChat(baseParams()))).rejects.toBeInstanceOf(AppError);
  });

  it('wraps a failure from the stream itself in an AppError', async () => {
    mockStreamWithTemperatureFallback.mockImplementation(async function* () {
      throw new Error('stream died');
    });

    await expect(drain(streamSandboxChat(baseParams()))).rejects.toMatchObject({ code: 'LLM_ERROR', status: 502 });
  });
});

describe('runSandboxChat', () => {
  it('buffers every streamed chunk into one string', async () => {
    mockResolveToolCall.mockResolvedValue({ tool_calls: [] });
    mockStreamWithTemperatureFallback.mockReturnValue(chunksOf(['Hel', 'lo', ' there']));

    const result = await runSandboxChat(baseParams());

    expect(result).toBe('Hello there');
  });
});

describe('identifySandboxCitations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends the profile, question, and answer, and returns the citations as-is', async () => {
    mockStructuredCall.mockResolvedValue({ citations: [{ source: 'insight', label: 'Leadership', detail: 'Cited from insight X' }] });

    const result = await identifySandboxCitations({ ...baseParams(), answer: 'I led a rewrite once.' });

    expect(result).toEqual([{ source: 'insight', label: 'Leadership', detail: 'Cited from insight X' }]);
    const [, , human, temperature] = mockStructuredCall.mock.calls[0];
    expect(human).toContain('Tell me about yourself.');
    expect(human).toContain('I led a rewrite once.');
    expect(temperature).toBe(0.2);
  });
});
