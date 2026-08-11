import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { config } from '../config';
import { AppError } from '../types';

// Explicit floor for every call, regardless of provider — deliberately not left to each SDK's own
// per-model default table. @langchain/anthropic in particular only has entries for model names it
// ships knowing about (e.g. "claude-sonnet-4-5"); a name it doesn't recognize — like
// "claude-sonnet-5" (a real, current model — 128K max output per Anthropic's own docs, the library
// bundled with this repo just predates that name) — silently falls back to 4096. That's what
// caused profile-generator's `starStories` (the schema's last field) to keep going missing even
// after strict:true: the response was hitting that 4096-token ceiling mid-generation, not failing
// schema validation.
//
// 16384 rather than the full 128K: it's what @langchain/anthropic's own table already uses as the
// default for every other Claude 5-family model (opus-5, fable-5, ...) — sonnet-5 is presumably
// the same tier in everything but name — and it comfortably clears the largest payload in this app
// (the full candidate profile) with room to spare. Not maxing out the ceiling isn't a cost concern
// (billing is by tokens actually produced, not the cap), it's a sane bound on how much a runaway
// generation could produce before something stops it.
const MAX_OUTPUT_TOKENS = 16384;

/**
 * Provider-agnostic chat model factory. LLM_PROVIDER/LLM_MODEL/LLM_API_KEY in .env select the
 * backing provider; every chain in this directory goes through here rather than instantiating a
 * provider SDK directly, per CLAUDE.md's "Provider Abstraction" principle.
 *
 * `temperature` is optional and omitted entirely (not sent as 0/undefined) when not given, so the
 * provider's own default applies — see withTemperatureFallback below for why that matters.
 */
export function getChatModel(temperature?: number): BaseChatModel {
  if (!config.llm.apiKey) {
    throw new AppError(
      'LLM_NOT_CONFIGURED',
      'No LLM_API_KEY is configured. Set it in .env to enable AI features.',
      503
    );
  }

  const options: Record<string, unknown> = {
    apiKey: config.llm.apiKey,
    model: config.llm.model,
    maxTokens: MAX_OUTPUT_TOKENS
  };
  if (temperature !== undefined) {
    options.temperature = temperature;
  }

  if (config.llm.provider === 'anthropic') {
    return new ChatAnthropic(options) as unknown as BaseChatModel;
  }

  return new ChatOpenAI(options) as unknown as BaseChatModel;
}

function isTemperatureUnsupportedError(error: any): boolean {
  const message: string = error?.message || '';
  return /temperature/i.test(message) && /(deprecated|unsupported|not supported|only supports)/i.test(message);
}

/**
 * Runs `attempt` at the requested temperature; if the provider rejects an explicit override
 * outright, retries once at its default rather than failing the whole request. Some newer
 * reasoning-unified models (e.g. Anthropic's Claude 5 family) do this instead of just clamping
 * the value, and which models do is a moving target we don't want to hardcode — this keeps every
 * chain working regardless of which model LLM_MODEL points at.
 */
async function withTemperatureFallback<T>(
  attempt: (temperature?: number) => Promise<T>,
  temperature: number
): Promise<T> {
  try {
    return await attempt(temperature);
  } catch (error: any) {
    if (isTemperatureUnsupportedError(error)) {
      console.warn(
        `[llm] ${config.llm.provider}/${config.llm.model} rejected temperature=${temperature}; retrying at provider default.`
      );
      return attempt(undefined);
    }
    throw error;
  }
}

/** Runs a schema-constrained call and wraps provider failures in an AppError the UI can surface. */
export async function structuredCall<T extends z.ZodTypeAny>(
  schema: T,
  systemPrompt: string,
  humanPrompt: string,
  temperature = 0.4
): Promise<z.infer<T>> {
  try {
    return await withTemperatureFallback(
      (t) =>
        getChatModel(t)
          // strict:true makes the provider itself enforce the schema (all fields, incl. nested
          // arrays, guaranteed present) instead of treating it as a loose hint the model can drop
          // fields from under its own token budget/attention — which is what caused
          // profile-generator's `starStories` to go missing on an otherwise well-formed response.
          .withStructuredOutput(schema, { strict: true })
          .invoke([
            { role: 'system', content: systemPrompt },
            { role: 'human', content: humanPrompt }
          ]) as Promise<z.infer<T>>,
      temperature
    );
  } catch (error: any) {
    throw new AppError('LLM_ERROR', `AI request failed: ${error.message || 'unknown error'}`, 502);
  }
}

/** Same fallback behavior as structuredCall, for chains that call the model directly (e.g. the
 *  free-text sandbox chat) instead of going through withStructuredOutput. */
export async function invokeWithTemperatureFallback(
  messages: Array<{ role: string; content: string }>,
  temperature: number
) {
  return withTemperatureFallback((t) => getChatModel(t).invoke(messages), temperature);
}

/** AIMessageChunk.content can be a plain string or an array of provider content blocks (Anthropic
 *  in particular may emit separate block types on one chunk) — this pulls out just the text, same
 *  normalization invokeWithTemperatureFallback's caller does in one shot for the non-streaming
 *  case, just applied per chunk here instead. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (typeof block === 'string' ? block : block?.type === 'text' ? block.text ?? '' : ''))
      .join('');
  }
  return '';
}

/**
 * Same fallback behavior as invokeWithTemperatureFallback, but yields text chunks as they stream
 * in rather than resolving once with the whole message. For every other chain in this app the AI
 * is doing most of the "thinking" work turn to turn, so a single non-streamed round trip is fine
 * — sandbox-chat is the one place the human holds the floor and just sits waiting on a reply, which
 * is exactly where streamed output earns its keep for perceived latency.
 *
 * The temperature-unsupported retry only covers the initial `.stream()` call, not a failure mid-
 * iteration: that class of error is a request-time parameter rejection, so it surfaces before any
 * chunk is produced, not after — matching withTemperatureFallback's assumption above.
 */
export async function* streamWithTemperatureFallback(
  messages: Array<{ role: string; content: string }>,
  temperature: number
): AsyncGenerator<string> {
  let stream;
  try {
    stream = await getChatModel(temperature).stream(messages);
  } catch (error: any) {
    if (isTemperatureUnsupportedError(error)) {
      console.warn(
        `[llm] ${config.llm.provider}/${config.llm.model} rejected temperature=${temperature}; retrying at provider default.`
      );
      stream = await getChatModel(undefined).stream(messages);
    } else {
      throw error;
    }
  }

  for await (const chunk of stream) {
    const text = extractText(chunk.content);
    if (text) yield text;
  }
}
