import { z } from 'zod';
import { structuredCall } from './llm';
import { DIMENSION_CONFIGS } from './dimension-scoring.chain';
import { DimensionKey, InsightType } from '../types';

// Personality engine (docs/personality-analysis-engine-spec.md §6, tracked in
// docs/personality-engine-implementation-plan.md Iteration 5). One LLM call, all eligible
// dimensions at once — the six insight types (Distinctiveness, Tension, Pattern,
// Context-dependence, Environment implication, Their own words) all draw on the *same* evidence
// set and need to be considered together to avoid overlap/redundancy across types, unlike
// dimension-scoring.chain.ts's one-dimension-at-a-time design.

const insightItemSchema = z.object({
  type: z.enum(['distinctiveness', 'tension', 'pattern', 'context_dependence', 'environment_implication', 'own_words']),
  text: z.string().describe('The insight itself — one or two sentences, never a bare score or trait label.'),
  supportingDimensions: z.array(z.string()).describe('Which of the provided dimension keys this insight draws on.'),
  supportingEvidenceIds: z
    .array(z.string())
    .describe('Evidence ids (from the provided list) this insight cites — must be real ids from the input, never invented.')
});

const insightGenerationSchema = z.object({
  insights: z.array(insightItemSchema)
});

export interface DimensionSummaryInput {
  dimension: DimensionKey;
  score: number;
  band: string;
  /** True only for dimensions whose current variance was classified topic_linked (spec §4.4) —
   *  the one condition that makes a context_dependence insight legitimate. Ambiguous/other
   *  dimensions are never passed as context-dependence-eligible (§9.9: suppress it when unclear). */
  contextDependenceEligible: boolean;
  evidence: Array<{ id: string; span: string; direction: 'low' | 'high'; note: string }>;
}

export interface InsightGenerationInput {
  dimensions: DimensionSummaryInput[];
}

export interface GeneratedInsight {
  type: InsightType;
  text: string;
  supportingDimensions: DimensionKey[];
  supportingEvidenceIds: string[];
}

// spec §6 "Tension" — the highest-value insight type. Candidate pairs, not a forced pairing: the
// model only surfaces one if the actual scores genuinely fit the pattern.
const TENSION_CANDIDATES: Array<[DimensionKey, DimensionKey, string]> = [
  ['motivation', 'dominance', 'High Motivation + low Dominance → drive without appetite for visibility'],
  ['openness', 'detail_orientation', 'High Openness + high Detail Orientation → wants novelty, insists on rigor'],
  ['work_style', 'agreeableness', 'High Collaboration preference (work_style) + low Agreeableness → wants to be in the room in order to argue'],
  ['conscientiousness', 'emotional_stability', 'High Conscientiousness + low Emotional Stability → the reliability is expensive to maintain']
];

/**
 * Generates up to 7 evidence-cited insights (spec §6) from a candidate's medium-confidence-or-
 * better dimensions. Callers (insight.service.ts) are responsible for the medium-confidence floor
 * — this chain trusts whatever dimensions it's given are eligible.
 */
export async function generateInsights(input: InsightGenerationInput): Promise<GeneratedInsight[]> {
  if (input.dimensions.length === 0) return [];

  const dimensionBlock = input.dimensions
    .map((d) => {
      const cfg = DIMENSION_CONFIGS[d.dimension];
      const spans = d.evidence.map((e) => `    - [${e.id}] ("${e.span}") — ${e.note}`).join('\n');
      return (
        `${d.dimension} (${cfg.name}): score ${d.score}/100 (0=${cfg.leftPole}, 100=${cfg.rightPole}), band ${d.band}` +
        (d.contextDependenceEligible ? ' — VARIES BY TOPIC (context-dependence eligible)' : '') +
        `\n  Evidence:\n${spans}`
      );
    })
    .join('\n\n');

  const eligibleKeys = new Set(input.dimensions.map((d) => d.dimension));
  const tensionLines = TENSION_CANDIDATES.filter(([a, b]) => eligibleKeys.has(a) && eligibleKeys.has(b))
    .map(([a, b, hint]) => `- ${a} + ${b}: ${hint}`)
    .join('\n');

  const system = [
    'You write insights about a candidate from their own scored personality dimensions and cited ' +
      'evidence spans (their own words). Never state a bare number, band, or trait label as the ' +
      'insight itself — every insight is a narrative sentence a person would recognize themselves in.',
    '',
    'SIX INSIGHT TYPES — use only the ones the data actually supports, never force all six:',
    '1. distinctiveness — where the person deviates most from the general population. There is no ' +
      'real population baseline yet (marked provisional in the product) — treat 50 as the ' +
      'population-average anchor for every dimension and speak only to genuinely large deviations ' +
      '(score below ~25 or above ~75), never small ones.',
    '2. tension — two of the provided dimensions whose combination is more interesting than either ' +
      'alone. Candidate pairs (use only if the actual scores fit; do not force a pairing that ' +
      "isn't really there):\n" + (tensionLines || '  (none of the candidate pairs are both eligible for this candidate)'),
    '3. pattern — a theme recurring across evidence from unrelated questions/dimensions.',
    '4. context_dependence — ONLY for a dimension explicitly marked "VARIES BY TOPIC" below. Never ' +
      'invent this for a dimension not marked that way.',
    '5. environment_implication — what kind of team/environment this profile tends to suit, framed ' +
      'as information for the person, never a verdict.',
    "6. own_words — the two or three spans you found most revealing, quoted verbatim, with why.",
    '',
    'RULES:',
    '- Every insight cites at least one real evidence id from the list below — never invent an id.',
    '- Cap at 5-7 insights total. Fewer is fine if the data does not support more; twenty ' +
      'observations reads as a horoscope.',
    '- Falsifiability test: if an insight would feel true to 80% of readers, cut it. ' +
      '"You value both independence and collaboration" is a Barnum statement and must not appear. ' +
      '"You describe collaboration as something you seek out specifically when you disagree" is not.',
    '- emotional_stability, if present, is NEVER described as a deficit or diagnosis — describe a ' +
      'low score in terms of what it costs (e.g. more sensitive to sustained pressure) and what it ' +
      "is good for (vigilance, quality-consciousness), exactly the way you'd describe a real trade-off.",
    '- Never infer anything from writing style, verbosity, or phrasing — only from what was ' +
      'actually said.'
  ].join('\n');

  const human = `Dimensions and their evidence:\n\n${dimensionBlock}`;

  const result = await structuredCall(insightGenerationSchema, system, human, 0.5);

  const validIds = new Set(input.dimensions.flatMap((d) => d.evidence.map((e) => e.id)));
  const validDimensions = eligibleKeys;

  return result.insights
    .map((i) => ({
      type: i.type as InsightType,
      text: i.text,
      // Defensive filtering — structuredCall's schema can't itself constrain these to the
      // provided sets (zod has no "must be one of these dynamic values" cross-field validator),
      // so a hallucinated id/dimension is dropped here rather than trusted.
      supportingDimensions: i.supportingDimensions.filter((d): d is DimensionKey => validDimensions.has(d as DimensionKey)),
      supportingEvidenceIds: i.supportingEvidenceIds.filter((id) => validIds.has(id))
    }))
    .filter((i) => i.supportingEvidenceIds.length > 0)
    .slice(0, 7);
}
