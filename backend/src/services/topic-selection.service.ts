import { db } from '../db/connection';
import { DimensionKey } from '../types';
import { LibraryQuestion, getQuestion, questionLibrary } from '../models/question-library';

// Personality engine (docs/personality-analysis-engine-spec.md §3 "Selection logic", tracked in
// docs/personality-engine-implementation-plan.md Iteration 3).

const CORE_SET = ['Q0', 'Q23', 'Q24', 'Q25'];

const ALL_DIMENSIONS: DimensionKey[] = [
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

interface DimensionCoverage {
  // Evidence-row count for this dimension across the candidate's whole history. A placeholder
  // proxy for the real §4.4 confidence computation (evidence count + source/temporal diversity +
  // consistency) — that formula is Iteration 4's job and needs dimension_score rows this
  // iteration doesn't write. Evidence count alone is enough to drive "ask about what's thin"
  // selection now; swap this service's internals for a real confidence lookup once Iteration 4
  // lands, callers (topic-conversation.service.ts) untouched.
  evidenceCount: number;
  distinctQuestions: Set<string>;
  distinctOccasions: Set<string>;
  lastEvidenceAt: Date | null;
}

type CoverageMap = Record<DimensionKey, DimensionCoverage>;

interface AskedThread {
  id: string;
  question_id: string;
  opened_at: Date;
}

function emptyCoverage(): CoverageMap {
  const coverage = {} as CoverageMap;
  ALL_DIMENSIONS.forEach((d) => {
    coverage[d] = { evidenceCount: 0, distinctQuestions: new Set(), distinctOccasions: new Set(), lastEvidenceAt: null };
  });
  return coverage;
}

export class TopicSelectionService {
  /**
   * Picks the next question to open for this candidate (spec §3, points 1-4):
   *   1. Core set first (Q0, 23, 24, 25) — nothing else covers their under-sampled dimensions.
   *   2. Then the unasked question whose primary dimension(s) have the lowest coverage.
   *   3. Never two heavy questions in a row.
   *   4. Ties broken toward the dimension least recently sampled (temporal spread).
   * (Point 5, "follow the energy" — a long specific answer earns a follow-up rather than a new
   * question — lives in topic-elicitation.chain.ts's close-criteria prompt, not here: this method
   * is only consulted once a topic is already closed / no topic is open.)
   */
  async selectNextQuestion(userId: string): Promise<LibraryQuestion> {
    const askedThreads: AskedThread[] = await db('topic_thread')
      .where({ user_id: userId })
      .orderBy('opened_at', 'desc')
      .select('id', 'question_id', 'opened_at');

    const askedIds = new Set(askedThreads.map((t) => t.question_id));

    const missingCore = CORE_SET.find((id) => !askedIds.has(id));
    if (missingCore) {
      return getQuestion(missingCore)!;
    }

    const coverage = await this.computeCoverage(askedThreads);
    const lastQuestion = askedThreads[0] ? getQuestion(askedThreads[0].question_id) : undefined;

    let pool = questionLibrary.filter((q) => !askedIds.has(q.id));
    if (pool.length === 0) {
      // Every question in the library has been asked at least once. Revisiting a closed topic is
      // the spec's "Ongoing" tier (§3.5), which doesn't have real re-ask behavior defined yet
      // (Iteration 5). Falling back to the full library rather than dead-ending — this will pick
      // whichever question best serves the lowest-coverage dimension, same as normal selection,
      // just allowing a repeat question_id (topic-conversation.service.ts opens a new thread for
      // it, distinct from the earlier closed one).
      pool = questionLibrary;
    }

    const minCoverage = Math.min(...ALL_DIMENSIONS.map((d) => coverage[d].evidenceCount));
    const lowestDims = new Set(ALL_DIMENSIONS.filter((d) => coverage[d].evidenceCount === minCoverage));

    let candidates = pool.filter((q) =>
      Object.entries(q.dimensionLoads).some(([dim, load]) => load === 'P' && lowestDims.has(dim as DimensionKey))
    );
    if (candidates.length === 0) {
      // No unasked question has a primary load on the lowest-coverage dimension(s) — broaden to
      // secondary loads before giving up and using the whole pool.
      candidates = pool.filter((q) => Object.keys(q.dimensionLoads).some((dim) => lowestDims.has(dim as DimensionKey)));
    }
    if (candidates.length === 0) {
      candidates = pool;
    }

    if (lastQuestion?.heavy) {
      const light = candidates.filter((q) => !q.heavy);
      if (light.length > 0) candidates = light;
    }

    // Temporal-spread tiebreak (spec §3 point 4): prefer the candidate touching the dimension
    // least recently sampled (never-sampled sorts first). Array#sort is stable, so remaining ties
    // fall back to question-library order, keeping selection deterministic.
    return [...candidates].sort((a, b) => this.staleness(a, coverage) - this.staleness(b, coverage))[0];
  }

  private staleness(question: LibraryQuestion, coverage: CoverageMap): number {
    const times = Object.keys(question.dimensionLoads).map((dim) => {
      const lastEvidenceAt = coverage[dim as DimensionKey].lastEvidenceAt;
      return lastEvidenceAt ? lastEvidenceAt.getTime() : -Infinity;
    });
    return Math.min(...times);
  }

  private async computeCoverage(askedThreads: AskedThread[]): Promise<CoverageMap> {
    const coverage = emptyCoverage();
    if (askedThreads.length === 0) return coverage;

    const threadIds = askedThreads.map((t) => t.id);
    const questionIdByThread = new Map(askedThreads.map((t) => [t.id, t.question_id]));

    const exchanges: { id: string; thread_id: string; occasion_id: string; sent_at: Date }[] = await db('exchange')
      .whereIn('thread_id', threadIds)
      .select('id', 'thread_id', 'occasion_id', 'sent_at');
    if (exchanges.length === 0) return coverage;

    const exchangeMeta = new Map(exchanges.map((e) => [e.id, e]));
    const exchangeIds = exchanges.map((e) => e.id);

    const evidenceRows: { dimension: DimensionKey; exchange_id: string }[] = await db('dimension_evidence')
      .whereIn('exchange_id', exchangeIds)
      .select('dimension', 'exchange_id');

    for (const row of evidenceRows) {
      const meta = exchangeMeta.get(row.exchange_id);
      if (!meta) continue;
      const c = coverage[row.dimension];
      c.evidenceCount += 1;
      c.distinctQuestions.add(questionIdByThread.get(meta.thread_id) ?? '');
      c.distinctOccasions.add(meta.occasion_id);
      if (!c.lastEvidenceAt || meta.sent_at > c.lastEvidenceAt) c.lastEvidenceAt = meta.sent_at;
    }

    return coverage;
  }
}
