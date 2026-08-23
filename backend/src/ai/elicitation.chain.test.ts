jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { runElicitationTurn } from './elicitation.chain';

const mockStructuredCall = structuredCall as jest.Mock;

function baseParams(overrides: Partial<Parameters<typeof runElicitationTurn>[0]> = {}) {
  return {
    stepName: 'logistics',
    completionCriteria: 'All core fields gathered',
    conversationStarters: ['What are you hoping for in your next role?'],
    channel: 'app' as const,
    history: [],
    knownData: {},
    ...overrides
  };
}

describe('runElicitationTurn', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
    mockStructuredCall.mockResolvedValue({ reply: 'Got it, thanks!', extracted: '{}', complete: false });
  });

  it('opens with an instruction to ask the opening question when history is empty', async () => {
    await runElicitationTurn(baseParams());

    const [, , human] = mockStructuredCall.mock.calls[0];
    expect(human).toMatch(/start of the conversation/i);
  });

  it('renders prior history as a Candidate/You transcript when present', async () => {
    await runElicitationTurn(
      baseParams({ history: [{ role: 'user', content: 'I want more autonomy' }, { role: 'assistant', content: 'Got it.' }] })
    );

    const [, , human] = mockStructuredCall.mock.calls[0];
    expect(human).toBe('Candidate: I want more autonomy\nYou: Got it.');
  });

  it('frames an email channel as async and app as live', async () => {
    await runElicitationTurn(baseParams({ channel: 'email' }));
    const [, emailSystem] = mockStructuredCall.mock.calls[0];
    expect(emailSystem).toMatch(/do not.*rush/i);
    expect(emailSystem).not.toMatch(/live chat/i);

    mockStructuredCall.mockClear();
    await runElicitationTurn(baseParams({ channel: 'app' }));
    const [, appSystem] = mockStructuredCall.mock.calls[0];
    expect(appSystem).toMatch(/live chat/i);
  });

  it('omits the extractionAreas guidance block entirely when none are given', async () => {
    await runElicitationTurn(baseParams());
    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).not.toMatch(/Use exactly these keys/);
  });

  it('steers toward exact extractionAreas keys when provided', async () => {
    await runElicitationTurn(
      baseParams({
        extractionAreas: [{ id: 'target_role', description: 'the role they want next' } as any]
      })
    );
    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).toMatch(/Use exactly these keys/);
    expect(system).toContain('"target_role" (the role they want next)');
  });

  it('includes already-known data so the model does not re-ask for it', async () => {
    await runElicitationTurn(baseParams({ knownData: { targetRole: 'staff engineer' } }));
    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).toContain('"targetRole":"staff engineer"');
  });

  it('parses a valid extracted JSON string into an object', async () => {
    mockStructuredCall.mockResolvedValue({ reply: 'ok', extracted: '{"targetRole":"staff engineer"}', complete: false });

    const result = await runElicitationTurn(baseParams());

    expect(result.extracted).toEqual({ targetRole: 'staff engineer' });
  });

  it('falls back to an empty object when the model returns malformed JSON in extracted', async () => {
    mockStructuredCall.mockResolvedValue({ reply: 'ok', extracted: 'not valid json{', complete: false });

    const result = await runElicitationTurn(baseParams());

    expect(result.extracted).toEqual({});
  });

  it('passes complete through unchanged', async () => {
    mockStructuredCall.mockResolvedValue({ reply: 'All set!', extracted: '{}', complete: true });

    const result = await runElicitationTurn(baseParams());

    expect(result.complete).toBe(true);
    expect(result.reply).toBe('All set!');
  });
});
