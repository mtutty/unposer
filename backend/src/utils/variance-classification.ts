import { VarianceFlagType } from '../types';

// Personality engine (docs/personality-analysis-engine-spec.md §4.4's variance table + §9.9,
// tracked in docs/personality-engine-implementation-plan.md Iteration 4). §9.9 says this
// classification is "empirical — cannot be resolved without longitudinal data. Default decided."
// — the thresholds below are that default: a reasonable, documented starting point, not a tuned
// model. Revisit once real multi-week candidate data exists to check against (same spirit as
// Iteration 2's facet lists / Iteration 1's occasion_id UTC fallback).

export interface VarianceEvidencePoint {
  evidenceId: string;
  questionId: string;
  occasionId: string;
  sentAt: Date;
  // 0-100, this item's direction converted to a raw pole value (100 = fully toward the high
  // pole, 0 = fully toward the low pole) — see scoring-aggregation.service.ts for why direction
  // alone (not strength) determines this.
  evidenceScore: number;
}

export interface VarianceClassification {
  flagType: VarianceFlagType;
  // Population standard deviation of evidenceScore across all points, rounded to 2 decimals —
  // stored in variance_flag.magnitude.
  magnitude: number;
  contributingEvidenceIds: string[];
  topicSpread: string[];
  occasionSpread: string[];
  // The stats that produced this read — stored verbatim in variance_flag.model_call for audit.
  // No LLM call underlies this classification (it's arithmetic on stored evidence), so this is
  // "the model" only in the sense of "the classification model," not an actual LLM invocation.
  reasoning: Record<string, unknown>;
}

// Below this standard deviation (on the 0-100 evidenceScore scale), spread is treated as noise,
// not a pattern worth classifying — this is what lets a stable dimension have zero variance_flag
// rows and zero confidence penalty, exactly as the "resolved" topic_linked/occasion_linked rows
// already imply.
const LOW_VARIANCE_STD = 15;
const DRIFT_CORRELATION_THRESHOLD = 0.6;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (groups[k] ??= []).push(item);
  }
  return groups;
}

/** Pearson correlation coefficient. Used only to detect a chronological trend (spec §4.4's
 *  "drifts monotonically over weeks"), not for anything requiring rigorous statistical inference
 *  — a threshold on |r| is enough to distinguish "trending" from "noisy." */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Classifies variance in a dimension's evidence into one of spec §4.4's three named patterns, or
 * §9.9's "ambiguous" catch-all — or returns null when there isn't enough spread to say anything
 * (the stable, common case). Only two of the four outcomes are "flag" outcomes that get written
 * as a `variance_flag` row (see scoring-aggregation.service.ts): monotonic_drift (§4.4 says
 * "Flag; do not average blindly") and ambiguous (§9.9 says "logged... automatically and
 * unconditionally"). topic_linked and occasion_linked have their own defined resolutions —
 * keep confidence + insight, and average out, respectively — and aren't flagged.
 */
export function classifyVariance(points: VarianceEvidencePoint[]): VarianceClassification | null {
  if (points.length < 3) return null; // too little evidence to call anything a "pattern"

  const scores = points.map((p) => p.evidenceScore);
  const overallStd = stddev(scores);
  const contributingEvidenceIds = points.map((p) => p.evidenceId);
  const topicSpread = [...new Set(points.map((p) => p.questionId))];
  const occasionSpread = [...new Set(points.map((p) => p.occasionId))];

  if (overallStd < LOW_VARIANCE_STD) return null; // stable — nothing to classify

  const byTopic = groupBy(points, (p) => p.questionId);
  const topicMeans = Object.values(byTopic).map((g) => mean(g.map((p) => p.evidenceScore)));
  const betweenTopicStd = topicMeans.length > 1 ? stddev(topicMeans) : 0;
  const withinTopicStds = Object.values(byTopic).map((g) => (g.length > 1 ? stddev(g.map((p) => p.evidenceScore)) : 0));
  const avgWithinTopicStd = mean(withinTopicStds);

  const base = { overallStd, betweenTopicStd, avgWithinTopicStd, topicCount: topicSpread.length, occasionCount: occasionSpread.length };
  const result = (flagType: VarianceFlagType, extra: Record<string, unknown> = {}): VarianceClassification => ({
    flagType,
    magnitude: round2(overallStd),
    contributingEvidenceIds,
    topicSpread,
    occasionSpread,
    reasoning: { ...base, ...extra, read: flagType }
  });

  // Checked in this order deliberately: a real chronological trend can trivially satisfy either
  // of the other two patterns' structural tests (e.g. two topics asked in two different weeks
  // are indistinguishable from drift by a topic-grouping test alone), so drift gets first claim
  // on any variance a temporal correlation actually explains. See the plan doc's Iteration 4
  // notes for the worked examples that motivated this ordering.

  // monotonic drift: score trends consistently in one direction across chronological order.
  const chronological = [...points].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const correlation = pearson(
    chronological.map((_, i) => i),
    chronological.map((p) => p.evidenceScore)
  );
  if (Math.abs(correlation) >= DRIFT_CORRELATION_THRESHOLD) {
    return result('monotonic_drift', { correlation });
  }

  // topic-linked: the spread is explained by WHICH question was asked (topic means disagree),
  // not by time (each topic is internally consistent).
  if (topicSpread.length >= 2 && betweenTopicStd >= LOW_VARIANCE_STD && avgWithinTopicStd < LOW_VARIANCE_STD) {
    return result('topic_linked');
  }

  // occasion-linked: the SAME question, re-asked on a different day, disagrees with itself, while
  // different questions broadly agree with each other (topic means are close).
  const revisitedTopics = Object.values(byTopic).filter((g) => new Set(g.map((p) => p.occasionId)).size >= 2);
  if (revisitedTopics.length > 0 && betweenTopicStd < LOW_VARIANCE_STD) {
    return result('occasion_linked');
  }

  return result('ambiguous', { correlation });
}
