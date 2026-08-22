import { DimensionKey, ScoreConfidence } from '../types';

// The 11 dimensions (spec §2) and their confidence ordering — pulled out once real usage started
// duplicating both across topic-selection.service.ts, progression.service.ts, and
// insight.service.ts (Iteration 5). Test files intentionally keep their own independent copies
// (e.g. question-library.test.ts) — that duplication is deliberate, not a gap to fix.
export const ALL_DIMENSIONS: DimensionKey[] = [
  'emotional_stability',
  'social_energy',
  'dominance',
  'agreeableness',
  'conscientiousness',
  'openness',
  'change_orientation',
  'thinking_style',
  'detail_orientation',
  'motivation',
  'work_style'
];

export const CONFIDENCE_RANK: Record<ScoreConfidence, number> = {
  insufficient_signal: 0,
  low: 1,
  medium: 2,
  'medium-high': 3,
  high: 4
};

export const MEDIUM_CONFIDENCE_RANK = CONFIDENCE_RANK.medium;
