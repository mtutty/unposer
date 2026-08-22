import { db } from '../db/connection';
import { AppError, Channel, DimensionKey, Exchange, Message, TopicThread } from '../types';
import { getQuestion } from '../models/question-library';
import { TopicSelectionService } from './topic-selection.service';
import { DimensionScoringService } from './dimension-scoring.service';
import { ScoringAggregationService } from './scoring-aggregation.service';
import { EvidenceService } from './evidence.service';
import { runTopicTurn } from '../ai/topic-elicitation.chain';
import { computeOccasionId } from '../utils/occasion';

const CORE_SET = ['Q0', 'Q23', 'Q24', 'Q25'];

export interface TopicTurnOutcome {
  assistantMessage: Message;
  complete: boolean;
}

/**
 * Personality engine (docs/personality-analysis-engine-spec.md §3/§5, tracked in
 * docs/personality-engine-implementation-plan.md Iteration 3). The deep_prompts-only sibling to
 * ConversationService: same external shape (ensureOpeningExchanges/postUserMessage returning
 * Message-shaped payloads) so websocket/server.ts can branch on step without a bigger rewrite,
 * but backed by topic_thread/exchange, not conversation_threads/messages. Logistics is
 * untouched — it keeps using ConversationService exactly as before.
 *
 * Session is not a concept here (spec §5) — "the active thread" is just whichever topic_thread is
 * still `status = 'open'` for this user; at most one is open at a time in this iteration (nothing
 * yet lets a candidate branch into a second topic before closing the first).
 */
export class TopicConversationService {
  private selection = new TopicSelectionService();
  private scoring = new DimensionScoringService();
  private aggregation = new ScoringAggregationService();
  private evidence = new EvidenceService();

  /** Returns the open thread's full exchange history, or opens a freshly-selected topic and
   *  returns its single opening exchange — the library's own question prompt, inserted directly
   *  (no LLM call to phrase it; the library text already is the crafted wording). */
  async ensureOpeningExchanges(userId: string, channel: Channel): Promise<Message[]> {
    const active = await this.getActiveThread(userId);
    if (active) {
      const exchanges = await this.getExchanges(active.id);
      return exchanges.map((e) => this.toMessage(e, active));
    }

    const question = await this.selection.selectNextQuestion(userId);
    const thread = await this.openThread(userId, question.id);
    const opener = await this.insertExchange(thread.id, 'assistant', question.prompt, channel);
    return [this.toMessage(opener, thread)];
  }

  async postUserMessage(userId: string, channel: Channel, content: string): Promise<TopicTurnOutcome> {
    const thread = await this.getActiveThread(userId);
    if (!thread) {
      throw new AppError('NO_ACTIVE_TOPIC', 'No open topic to reply to — resume the session first.', 400);
    }

    const question = getQuestion(thread.question_id);
    if (!question) {
      throw new AppError('UNKNOWN_QUESTION', `Question "${thread.question_id}" is not in the library.`, 500);
    }

    const userExchange = await this.insertExchange(thread.id, 'user', content, channel);
    const priorExchanges = await this.getExchanges(thread.id);

    const turn = await runTopicTurn({
      question,
      channel,
      history: priorExchanges.map((e) => ({ role: e.role, content: e.text }))
    });

    const assistantExchange = await this.insertExchange(thread.id, 'assistant', turn.reply, channel);

    // Cheap per-exchange extraction (spec §9.2) — every dimension this question loads on (P or s),
    // same decoupling DimensionScoringService already documents: selection-layer concerns (which
    // dimensions a question serves) stay in the question library, not hardcoded here.
    const dimensions = Object.keys(question.dimensionLoads) as DimensionKey[];
    const extraction = this.scoring.extractAndPersist(userExchange.id, question.prompt, content, dimensions).catch((error) => {
      console.warn(`[topic-conversation.service] evidence extraction failed for user ${userId}:`, error.message || error);
    });

    this.evidence
      .indexDeepPromptSubstrate(userId, this.toMessage(userExchange, thread), this.toMessage(assistantExchange, thread))
      .catch((error) => {
        console.warn(`[topic-conversation.service] evidence indexing failed for user ${userId}:`, error.message || error);
      });

    if (turn.closeTopic) {
      await db('topic_thread')
        .where({ id: thread.id })
        .update({ status: 'closed', closed_at: new Date(), closed_by: turn.closedBy, updated_at: new Date() });

      // Full re-score on topic-thread close (spec §9.2/Iteration 4) — awaited, unlike the
      // extraction fire-and-forget above, for two reasons: it needs this turn's own extraction to
      // have actually landed in dimension_evidence first (hence awaiting `extraction` here, where
      // every other turn leaves it to run in the background), and it's cheap, DB-only arithmetic
      // with no LLM call, so the added latency is negligible next to the round trip that already
      // happened. Tier-transition re-scoring (the spec's other trigger point) has no tier engine
      // to trigger from yet — Iteration 5's job, noted in the plan doc.
      await extraction;
      await this.aggregation.recomputeDimensions(userId, dimensions).catch((error) => {
        console.warn(`[topic-conversation.service] score aggregation failed for user ${userId}:`, error.message || error);
      });
    }

    return { assistantMessage: this.toMessage(assistantExchange, thread), complete: await this.isFlowStepComplete(userId) };
  }

  private async getActiveThread(userId: string): Promise<TopicThread | undefined> {
    return db('topic_thread').where({ user_id: userId, status: 'open' }).orderBy('opened_at', 'desc').first();
  }

  private async getExchanges(threadId: string): Promise<Exchange[]> {
    return db('exchange').where({ thread_id: threadId }).orderBy('sent_at', 'asc').select('*');
  }

  private async openThread(userId: string, questionId: string): Promise<TopicThread> {
    const [thread] = await db('topic_thread').insert({ user_id: userId, question_id: questionId }).returning('*');
    return thread;
  }

  private async insertExchange(threadId: string, role: 'user' | 'assistant', text: string, channel: Channel): Promise<Exchange> {
    const sentAt = new Date();
    const [exchange] = await db('exchange')
      .insert({ thread_id: threadId, role, text, sent_at: sentAt, channel, occasion_id: computeOccasionId(sentAt) })
      .returning('*');
    return exchange;
  }

  private toMessage(exchange: Exchange, thread: TopicThread): Message {
    return {
      id: exchange.id,
      thread_id: thread.id,
      user_id: thread.user_id,
      role: exchange.role,
      content: exchange.text,
      channel: exchange.channel,
      step: 'deep_prompts',
      metadata: { question_id: thread.question_id, occasion_id: exchange.occasion_id },
      created_at: exchange.sent_at
    };
  }

  /**
   * Placeholder flow-completion signal for flow_progress's deep_prompts entry — NOT the spec's
   * tier engine. The flow addendum (§2) says Step 5 should complete when progression.tier first
   * reaches Sketch, but that table has no computable tier logic yet (Iteration 5, which the plan
   * doc explicitly calls out as "the one place flow-model code changes"). Standing in with "the
   * core set is closed" — the four topics doing the real methodological lifting (spec §3,
   * selection logic point 1) — which lands on roughly the same timescale the old fixed-story-count
   * criterion did. Swap this method's body for a real progression.tier lookup in Iteration 5;
   * callers (websocket/server.ts) don't need to change when it does.
   */
  private async isFlowStepComplete(userId: string): Promise<boolean> {
    const row = await db('topic_thread')
      .where({ user_id: userId, status: 'closed' })
      .whereIn('question_id', CORE_SET)
      .countDistinct('question_id as n')
      .first();
    return Number(row?.n ?? 0) >= CORE_SET.length;
  }
}
