import { z } from 'zod';
import { structuredCall } from './llm';
import { CvfQuadrant } from '../types';

// Employer-side onboarding, Phase 2's CVF-quadrant decision (docs/employer-onboarding-spec.md
// §4, 2026-09-12). Reuses the same Competing Values Framework quadrant vocabulary and mapping
// table as culture-signal.chain.ts (spec's own docs/personality-analysis-engine-spec.md §7), but
// is its own chain rather than a shared function: the candidate-side prompt is explicit that it's
// reading *indirect* signal about a *former* employer, filtered through a candidate's own
// storytelling — the framing here is the opposite, an employer describing their *own current*
// team directly, and conflating the two prompts would blur a distinction worth keeping precise.

const cultureSignalSchema = z.object({
  signals: z.array(
    z.object({
      quadrant: z.enum(['hierarchy', 'adhocracy', 'clan', 'market']),
      reasoning: z.string().describe('One sentence: what in the answer(s) points to this quadrant.'),
      sourceMessageIds: z.array(z.string()).describe('Which of the provided message ids this signal is drawn from — must be real ids, never invented.')
    })
  )
});

export interface RequisitionCultureSignalSourceInput {
  messageId: string;
  text: string;
}

export interface RequisitionCultureSignalResult {
  quadrant: CvfQuadrant;
  reasoning: string;
  sourceMessageIds: string[];
}

/**
 * One LLM call over every employer message in a requisition's Q&A thread — not scoped to
 * particular questions the way the candidate side's Q0/Q15/Q21 sourcing is, since this is one
 * open elicitation conversation, not a question library. Returns zero, one, or several signals:
 * an employer's answers can legitimately point to more than one quadrant (e.g. rewarding
 * technical mastery — Hierarchy — while also describing fast, autonomous decision-making —
 * Adhocracy), which is why requisition_culture_signal is a table, not a single column.
 */
export async function inferRequisitionCultureSignals(sources: RequisitionCultureSignalSourceInput[]): Promise<RequisitionCultureSignalResult[]> {
  if (sources.length === 0) return [];

  const system = [
    "You read an employer's own direct answers describing their team's culture — not a " +
      "candidate's secondhand account of a past employer, this is the employer describing " +
      'themselves — and map what they describe onto the Competing Values Framework.',
    '',
    'QUADRANTS:',
    '- hierarchy: rewards technical excellence, process mastery, doing things the correct way',
    '- adhocracy: rewards innovation, risk-taking, new ideas',
    '- clan: rewards team-building, mentorship, relationships',
    '- market: rewards results, wins, numbers, competitive performance',
    '',
    'Emit one signal per distinct quadrant genuinely supported by the material — do not force a ' +
      'signal for every quadrant, and do not emit more than one signal for the same quadrant. ' +
      'Every signal must cite at least one real message id from the list below.'
  ].join('\n');

  const human = sources.map((s) => `[${s.messageId}] "${s.text}"`).join('\n\n');

  const result = await structuredCall(cultureSignalSchema, system, human, 0.3);

  const validIds = new Set(sources.map((s) => s.messageId));
  const seenQuadrants = new Set<CvfQuadrant>();

  return result.signals
    .map((s) => ({
      quadrant: s.quadrant as CvfQuadrant,
      reasoning: s.reasoning,
      sourceMessageIds: s.sourceMessageIds.filter((id) => validIds.has(id))
    }))
    .filter((s) => {
      // Defensive de-dup on top of the prompt instruction — a repeated quadrant would just
      // overwrite the same conceptual signal, not add information.
      if (s.sourceMessageIds.length === 0 || seenQuadrants.has(s.quadrant)) return false;
      seenQuadrants.add(s.quadrant);
      return true;
    });
}
