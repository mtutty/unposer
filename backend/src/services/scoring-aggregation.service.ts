import { db } from '../db/connection';
import { DimensionKey, DimensionScore, EvidenceStrength, EvidenceType, ScoreBand, ScoreConfidence } from '../types';
import { classifyVariance, VarianceEvidencePoint } from '../utils/variance-classification';

// Personality engine (docs/personality-analysis-engine-spec.md §4.4, §9.9, tracked in
// docs/personality-engine-implementation-plan.md Iteration 4). Recomputes a dimension's full
// aggregate score from its ENTIRE evidence history (spec §5: "scores are versioned... re-runnable
// against the full history"), not incrementally — cheap enough at this evidence volume, and
// avoids an incremental-update bug class entirely.

// §4.2's evidence-strength weighting table only gives type_weight; the aggregation formula in
// §4.4 also references a "strength_weight" factor by name but never defines its values (only
// §4.1 defines the strong/moderate/weak categories themselves). Same category of gap as
// Iteration 2's facet lists — filled here as a documented, revisitable default, not silently
// invented: strong=1.0 (so type_weight alone sets the ceiling), graduated down from there.
const TYPE_WEIGHT: Record<EvidenceType, number> = {
  explicit_statement: 1.0,
  behavioral_report: 0.8,
  attribution_pattern: 0.6,
  linguistic_marker: 0.3
};
const STRENGTH_WEIGHT: Record<EvidenceStrength, number> = { strong: 1.0, moderate: 0.6, weak: 0.3 };

// "Anchored at 50 with a prior weight equivalent to one moderate piece of evidence" (§4.4) — read
// as one type-agnostic moderate-strength item: the prior isn't real evidence with a type, so only
// STRENGTH_WEIGHT.moderate applies to it, not any TYPE_WEIGHT.
const PRIOR_WEIGHT = STRENGTH_WEIGHT.moderate;
const PRIOR_SCORE = 50;

// §9.3's suggested minimum evidence threshold before a score is even attempted ("2 pieces from
// ≥2 different questions on ≥2 distinct occasions, at least one of strength moderate or better.
// Below that, suppress").
const MIN_EVIDENCE_COUNT = 2;
const MIN_DISTINCT_QUESTIONS = 2;
const MIN_DISTINCT_OCCASIONS = 2;

type Level = 'high' | 'medium-high' | 'medium' | 'low';
const LEVEL_ORDER: Level[] = ['low', 'medium', 'medium-high', 'high'];
const BAND_FOR_LEVEL: Record<Level, ScoreBand> = { high: 'high', 'medium-high': 'medium-high', medium: 'medium', low: 'suppressed' };

interface EvidenceRow {
  id: string;
  questionId: string;
  occasionId: string;
  sentAt: Date;
  direction: 'low' | 'high';
  strength: EvidenceStrength;
  type: EvidenceType;
  evidenceScore: number; // direction converted to a 0-100 pole value — see recomputeDimension
}

export class ScoringAggregationService {
  async recomputeDimensions(userId: string, dimensions: DimensionKey[]): Promise<DimensionScore[]> {
    const results: DimensionScore[] = [];
    for (const dimension of dimensions) {
      results.push(await this.recomputeDimension(userId, dimension));
    }
    return results;
  }

  /** Recomputes one dimension's aggregate score from its full evidence history and writes a new
   *  versioned `dimension_score` row (spec §5: evidence is immutable, scores are versioned).
   *  Triggered on topic-thread close (spec §9.2) — see topic-conversation.service.ts. */
  async recomputeDimension(userId: string, dimension: DimensionKey): Promise<DimensionScore> {
    const evidence = await this.loadEvidence(userId, dimension);
    const distinctQuestions = new Set(evidence.map((e) => e.questionId)).size;
    const distinctOccasions = new Set(evidence.map((e) => e.occasionId)).size;
    const hasSubstantialEvidence = evidence.some((e) => e.strength === 'moderate' || e.strength === 'strong');

    if (
      evidence.length < MIN_EVIDENCE_COUNT ||
      distinctQuestions < MIN_DISTINCT_QUESTIONS ||
      distinctOccasions < MIN_DISTINCT_OCCASIONS ||
      !hasSubstantialEvidence
    ) {
      return this.persist(userId, dimension, {
        score: null,
        confidence: 'insufficient_signal',
        band: null,
        contributingEvidenceIds: evidence.map((e) => e.id),
        distinctOccasions
      });
    }

    const classification = classifyVariance(
      evidence.map(
        (e): VarianceEvidencePoint => ({
          evidenceId: e.id,
          questionId: e.questionId,
          occasionId: e.occasionId,
          sentAt: e.sentAt,
          evidenceScore: e.evidenceScore
        })
      )
    );

    const chronological = [...evidence].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const isDrifting = classification?.flagType === 'monotonic_drift';

    let weightedSum = PRIOR_WEIGHT * PRIOR_SCORE;
    let weightSum = PRIOR_WEIGHT;
    chronological.forEach((e, i) => {
      // §4.4's drift action: "weight recent evidence higher" — linear ramp from 0.5x (oldest) to
      // 1.5x (most recent), flat 1x when no drift was detected.
      const recencyBoost = isDrifting ? 0.5 + (chronological.length <= 1 ? 1 : i / (chronological.length - 1)) : 1;
      const weight = TYPE_WEIGHT[e.type] * STRENGTH_WEIGHT[e.strength] * recencyBoost;
      weightedSum += e.evidenceScore * weight;
      weightSum += weight;
    });
    const rawScore = weightedSum / weightSum;

    let level = this.richnessLevel(evidence.length, distinctQuestions, distinctOccasions);
    // §9.9: ambiguous variance lowers confidence one notch ("suppress the context-dependence
    // insight and lower confidence"). topic_linked keeps confidence as-is ("Keep confidence; emit
    // a context-dependence insight" — the insight itself is Iteration 5's job); occasion_linked
    // is already absorbed into the weighted mean above, no separate penalty.
    if (classification?.flagType === 'ambiguous') {
      level = this.demote(level);
    }

    // §4.4 ("Flag; do not average blindly") and §9.9 ("logged... automatically and
    // unconditionally") are the only two outcomes that get written as a variance_flag row —
    // topic_linked/occasion_linked have their own defined resolutions above and aren't flagged.
    if (classification && (classification.flagType === 'monotonic_drift' || classification.flagType === 'ambiguous')) {
      await this.writeVarianceFlag(userId, dimension, classification);
    }

    return this.persist(userId, dimension, {
      score: Math.round(rawScore),
      confidence: level,
      band: BAND_FOR_LEVEL[level],
      contributingEvidenceIds: evidence.map((e) => e.id),
      distinctOccasions
    });
  }

