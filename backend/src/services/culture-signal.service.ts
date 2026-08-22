import { db } from '../db/connection';
import { CultureSignal } from '../types';
import { inferCultureSignals } from '../ai/culture-signal.chain';

// Personality engine (spec §7, tracked in docs/personality-engine-implementation-plan.md
// Iteration 7). Q0/Q15/Q21 are the spec's own named sources (what gets rewarded / deal-breakers /
// espoused-vs-enacted culture) — culture capture doesn't run off the full transcript, just these.
const SOURCE_QUESTION_IDS = ['Q0', 'Q15', 'Q21'];

export class CultureSignalService {
  /** Regenerates every culture_signal row for this user from whichever of Q0/Q15/Q21 they've
   *  answered so far — wholesale replace, same "always equals current" pattern insight.service.ts
   *  uses, so a since-superseded read never outranks the current one. Not gated on tier or
   *  calibration status (spec §7: explicitly separate from personality dimension scores) — can
   *  run as soon as any of the three source questions has an answer. */
  async regenerate(userId: string): Promise<CultureSignal[]> {
    const sources = await this.loadSources(userId);
    const signals = sources.length > 0 ? await inferCultureSignals(sources) : [];

    await db('culture_signal').where({ user_id: userId }).delete();
    if (signals.length === 0) return [];

    return db('culture_signal')
      .insert(
        signals.map((s) => ({
          user_id: userId,
          cvf_quadrant: s.quadrant,
          source_evidence_ids: JSON.stringify(s.sourceExchangeIds)
        }))
      )
      .returning('*');
  }

  private async loadSources(userId: string): Promise<Array<{ exchangeId: string; questionId: string; text: string }>> {
    const threads: { id: string; question_id: string }[] = await db('topic_thread')
      .where({ user_id: userId })
      .whereIn('question_id', SOURCE_QUESTION_IDS)
      .select('id', 'question_id');
    if (threads.length === 0) return [];

    const questionByThread = new Map(threads.map((t) => [t.id, t.question_id]));
    const exchanges: { id: string; thread_id: string; text: string }[] = await db('exchange')
      .whereIn(
        'thread_id',
        threads.map((t) => t.id)
      )
      .where({ role: 'user' })
      .select('id', 'thread_id', 'text');

    return exchanges.map((e) => ({ exchangeId: e.id, questionId: questionByThread.get(e.thread_id)!, text: e.text }));
  }
}
