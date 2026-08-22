import { z } from 'zod';
import { structuredCall } from './llm';
import { DimensionKey } from '../types';

// Personality engine (docs/personality-analysis-engine-spec.md §4, tracked in
// docs/personality-engine-implementation-plan.md Iteration 2). One dimension-agnostic prompt
// template (spec §4.3), instantiated per dimension from DIMENSION_CONFIGS below rather than
// eleven near-duplicate chains. There was no pre-existing Emotional-Stability-only scoring pass
// to generalize from — checked ai/ and services/ (grep for "emotional stability" /
// "stress response"): profile-generator.chain.ts's insight `category` enum has a generic
// 'stress_response' bucket, but nothing resembling the §4.1 evidence-object shape (direction /
// strength / type / facet / confidence) exists anywhere in this codebase yet. This file is that
// pass, built fresh from the spec, for all 11 dimensions at once.

export interface DimensionConfig {
  key: DimensionKey;
  name: string;
  leftPole: string;
  rightPole: string;
  // Controlled facet vocabulary fed into the prompt so tagging is consistent enough to roll up
  // later (spec §9.1). The spec doesn't enumerate facet lists anywhere — these are drawn from the
  // closest established framework per dimension (Big Five facets where a dimension maps cleanly)
  // as a starting point, same kind of documented approximation as utils/occasion.ts's UTC
  // fallback. Expect to refine once real evidence data shows which facets actually get used.
  facets: string[];
}

export const DIMENSION_CONFIGS: Record<DimensionKey, DimensionConfig> = {
  emotional_stability: {
    key: 'emotional_stability',
    name: 'Emotional Stability / Adjustment',
    leftPole: 'Reactive, anxious, self-critical, stress-vulnerable',
    rightPole: 'Calm, resilient, even-tempered, unbothered',
    facets: ['anxiety', 'self_consciousness', 'vulnerability_to_stress', 'resilience', 'emotional_reactivity', 'composure_under_pressure']
  },
  social_energy: {
    key: 'social_energy',
    name: 'Social Energy / Extraversion',
    leftPole: 'Reserved, solitary, drained by group interaction',
    rightPole: 'Outgoing, gregarious, energized by people',
    facets: ['gregariousness', 'warmth', 'activity_level', 'excitement_seeking', 'solitude_preference']
  },
  dominance: {
    key: 'dominance',
    name: 'Dominance / Assertiveness / Ambition',
    leftPole: 'Deferential, accommodating, low status-seeking',
    rightPole: 'Directive, competitive, seeks authority',
    facets: ['assertiveness', 'competitiveness', 'status_seeking', 'directiveness', 'deference']
  },
  agreeableness: {
    key: 'agreeableness',
    name: 'Agreeableness / Interpersonal Orientation',
    leftPole: 'Skeptical, challenging, tough-minded',
    rightPole: 'Trusting, cooperative, accommodating',
    facets: ['trust', 'straightforwardness', 'compliance', 'skepticism', 'cooperation']
  },
  conscientiousness: {
    key: 'conscientiousness',
    name: 'Conscientiousness / Organization',
    leftPole: 'Spontaneous, flexible, improvisational',
    rightPole: 'Structured, disciplined, process-driven',
    facets: ['order', 'dutifulness', 'self_discipline', 'deliberation', 'spontaneity']
  },
  openness: {
    key: 'openness',
    name: 'Openness / Intellectual Curiosity',
    leftPole: 'Practical, conventional, proven-methods',
    rightPole: 'Curious, abstract, novelty-seeking',
    facets: ['ideas', 'novelty_seeking', 'aesthetics', 'unconventionality', 'practicality']
  },
  change_orientation: {
    key: 'change_orientation',
    name: 'Change Orientation / Risk Tolerance',
    leftPole: 'Stability-preferring, cautious, risk-averse',
    rightPole: 'Change-seeking, bold, comfortable with ambiguity',
    facets: ['risk_tolerance', 'ambiguity_tolerance', 'stability_preference', 'boldness']
  },
  thinking_style: {
    key: 'thinking_style',
    name: 'Thinking Style',
    leftPole: 'Intuitive, pattern-based, fast-judgment',
    rightPole: 'Analytical, evidence-first, systematic',
    facets: ['analytical_rigor', 'evidence_orientation', 'intuition', 'pattern_recognition', 'deliberateness']
  },
  detail_orientation: {
    key: 'detail_orientation',
    name: 'Detail Orientation',
    leftPole: 'Big-picture, directional, tolerant of rough edges',
    rightPole: 'Detail-precise, thorough, exacting',
    facets: ['precision', 'thoroughness', 'big_picture_focus', 'exactingness']
  },
  motivation: {
    key: 'motivation',
    name: 'Motivation & Achievement Drive',
    leftPole: 'Sufficiency-oriented, balance-seeking',
    rightPole: 'Achievement-driven, ambitious, restless',
    facets: ['achievement_drive', 'ambition', 'restlessness', 'sufficiency_orientation', 'balance_seeking']
  },
  work_style: {
    key: 'work_style',
    name: 'Work Style',
    leftPole: 'Independent, autonomous, single-owner',
    rightPole: 'Collaborative, consensus-oriented, team-embedded',
    facets: ['independence', 'collaboration_preference', 'consensus_orientation', 'single_ownership']
  }
};

