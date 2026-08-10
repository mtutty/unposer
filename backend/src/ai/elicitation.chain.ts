import { z } from 'zod';
import { structuredCall } from './llm';
import { ElicitationTurnResult } from '../types';
import { InfoArea } from '../models/logistics-areas';

const turnSchema = z.object({
  reply: z.string().describe('Your next message to the candidate — one focused question or a warm closing note.'),
  extracted: z
    .string()
    .describe(
      'A JSON object, as a string, of any new fields you learned this turn (merge-friendly ' +
        'key/value pairs). Use "{}" if nothing new was learned.'
    ),
  complete: z.boolean().describe('True only once the completion criteria below are fully met.')
});

export interface ElicitationTurnParams {
  stepName: string;
  completionCriteria: string;
  conversationStarters: string[];
  channel: 'app' | 'email';
  /** Chat history so far, oldest first. Empty on the very first turn. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Known fields already extracted in prior turns, so the model doesn't re-ask for them. */
  knownData: Record<string, any>;
  /**
   * Named information areas this step is tracking (currently only logistics — see
   * models/logistics-areas.ts). When present, the model is steered toward these exact keys in
   * `extracted` instead of freely-named ones, so the frontend's per-area glyph tracker can
   * reliably tell what's been covered. Omitted entirely for steps without a fixed area list
   * (e.g. deep_prompts), which keeps `extracted` as freeform key/value learnings as before.
   */
  extractionAreas?: InfoArea[];
}

const SHARED_PRINCIPLES =
  'You never ask the candidate to rate, score, or characterize themselves on a scale — no ' +
  'Likert items, no forced-choice questions, no "on a scale of 1-10". If the step is inferential ' +
  '(personality, collaboration style), draw it out through open-ended, narrative "tell me about ' +
  'a time..." questions and let the candidate\'s own stories carry the signal. Ask one question ' +
  'at a time. Be warm, concise, and specific — react to what the candidate just told you rather ' +
  'than reciting a script.';

/**
 * Drives one turn of an adaptive conversation for a channel-agnostic step (logistics or deep
 * prompts). Same function whether the transcript arrived via live chat or an email reply —
 * there is no separate "email" code path, per spec Step 4.
 */
export async function runElicitationTurn(params: ElicitationTurnParams): Promise<ElicitationTurnResult> {
  const { stepName, completionCriteria, conversationStarters, channel, history, knownData, extractionAreas } = params;

  const system = [
    SHARED_PRINCIPLES,
    channel === 'email'
      ? 'This exchange is happening over email, at whatever pace the candidate wants — do not ' +
        'rush them or reference "chatting live".'
      : 'This exchange is a live chat — you may follow up immediately on anything ambiguous.',
    `Step: "${stepName}".`,
    `Completion criteria: ${completionCriteria}`,
    conversationStarters.length
      ? `Illustrative starting points (adapt freely, do not read verbatim): ${conversationStarters.join(' | ')}`
      : '',
    extractionAreas?.length
      ? 'Use exactly these keys in "extracted" when you learn the corresponding information — do ' +
        'not invent other key names for the same idea, and only set a key once you have a clear, ' +
        'specific answer (never a guess or placeholder): ' +
        extractionAreas.map((a) => `"${a.id}" (${a.description})`).join('; ') +
        '. You may still add other keys for anything relevant that falls outside this list.'
      : '',
    `Already known about the candidate for this step: ${JSON.stringify(knownData)}`
  ]
    .filter(Boolean)
    .join('\n\n');

  const human = history.length
    ? history.map((m) => `${m.role === 'user' ? 'Candidate' : 'You'}: ${m.content}`).join('\n')
    : 'This is the start of the conversation. Ask your opening question.';

  const result = await structuredCall(turnSchema, system, human, 0.5);

  let extracted: Record<string, any> = {};
  try {
    extracted = JSON.parse(result.extracted);
  } catch {
    extracted = {};
  }

  return { reply: result.reply, extracted, complete: result.complete };
}
