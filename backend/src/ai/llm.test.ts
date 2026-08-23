// Guards the retry-on-temperature-rejection path (withTemperatureFallback, private but exercised
// through every exported wrapper) and resolveToolCall's tool-support guard. Worth having given
// this file's own documented history of silent breakage (see the MAX_OUTPUT_TOKENS comment) —
// previously untested despite that.

jest.mock('../config', () => ({
  config: { llm: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' } }
}));

const mockModel: any = {
  invoke: jest.fn(),
  bindTools: undefined as any
};

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => mockModel)
}));
jest.mock('@langchain/anthropic', () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => mockModel)
}));

import { z } from 'zod';
import { invokeWithTemperatureFallback, resolveToolCall, structuredCall } from './llm';
import { AppError } from '../types';
import { config } from '../config';

describe('invokeWithTemperatureFallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retries once at the provider default when an explicit temperature is rejected', async () => {
    mockModel.invoke
      .mockRejectedValueOnce(new Error('This model does not support the temperature parameter (deprecated).'))
      .mockResolvedValueOnce({ content: 'ok' });

    const result = await invokeWithTemperatureFallback([{ role: 'human', content: 'hi' }], 0.7);

    expect(result).toEqual({ content: 'ok' });
    expect(mockModel.invoke).toHaveBeenCalledTimes(2);
  });

  it('does not retry and rethrows on an unrelated failure', async () => {
    mockModel.invoke.mockRejectedValueOnce(new Error('network error'));

    await expect(invokeWithTemperatureFallback([{ role: 'human', content: 'hi' }], 0.7)).rejects.toThrow(
      'network error'
    );
    expect(mockModel.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('resolveToolCall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModel.bindTools = undefined;
  });

  it('throws a clear AppError when the configured model has no bindTools support', async () => {
    await expect(resolveToolCall([{ role: 'human', content: 'hi' }], [], 0.5)).rejects.toThrow(AppError);
  });

  it('invokes the tool-bound model and returns its response when bindTools is supported', async () => {
    const invoke = jest.fn().mockResolvedValue({ content: '', tool_calls: [] });
    mockModel.bindTools = jest.fn().mockReturnValue({ invoke });

    const result = await resolveToolCall([{ role: 'human', content: 'hi' }], [], 0.5);

    expect(result).toEqual({ content: '', tool_calls: [] });
    expect(mockModel.bindTools).toHaveBeenCalled();
  });
});

describe('structuredCall', () => {
  afterEach(() => {
    (config as any).llm.apiKey = 'test-key';
  });

  // getChatModel()'s own AppError('LLM_NOT_CONFIGURED', ..., 503) is thrown inside
  // withTemperatureFallback, itself inside structuredCall's try block — regression test for the
  // bug where its catch-all used to re-wrap that as a generic LLM_ERROR/502, losing the more
  // specific code/status every chain in ai/ relies on structuredCall for (see embeddings.test.ts
  // for the equivalent case in embeddings.ts, which had the same bug).
  it('passes an already-AppError failure (e.g. no LLM_API_KEY configured) through unwrapped', async () => {
    (config as any).llm.apiKey = '';

    await expect(structuredCall(z.object({ x: z.string() }), 'sys', 'human')).rejects.toMatchObject({
      code: 'LLM_NOT_CONFIGURED',
      status: 503
    });
  });

  it('still wraps a genuine provider failure as LLM_ERROR/502', async () => {
    mockModel.withStructuredOutput = jest.fn().mockReturnValue({ invoke: jest.fn().mockRejectedValue(new Error('boom')) });

    await expect(structuredCall(z.object({ x: z.string() }), 'sys', 'human')).rejects.toMatchObject({
      code: 'LLM_ERROR',
      status: 502
    });
  });
});
