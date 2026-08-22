// Computes exchange.occasion_id (docs/personality-analysis-engine-spec.md §5) — the candidate's
// local calendar date, distinct from a raw timestamp. This is the field temporal-diversity
// confidence (spec §4.4) and occasion-vs-topic variance classification (§4.4, §9.9) are built on.
//
// Iteration 1 decision (see docs/personality-engine-implementation-plan.md): no per-user timezone
// is captured anywhere in this codebase (checked users, logistics_responses, and the rest of
// backend/src/types — nothing). Rather than guess, this falls back to the UTC calendar date of
// `sentAt`. That's a real approximation, not a placeholder to silently swap later: revisit this
// function, not the callers, once a real timezone source exists (candidate signup, browser-
// reported offset, or a logistics-capture question).
export function computeOccasionId(sentAt: Date): string {
  return sentAt.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}
