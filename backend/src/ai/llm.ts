import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { config } from '../config';
import { AppError } from '../types';

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
    model: config.llm.model
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
          .withStructuredOutput(schema)
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
