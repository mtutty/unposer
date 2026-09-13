import { db } from '../db/connection';
import { AppError, RequisitionMessage, RequisitionThread } from '../types';
import { runElicitationTurn } from '../ai/elicitation.chain';
import {
  REQUISITION_QA_COMPLETION_CRITERIA,
  REQUISITION_QA_CONVERSATION_STARTERS,
  REQUISITION_QA_STEP_NAME,
  requisitionQaInfoAreas
} from '../models/requisition-qa';
import { config } from '../config';
import { RequisitionCultureSignalService } from './requisition-culture-signal.service';

export interface RequisitionTurnOutcome {
  assistantMessage: RequisitionMessage;
  complete: boolean;
  thread: RequisitionThread;
}

/**
 * Employer-side onboarding, Phase 2 (docs/employer-onboarding-spec.md §4) — the same
 * runElicitationTurn engine Step 3 logistics uses (ConversationService), narrowed per spec §2.2:
 * always app-channel, one thread per requisition rather than per (user, step), no tier/topic
 * concept. Deliberately a thin service rather than a `requisition-elicitation.chain.ts` wrapper —
 * ConversationService itself calls runElicitationTurn directly for logistics with no intermediate
 * chain file, and a pure pass-through wrapper here would just be that same pattern with an extra
 * layer of indirection.
 */
export class RequisitionConversationService {
  private cultureSignal = new RequisitionCultureSignalService();

  async getOrCreateThread(requisitionId: string): Promise<RequisitionThread> {
    let thread = await db('requisition_threads').where({ requisition_id: requisitionId }).first();

    if (!thread) {
      [thread] = await db('requisition_threads').insert({ requisition_id: requisitionId }).returning('*');
    }

    return thread;
  }

  async getHistory(requisitionId: string): Promise<RequisitionMessage[]> {
    return db('requisition_messages').where({ requisition_id: requisitionId }).orderBy('created_at', 'asc');
  }

  /** Generates and persists the opening question if this thread has no messages yet. */
  async ensureOpeningMessage(requisitionId: string): Promise<RequisitionMessage[]> {
    const thread = await this.getOrCreateThread(requisitionId);
    const history = await this.getHistory(requisitionId);
    if (history.length > 0) {
      return history;
    }

    const turn = await runElicitationTurn({
      stepName: REQUISITION_QA_STEP_NAME,
      completionCriteria: REQUISITION_QA_COMPLETION_CRITERIA,
      conversationStarters: REQUISITION_QA_CONVERSATION_STARTERS,
      channel: 'app',
      history: [],
      knownData: {},
      extractionAreas: requisitionQaInfoAreas
    });

    const [opener] = await db('requisition_messages')
      .insert({
        thread_id: thread.id,
        requisition_id: requisitionId,
        role: 'assistant',
        content: turn.reply
      })
      .returning('*');

    await db('requisition_threads').where({ id: thread.id }).update({ message_count: 1, updated_at: new Date() });

    return [opener];
  }

  async postUserMessage(requisitionId: string, content: string): Promise<RequisitionTurnOutcome> {
    const thread = await this.getOrCreateThread(requisitionId);

    if (thread.status === 'complete') {
      throw new AppError('THREAD_COMPLETE', 'This conversation is already complete.', 400);
    }

    await db('requisition_messages').insert({ thread_id: thread.id, requisition_id: requisitionId, role: 'user', content });

    // Full history (not just the LLM's recency window) so knownData never "forgets" something
    // extracted earlier in the session — a 5-20 minute sitting stays well within
    // elicitationHistoryWindow in practice, so this is one query, not a perf concern.
    const fullHistory = [...(await this.getHistory(requisitionId))];
    const knownData = this.deriveKnownData(fullHistory);
    const recentHistory = fullHistory.slice(-config.flow.elicitationHistoryWindow);

    const turn = await runElicitationTurn({
      stepName: REQUISITION_QA_STEP_NAME,
      completionCriteria: REQUISITION_QA_COMPLETION_CRITERIA,
      conversationStarters: REQUISITION_QA_CONVERSATION_STARTERS,
      channel: 'app',
      history: recentHistory.map((m) => ({ role: m.role, content: m.content })),
      knownData,
      extractionAreas: requisitionQaInfoAreas
    });

    const [assistantMessage] = await db('requisition_messages')
      .insert({
        thread_id: thread.id,
        requisition_id: requisitionId,
        role: 'assistant',
        content: turn.reply,
        metadata: turn.extracted
      })
      .returning('*');

    const [updatedThread] = await db('requisition_threads')
      .where({ id: thread.id })
      .update({
        message_count: thread.message_count + 2,
        status: turn.complete ? 'complete' : 'active',
        updated_at: new Date()
      })
      .returning('*');

    if (turn.complete) {
      // The gate analogous to resumes.confirmed — a requisition only counts as real once this
      // completes (spec §3). Never gated on culture-signal inference below.
      await db('job_requisitions').where({ id: requisitionId }).update({ status: 'active', updated_at: new Date() });

      this.cultureSignal.regenerate(requisitionId).catch((error) => {
        console.warn(`[requisition-conversation.service] culture signal inference failed for requisition ${requisitionId}:`, error.message || error);
      });
    }

    return { assistantMessage, complete: turn.complete, thread: updatedThread };
  }

  /** Folds every assistant turn's extracted fields together, in order — this step has no
   *  dedicated structured-data table the way logistics_responses is for Step 3, so "already
   *  known" context comes straight from the transcript's own metadata instead. */
  private deriveKnownData(history: RequisitionMessage[]): Record<string, any> {
    return history
      .filter((m) => m.role === 'assistant')
      .reduce((acc, m) => ({ ...acc, ...(m.metadata || {}) }), {} as Record<string, any>);
  }
}
