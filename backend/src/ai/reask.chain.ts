import { z } from 'zod';
import { structuredCall } from './llm';

const reaskSchema = z.object({
  question: z
    .string()
    .describe('A single, specific follow-up question that re-probes the disputed area.')
});

/**
 * Step 6 correction path: rather than accepting an override, generate one targeted re-ask that
 * gets appended to the Step 5 deep-prompt thread. Preserves "don't just trust self-report" even
 * when the candidate is the one flagging the issue.
 */
export async function generateReaskQuestion(
  insightStatement: string,
  insightEvidence: string
): Promise<string> {
  const system =
    'A candidate has flagged an AI-inferred insight about themselves as "not accurate". Do not ' +
    'simply accept their correction — write one open-ended, narrative follow-up question (in the ' +
    'style of "tell me about a time...") that re-probes the same underlying area from a different ' +
    'angle, so a new story can confirm, refine, or overturn the original inference. Never ask them ' +
    'to rate or directly characterize themselves.';

  const human =
    `Flagged insight: "${insightStatement}"\n` +
    `Original evidence it was drawn from: "${insightEvidence}"\n\n` +
    'Write the re-ask question.';

  const result = await structuredCall(reaskSchema, system, human, 0.5);
  return result.question;
}
