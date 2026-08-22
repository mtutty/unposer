import { Channel } from './flow.model';

// Mirrors backend/src/types/index.ts's personality-engine section (Iteration 1 scaffolding — see
// docs/personality-engine-implementation-plan.md). Nothing in frontend/ reads or writes these yet.

// The 11 continua from docs/personality-analysis-engine-spec.md §2.
export type DimensionKey =
  | 'emotional_stability'
  | 'social_energy'
  | 'dominance'
  | 'agreeableness'
  | 'conscientiousness'
  | 'openness'
  | 'change_orientation'
  | 'thinking_style'
  | 'detail_orientation'
  | 'motivation'
  | 'work_style';

export type ThreadCloseReason = 'user' | 'model';
export type TopicThreadStatus = 'open' | 'closed';

export interface TopicThread {
  id: string;
  question_id: string;
  opened_at: string;
  closed_at: string | null;
  closed_by: ThreadCloseReason | null;
  status: TopicThreadStatus;
}

export interface Exchange {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  text: string;
  sent_at: string;
  channel: Channel;
  occasion_id: string;
}

export type EvidenceDirection = 'low' | 'high';
export type EvidenceStrength = 'strong' | 'moderate' | 'weak';
export type EvidenceType =
  | 'explicit_statement'
  | 'behavioral_report'
  | 'attribution_pattern'
  | 'linguistic_marker';

export interface DimensionEvidence {
  id: string;
  exchange_id: string;
  dimension: DimensionKey;
  span: string;
  direction: EvidenceDirection;
  strength: EvidenceStrength;
  type: EvidenceType;
  facet: string | null;
  note: string | null;
}

export type ScoreConfidence = 'high' | 'medium-high' | 'medium' | 'low' | 'insufficient_signal';
export type ScoreBand = 'high' | 'medium-high' | 'medium' | 'suppressed';
export type ProgressionTier = 'none' | 'sketch' | 'core_persona' | 'in_depth' | 'ongoing';

export interface DimensionScore {
  id: string;
  dimension: DimensionKey;
  version: number;
  score: number | null;
  confidence: ScoreConfidence;
  band: ScoreBand | null;
  tier: ProgressionTier | null;
  contributing_evidence_ids: string[];
  distinct_questions: number;
  distinct_occasions: number;
  variance_pattern: 'topic_linked' | 'occasion_linked' | 'monotonic_drift' | 'ambiguous' | null;
  computed_at: string;
}

export type InsightType =
  | 'distinctiveness'
  | 'tension'
  | 'pattern'
  | 'context_dependence'
  | 'environment_implication'
  | 'own_words';

// Distinct from ProfileInsight in profile.model.ts, which is Step 6's narrative-profile shape.
export interface PersonalityInsight {
  id: string;
  type: InsightType;
  text: string;
  supporting_evidence_ids: string[];
  surfaced_to_user: boolean;
  surfaced_to_recruiter: boolean;
}

export type CvfQuadrant = 'hierarchy' | 'adhocracy' | 'clan' | 'market';

export interface CultureSignal {
  id: string;
  cvf_quadrant: CvfQuadrant;
  source_evidence_ids: string[];
}

export type PacePreference = 'whenever' | 'one_a_week' | 'all_now';

// Distinct from FlowProgress in flow.model.ts, which tracks the 6 onboarding steps.
export interface Progression {
  tier: ProgressionTier;
  dimensions_at_confidence: DimensionKey[];
  pace_preference: PacePreference;
  next_question_id: string | null;
  last_contact_at: string | null;
}

// GET /api/profile/progression's response shape (Iteration 5) — a computed summary, not the raw
// `progression` row above. Drives the persistent post-Sketch "answer one more question"
// affordance and the "based on one session so far" caveat (flow addendum §5) on the
// profile_review/sandbox pages.
export interface ProgressionSummary {
  tier: ProgressionTier;
  dimensionsAtConfidence: DimensionKey[];
  singleSessionDimensions: DimensionKey[];
}