  /** Combines evidence count, source diversity (distinct questions), and temporal diversity
   *  (distinct occasions) into one of the four confidence levels (spec §4.4's first three
   *  factors — "consistency," the fourth, is handled separately via the variance classification
   *  above rather than folded into this same weighted blend). The specific weights/thresholds are
   *  a documented starting point pending Iteration 7's calibration, not a tuned model — same
   *  spirit as this file's STRENGTH_WEIGHT gap-fill above. */
  private richnessLevel(evidenceCount: number, distinctQuestions: number, distinctOccasions: number): Level {
    const richness =
      (Math.min(evidenceCount, 8) / 8) * 0.34 + (Math.min(distinctQuestions, 4) / 4) * 0.33 + (Math.min(distinctOccasions, 4) / 4) * 0.33;
    if (richness >= 0.85) return 'high';
    if (richness >= 0.65) return 'medium-high';
    if (richness >= 0.45) return 'medium';
    return 'low';
  }

  private demote(level: Level): Level {
    const idx = LEVEL_ORDER.indexOf(level);
    return LEVEL_ORDER[Math.max(0, idx - 1)];
  }

  private async loadEvidence(userId: string, dimension: DimensionKey): Promise<EvidenceRow[]> {
    const threads: { id: string; question_id: string }[] = await db('topic_thread').where({ user_id: userId }).select('id', 'question_id');
    if (threads.length === 0) return [];
    const questionByThread = new Map(threads.map((t) => [t.id, t.question_id]));

    const exchanges: { id: string; thread_id: string; occasion_id: string; sent_at: Date }[] = await db('exchange')
      .whereIn(
        'thread_id',
        threads.map((t) => t.id)
      )
      .select('id', 'thread_id', 'occasion_id', 'sent_at');
    if (exchanges.length === 0) return [];
    const exchangeMeta = new Map(exchanges.map((e) => [e.id, e]));

    const rows: { id: string; exchange_id: string; direction: 'low' | 'high'; strength: EvidenceStrength; type: EvidenceType }[] = await db(
      'dimension_evidence'
    )
      .where({ dimension })
      .whereIn(
        'exchange_id',
        exchanges.map((e) => e.id)
      )
      .select('id', 'exchange_id', 'direction', 'strength', 'type');

    return rows
      .map((row) => {
        const meta = exchangeMeta.get(row.exchange_id);
        if (!meta) return null;
        const questionId = questionByThread.get(meta.thread_id);
        if (!questionId) return null;
        return {
          id: row.id,
          questionId,
          occasionId: meta.occasion_id,
          sentAt: meta.sent_at,
          direction: row.direction,
          strength: row.strength,
          type: row.type,
          evidenceScore: row.direction === 'high' ? 100 : 0
        };
      })
      .filter((r): r is EvidenceRow => r !== null);
  }

  private async writeVarianceFlag(
    userId: string,
    dimension: DimensionKey,
    classification: NonNullable<ReturnType<typeof classifyVariance>>
  ): Promise<void> {
    await db('variance_flag')
      .insert({
        user_id: userId,
        dimension,
        flag_type: classification.flagType,
        magnitude: classification.magnitude,
        contributing_evidence_ids: JSON.stringify(classification.contributingEvidenceIds),
        topic_spread: JSON.stringify(classification.topicSpread),
        occasion_spread: JSON.stringify(classification.occasionSpread),
        model_call: JSON.stringify(classification.reasoning)
      })
      .returning('*');
  }

  private async persist(
    userId: string,
    dimension: DimensionKey,
    fields: {
      score: number | null;
      confidence: ScoreConfidence;
      band: ScoreBand | null;
      contributingEvidenceIds: string[];
      distinctOccasions: number;
    }
  ): Promise<DimensionScore> {
    const latest = await db('dimension_score').where({ user_id: userId, dimension }).max('version as v').first();
    const version = Number(latest?.v ?? 0) + 1;

    const [row] = await db('dimension_score')
      .insert({
        user_id: userId,
        dimension,
        version,
        score: fields.score,
        confidence: fields.confidence,
        band: fields.band,
        // tier stays null until Iteration 5's progression-tier engine exists — see the plan doc.
        tier: null,
        contributing_evidence_ids: JSON.stringify(fields.contributingEvidenceIds),
        distinct_occasions: fields.distinctOccasions
      })
      .returning('*');

    return row;
  }
}
