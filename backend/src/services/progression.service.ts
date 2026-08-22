import { db } from '../db/connection';
import { DimensionKey, DimensionScore, Progression, ProgressionTier } from '../types';
import { ALL_DIMENSIONS, CONFIDENCE_RANK, MEDIUM_CONFIDENCE_RANK } from '../models/dimensions';

// Personality engine (docs/personality-analysis-engine-spec.md §3.5, tracked in
// docs/personality-engine-implementation-plan.md Iteration 5). Computes the whole-profile tier
// from the 11 dimensions' latest dimension_score rows — distinct from flow_progress (see the
// progression migration's comment): this is "how far the personality engine has gotten," not
// "which onboarding step the candidate is on." The two connect at exactly one point (flow
// addendum §2), wired in topic-conversation.service.ts, not here.

export interface TemporalDepthSummary {
  /** Dimensions at ≥ medium confidence whose evidence all came from a single calendar day —
   *  real, but the "unfair advantage" longitudinal signal (spec §3.5/§4.4) hasn't kicked in yet.
   *  Drives the frontend's "based on one session so far" caveat (see plan doc's Iteration 5
   *  notes — direction after the Sketch-gate conflict was resolved: a single session should
   *  produce a real result with a visible caveat, not be blocked). */
  singleSessionDimensions: DimensionKey[];
  dimensionsAtConfidence: DimensionKey[];
}

export class ProgressionService {
  /** Recomputes progression.tier from the 11 dimensions' current dimension_score rows (spec §3.5
   *  table) and upserts the one `progression` row this user has. Triggered on topic-thread close,
   *  right after ScoringAggregationService.recomputeDimensions — see topic-conversation.service.ts. */
  async recomputeTier(userId: string): Promise<Progression> {
    const latest = await this.loadLatestScores(userId);

    const atMediumOrAbove = ALL_DIMENSIONS.filter((d) => {
      const score = latest[d];
      return !!score && CONFIDENCE_RANK[score.confidence] >= MEDIUM_CONFIDENCE_RANK;
    });

    // "In depth" (spec §3.5): "every dimension evidenced from ≥2 questions on ≥2 distinct
    // occasions" — this is that tier's *own* explicit bar, independent of the relaxed
    // minimum-evidence floor in scoring-aggregation.service.ts (see that file's comment on why
    // the floor no longer requires occasion diversity). A same-day session can reach Core
    // persona in principle (all 11 at medium, a lot of single-sitting conversation but not
    // impossible) but can never reach In depth, by this tier's own definition.
    const allInDepth = ALL_DIMENSIONS.every((d) => {
      const score = latest[d];
      return !!score && score.distinct_questions >= 2 && score.distinct_occasions >= 2;
    });

    let tier: ProgressionTier = 'none';
    if (atMediumOrAbove.length === ALL_DIMENSIONS.length) {
      tier = allInDepth ? 'in_depth' : 'core_persona';
    } else if (atMediumOrAbove.length > 0) {
      tier = 'sketch';
    }
    // 'ongoing' isn't assigned by this method — spec §3.5 defines it as "open-ended... a cadence
    // the user sets," which has no crisp data condition until the weekly scheduler (Iteration 9,
    // deprioritized) makes pace_preference a real, acted-on setting. Until then, 'in_depth' is
    // this engine's ceiling.

    const [progression] = await db('progression')
      .insert({ user_id: userId, tier, dimensions_at_confidence: JSON.stringify(atMediumOrAbove) })
      .onConflict('user_id')
      .merge(['tier', 'dimensions_at_confidence', 'updated_at'])
      .returning('*');

    // Stamp this snapshot tier onto each dimension's current row in place (not a new version —
    // see scoring-aggregation.service.ts's persist() comment on why dimension_score.tier is an
    // annotation, not evidence-driven content).
    await Promise.all(
      ALL_DIMENSIONS.filter((d) => latest[d]).map((d) => db('dimension_score').where({ id: latest[d]!.id }).update({ tier }))
    );

    return progression;
  }

  /** Current tier without recomputing it — reads whatever the last recomputeTier call wrote.
   *  Used where a fresh recompute isn't warranted (e.g. a gate check right before profile
   *  generation, which runs moments after the topic-close turn that would have just updated it). */
  async getTier(userId: string): Promise<ProgressionTier> {
    const row = await db('progression').where({ user_id: userId }).first();
    return row?.tier ?? 'none';
  }

  async getTemporalDepthSummary(userId: string): Promise<TemporalDepthSummary> {
    const latest = await this.loadLatestScores(userId);
    const atMediumOrAbove = ALL_DIMENSIONS.filter((d) => {
      const score = latest[d];
      return !!score && CONFIDENCE_RANK[score.confidence] >= MEDIUM_CONFIDENCE_RANK;
    });
    const singleSessionDimensions = atMediumOrAbove.filter((d) => latest[d]!.distinct_occasions <= 1);

    return { singleSessionDimensions, dimensionsAtConfidence: atMediumOrAbove };
  }

  private async loadLatestScores(userId: string): Promise<Partial<Record<DimensionKey, DimensionScore>>> {
    const rows: DimensionScore[] = await db('dimension_score').where({ user_id: userId }).select('*');
    const latest: Partial<Record<DimensionKey, DimensionScore>> = {};
    for (const row of rows) {
      const current = latest[row.dimension];
      if (!current || row.version > current.version) {
        latest[row.dimension] = row;
      }
    }
    return latest;
  }
}