const evidenceItemSchema = z.object({
  span: z.string().describe('The exact quoted span from the candidate answer this evidence is drawn from'),
  direction: z.enum(['low', 'high']).describe('Toward the 0 pole (low) or the 100 pole (high)'),
  strength: z.enum(['strong', 'moderate', 'weak']),
  type: z.enum(['explicit_statement', 'behavioral_report', 'attribution_pattern', 'linguistic_marker']),
  facet: z.string().describe('Which facet from the FACETS list this bears on'),
  note: z.string().describe('One clause explaining why this span counts as evidence')
});

const dimensionScoringSchema = z.object({
  evidence: z.array(evidenceItemSchema),
  // Null exactly when confidence is 'insufficient_signal' (spec §4.3 STEP 5) — a missing score is
  // recoverable, a confidently wrong one is not. Plain z.number(), no .int()/.min()/.max():
  // Anthropic's strict tool-use schema validation rejects min/max on a numeric property, and
  // empirically `.int()` alone triggers the same rejection (zod's JSON Schema conversion attaches
  // implicit safe-integer min/max to it) — same class of restriction as profile-generator.chain.ts's
  // array-minItems finding, see llm.ts's structuredCall comment. The 0-100 integer bound lives
  // only in the SCALE line of the prompt below; rounded to an int in code (see scoreDimension).
  provisional_score: z.number().nullable(),
  confidence: z.enum(['high', 'medium-high', 'medium', 'low', 'insufficient_signal']),
  reasoning: z.string()
});

export interface DimensionScoringInput {
  dimension: DimensionKey;
  questionText: string;
  answerText: string;
}

export interface DimensionEvidenceItem {
  span: string;
  direction: 'low' | 'high';
  strength: 'strong' | 'moderate' | 'weak';
  type: 'explicit_statement' | 'behavioral_report' | 'attribution_pattern' | 'linguistic_marker';
  facet: string;
  note: string;
}

export interface DimensionScoringResult {
  dimension: DimensionKey;
  evidence: DimensionEvidenceItem[];
  provisionalScore: number | null;
  confidence: 'high' | 'medium-high' | 'medium' | 'low' | 'insufficient_signal';
  reasoning: string;
}

/**
 * One LLM call per (question, answer, dimension) pair (spec §4.1) — extraction only, no
 * aggregation across answers (that's Iteration 4). Which dimensions to call this for, for a given
 * exchange, is a selection-layer decision (the question library's P/s coverage matrix — Iteration
 * 3); this function just scores whichever single dimension it's asked about.
 */
export async function scoreDimension(input: DimensionScoringInput): Promise<DimensionScoringResult> {
  const cfg = DIMENSION_CONFIGS[input.dimension];

  const system = [
    `DIMENSION: ${cfg.name}`,
    `SCALE: 0-100. 0 = ${cfg.leftPole}. 50 = balanced. 100 = ${cfg.rightPole}.`,
    `FACETS: ${cfg.facets.join(', ')}`,
    '',
    'Extract evidence from the candidate answer below. For each piece of evidence: quote the exact ' +
      'span, its direction (toward 0 / toward 100), strength (strong/moderate/weak), type ' +
      '(explicit_statement/behavioral_report/attribution_pattern/linguistic_marker), and which ' +
      'facet it bears on.',
    '',
    'STEP 1 — List all evidence. Do not score yet.',
    'STEP 2 — Weigh it. Explicit > behavioral > attribution > linguistic. Repeated themes outweigh single mentions.',
    'STEP 3 — Check for confounds. Is self-deprecation genuine insecurity or social lubricant? Is ' +
      'terseness a trait signal or just a writing style? Is this answer describing the candidate, ' +
      'or describing a former employer/team/manager rather than themselves?',
    'STEP 4 — Emit a provisional score with explicit reasoning.',
    'STEP 5 — Emit confidence: high / medium-high / medium / low. Return "insufficient_signal" ' +
      '(and no score) rather than guessing — a missing score is recoverable, a confidently wrong ' +
      'one is not.',
    '',
    'CONSTRAINTS:',
    '- Never infer from demographic, cultural, linguistic, or educational markers.',
    '- Non-native-English phrasing, brevity, and formality are not personality signals.',
    '- Anchor to 50 by default. Move toward the poles only on real evidence.',
    '- Neither pole is "good" or "bad" — never imply otherwise in your reasoning or evidence notes.'
  ].join('\n');

  const human = `Question asked: "${input.questionText}"\n\nCandidate's answer: "${input.answerText}"`;

  // Low temperature: this is an extraction/rubric-application pass, not a generative one — the
  // same reasoning as reask.chain.ts's use of structuredCall, just tuned lower for consistency
  // across repeated calls on similar answers.
  const result = await structuredCall(dimensionScoringSchema, system, human, 0.2);

  return {
    dimension: input.dimension,
    evidence: result.evidence,
    provisionalScore: result.provisional_score === null ? null : Math.round(result.provisional_score),
    confidence: result.confidence,
    reasoning: result.reasoning
  };
}
