import { db } from '../db/connection';
import { DimensionEvidence, DimensionScore, EvidenceStrength, EvidenceType, PersonalityInsight } from '../types';
import { CONFIDENCE_RANK, MEDIUM_CONFIDENCE_RANK } from '../models/dimensions';
import { generateInsights, DimensionSummaryInput } from '../ai/insight-generator.chain';

// Personality engine (docs/personality-analysis-engine-spec.md §6, tracked in
// docs/personality-engine-implementation-plan.md Iteration 5). Owns the medium-confidence floor
// (spec §6: "Low-confidence dimensions produce no insights") and evidence-selection — the chain
// itself just writes prose from whatever it's handed.

const MAX_EVIDENCE_PER_DIMENSION = 4;

// Same type>strength weighting spirit as scoring-aggregation.service.ts (explicit > behavioral >
// attribution > linguistic; strong > moderate > weak) — used here only to pick which few evidence
// spans are worth showing the insight-writing prompt, not for any scoring math, so a simpler
// combined rank (not the same numeric weights) is enough.
const TYPE_RANK: Record<EvidenceType, number> = { explicit_statement: 3, behavioral_report: 2, attribution_pattern: 1, linguistic_marker: 0 };
const STRENGTH_RANK: Record<EvidenceStrength, number> = { strong: 2, moderate: 1, weak: 0 };

export class InsightService {
  /** Regenerates every insight for this user from their current medium-confidence-or-better
   *  dimensions (spec §6) — wholesale replace, same "always equals current" pattern
   *  evidence.service.ts's indexDistilledProfile uses, so a since-superseded insight can never
   *  outrank the current read. Called from profile.service.ts before synthesizing the candidate-
   *  facing profile (see that file) — this table is the source of record either way. */
  async regenerate(userId: string): Promise<PersonalityInsight[]> {
    const eligible = await this.loadEligibleScores(userId);

    const dimensionInputs: DimensionSummaryInput[] = await Promise.all(
      eligible.map(async (score) => ({
        dimension: score.dimension,
        score: score.score!,
        band: score.band!,
        contextDependenceEligible: score.variance_pattern === 'topic_linked',
        evidence: await this.loadRepresentativeEvidence(score.contributing_evidence_ids)
      }))
    );

    const generated = dimensionInputs.length > 0 ? await generateInsights({ dimensions: dimensionInputs }) : [];

    await db('insight').where({ user_id: userId }).delete();
    if (generated.length === 0) return [];

    return db('insight')
      .insert(
        generated.map((g) => ({
          user_id: userId,
          type: g.type,
          text: g.text,
          supporting_evidence_ids: JSON.stringify(g.supportingEvidenceIds),
          // These become part of the candidate's own profile immediately (see profile.service.ts)
          // — surfaced_to_recruiter stays false until Iteration 8 builds the actual §8 guardrail
          // filter; nothing today reads this column for recruiter-facing rendering anyway.
          surfaced_to_user: true,
          surfaced_to_recruiter: false
        }))
      )
      .returning('*');
  }

  async getInsights(userId: string): Promise<PersonalityInsight[]> {
    return db('insight').where({ user_id: userId }).orderBy('created_at', 'asc').select('*');
  }

  private async loadEligibleScores(userId: string): Promise<DimensionScore[]> {
    const rows: DimensionScore[] = await db('dimension_score').where({ user_id: userId }).select('*');
    const latestByDimension = new Map<string, DimensionScore>();
    for (const row of rows) {
      const current = latestByDimension.get(row.dimension);
      if (!current || row.version > current.version) {
        latestByDimension.set(row.dimension, row);
      }
    }
    return [...latestByDimension.values()].filter(
      (s) => s.score !== null && CONFIDENCE_RANK[s.confidence] >= MEDIUM_CONFIDENCE_RANK
    );
  }

  private async loadRepresentativeEvidence(
    evidenceIds: string[]
  ): Promise<Array<{ id: string; span: string; direction: 'low' | 'high'; note: string }>> {
    if (evidenceIds.length === 0) return [];

    const rows: DimensionEvidence[] = await db('dimension_evidence').whereIn('id', evidenceIds).select('*');
    const ranked = [...rows].sort((a, b) => {
      const rankA = TYPE_RANK[a.type] * 3 + STRENGTH_RANK[a.strength];
      const rankB = TYPE_RANK[b.type] * 3 + STRENGTH_RANK[b.strength];
      return rankB - rankA;
    });

    return ranked.slice(0, MAX_EVIDENCE_PER_DIMENSION).map((r) => ({ id: r.id, span: r.span, direction: r.direction, note: r.note || '' }));
  }
}
