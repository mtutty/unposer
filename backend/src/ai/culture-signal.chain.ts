import { z } from 'zod';
import { structuredCall } from './llm';
import { CvfQuadrant } from '../types';

// Personality engine (docs/personality-analysis-engine-spec.md §7, tracked in
// docs/personality-engine-implementation-plan.md Iteration 7). Competing Values Framework
// quadrant mapping from Q0 (what gets rewarded), Q15 (deal-breakers — cultures rejected), and Q21
// (job description gap — espoused vs. enacted culture) — a free second data stream about the
// candidate's *former employer's culture*, deliberately never blended into personality dimension
// scores (spec §7's own explicit methodology warning).

const cultureSignalSchema = z.object({
  signals: z.array(
    z.object({
      quadrant: z.enum(['hierarchy', 'adhocracy', 'clan', 'market']),
      reasoning: z.string().describe('One sentence: what in the answer(s) points to this quadrant.'),
      sourceExchangeIds: z.array(z.string()).describe('Which of the provided exchange ids this signal is drawn from — must be real ids, never invented.')
    })
  )
});

export interface CultureSignalSourceInput {
  exchangeId: string;
  questionId: string;
  text: string;
}

export interface CultureSignalResult {
  quadrant: CvfQuadrant;
  reasoning: string;
  sourceExchangeIds: string[];
}

/**
 * One LLM call over whichever of Q0/Q15/Q21 the candidate has actually answered — not all three
 * are required (a candidate may have only reached Q0 so far). Returns zero, one, or several
 * signals: a candidate's answers can legitimately point to more than one quadrant (e.g. Q0
 * rewards technical mastery — Hierarchy — while Q15's deal-breaker was about rigid process —
 * pushing against Hierarchy specifically), which is why `culture_signal` is a table, not a single
 * column.
 */
export async function inferCultureSignals(sources: CultureSignalSourceInput[]): Promise<CultureSignalResult[]> {
  if (sources.length === 0) return [];

  const system = [
    'You read a candidate\'s answers about their current/former workplace and map what they ' +
      'describe onto the Competing Values Framework — NOT the candidate\'s own personality, the ' +
      "employer's culture as they experienced it. This is environmental data, never a trait " +
      'inference about the candidate.',
    '',
    'QUADRANTS:',
    '- hierarchy: rewards technical excellence, process mastery, doing things the correct way',
    '- adhocracy: rewards innovation, risk-taking, new ideas',
    '- clan: rewards team-building, mentorship, relationships',
    '- market: rewards results, wins, numbers, competitive performance',
    '',
    'Emit one signal per distinct quadrant genuinely supported by the material — do not force a ' +
      'signal for every quadrant, and do not emit more than one signal for the same quadrant. ' +
      'Every signal must cite at least one real exchange id from the list below.'
  ].join('\n');

  const human = sources.map((s) => `[${s.exchangeId}] (${s.questionId}) "${s.text}"`).join('\n\n');

  const result = await structuredCall(cultureSignalSchema, system, human, 0.3);

  const validIds = new Set(sources.map((s) => s.exchangeId));
  const seenQuadrants = new Set<CvfQuadrant>();

  return result.signals
    .map((s) => ({
      quadrant: s.quadrant as CvfQuadrant,
      reasoning: s.reasoning,
      sourceExchangeIds: s.sourceExchangeIds.filter((id) => validIds.has(id))
    }))
    .filter((s) => {
      // Defensive de-dup on top of the prompt instruction — a repeated quadrant would just
      // overwrite the same conceptual signal, not add information.
      if (s.sourceExchangeIds.length === 0 || seenQuadrants.has(s.quadrant)) return false;
      seenQuadrants.add(s.quadrant);
      return true;
    });
}
