import { db } from '../db/connection';
import { DimensionEvidence, DimensionKey } from '../types';
import { scoreDimension } from '../ai/dimension-scoring.chain';

/**
 * Personality engine (docs/personality-analysis-engine-spec.md §9.2's decided recommendation:
 * cheap extraction on every exchange, expensive full re-score later — Iteration 4). Runs the
 * dimension-scoring chain for an explicit list of target dimensions against one exchange and
 * persists the resulting evidence rows to dimension_evidence.
 *
 * Deliberately takes `dimensions` as a caller-supplied list rather than looking it up from the
 * question library's P/s coverage matrix itself: which dimensions apply to a given question is a
 * selection-layer concern (Iteration 3, coverage-driven selection), out of scope here. Nothing in
 * this service is wired into the live deep_prompts flow yet — deep_prompts still runs on the old
 * conversation_threads/messages model, not topic_thread/exchange (that reconnection is also
 * Iteration 3's job). Exercised for now via scripts/score-fixture-transcript.ts.
 */
export class DimensionScoringService {
  async extractAndPersist(
    exchangeId: string,
    questionText: string,
    answerText: string,
    dimensions: DimensionKey[]
  ): Promise<DimensionEvidence[]> {
    const inserted: DimensionEvidence[] = [];

    for (const dimension of dimensions) {
      const result = await scoreDimension({ dimension, questionText, answerText });
      if (result.evidence.length === 0) continue;

      const rows = result.evidence.map((e) => ({
        exchange_id: exchangeId,
        dimension,
        span: e.span,
        direction: e.direction,
        strength: e.strength,
        type: e.type,
        facet: e.facet,
        note: e.note
      }));

      const insertedRows = await db('dimension_evidence').insert(rows).returning('*');
      inserted.push(...insertedRows);
    }

    return inserted;
  }
}
