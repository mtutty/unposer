import { db } from '../db/connection';
import { AppError, Channel, DimensionKey, Exchange, Message, TopicThread } from '../types';
import { getQuestion, LibraryQuestion } from '../models/question-library';
import { TopicSelectionService } from './topic-selection.service';
import { DimensionScoringService } from './dimension-scoring.service';
import { ScoringAggregationService } from './scoring-aggregation.service';
import { ProgressionService } from './progression.service';
import { EvidenceService } from './evidence.service';
import { EmailService } from './email.service';
import { runTopicTurn } from '../ai/topic-elicitation.chain';
import { computeOccasionId } from '../utils/occasion';

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
  private progression = new ProgressionService();
  private evidence = new EvidenceService();
  private email = new EmailService();

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

  /** Flow addendum §3 (Iteration 6): "the candidate can move a topic to email at any point, per-
   *  question or mid-thread" — this is that action, candidate-initiated (no scheduler pushes this
   *  automatically, see Iteration 9). Re-sends the active thread's most recent assistant exchange
   *  (the question currently awaiting an answer) as a real email, so there's something concrete
   *  in the candidate's inbox to reply to — the topic itself, and every exchange already on it,
   *  is untouched; this doesn't open a new thread or lose any continuity, it just gives the
   *  existing one a real email address to be replied to from. Every subsequent exchange still
   *  gets whichever channel it actually arrived on (postUserMessage's own `channel` param), so a
   *  candidate can freely alternate email/chat turn to turn on the same thread. */
  async switchActiveTopicToEmail(userId: string): Promise<Message> {
    const thread = await this.getActiveThread(userId);
    if (!thread) {
      throw new AppError('NO_ACTIVE_TOPIC', 'No open topic to continue by email — resume the session first.', 400);
    }

    const exchanges = await this.getExchanges(thread.id);
    const lastAssistant = [...exchanges].reverse().find((e) => e.role === 'assistant');
    if (!lastAssistant) {
      throw new AppError('NO_PENDING_QUESTION', 'Nothing to send yet — this topic has no question pending a reply.', 400);
    }

    await this.email.deliverForTopic(thread, lastAssistant.text);
    return this.toMessage(lastAssistant, thread);
  }

  /** Every exchange across every one of this user's topic threads (open, closed, ad hoc), oldest
   *  first — replaces `ConversationService.getHistory(userId, 'deep_prompts')` as the transcript
   *  source for profile generation (profile.service.ts), which read from the now-permanently-
   *  empty `messages` table for `deep_prompts` ever since Iteration 3 moved that step onto this
   *  service's own topic_thread/exchange model. Found and fixed as part of Iteration 5 — see the
   *  plan doc's notes. */
  async getFullTranscript(userId: string): Promise<Message[]> {
    const threads: TopicThread[] = await db('topic_thread').where({ user_id: userId }).select('*');
    if (threads.length === 0) return [];
    const threadById = new Map(threads.map((t) => [t.id, t]));

    const exchanges: Exchange[] = await db('exchange')
      .whereIn(
        'thread_id',
        threads.map((t) => t.id)
      )
      .orderBy('sent_at', 'asc')
      .select('*');

    return exchanges.map((e) => this.toMessage(e, threadById.get(e.thread_id)!));
  }

  /** Opens a topic thread outside the fixed question library (flow addendum §6) — Step 6's
   *  flag→re-ask correction loop is "just another topic," not a special case: its answer feeds
   *  dimension_evidence exactly like a library question's would (see postUserMessage's handling
   *  of an unrecognized question_id below), addressable by the normal coverage-selection scheme
   *  once closed. `questionId` is caller-supplied and must be unique-enough not to collide with
   *  the library (profile.service.ts uses `reask-<insight id>`); `dimensions` are the specific
   *  dimensions this re-ask targets (derived from the flagged insight's own supporting evidence,
   *  when known — see profile.service.ts), used only for dimension-scoring extraction, since
   *  there's no LibraryQuestion.dimensionLoads for an ad hoc question to fall back on. */
  async openAdHocTopic(userId: string, questionId: string, promptText: string, dimensions: DimensionKey[], channel: Channel): Promise<Message> {
    // At most one open thread per user (Iteration 3's invariant) — if the candidate left Step 5
    // mid-topic and flagged an insight from the profile page instead, interrupt that thread
    // rather than silently orphaning it (getActiveThread only ever returns the most-recently-
    // opened open thread, so a second one would make the first unreachable). No aggregation
    // trigger here — it was interrupted, not completed, so nothing to re-score yet.
    const existingOpen = await this.getActiveThread(userId);
    if (existingOpen) {
      await db('topic_thread')
        .where({ id: existingOpen.id })
        .update({ status: 'closed', closed_at: new Date(), closed_by: 'model', updated_at: new Date() });
    }

    const [thread] = await db('topic_thread')
      .insert({ user_id: userId, question_id: questionId, ad_hoc_dimensions: JSON.stringify(dimensions) })
      .returning('*');
    const opener = await this.insertExchange(thread.id, 'assistant', promptText, channel);
    return this.toMessage(opener, thread);
  }

  async postUserMessage(userId: string, channel: Channel, content: string): Promise<TopicTurnOutcome> {
    const thread = await this.getActiveThread(userId);
    if (!thread) {
      throw new AppError('NO_ACTIVE_TOPIC', 'No open topic to reply to — resume the session first.', 400);
    }

    const question = await this.resolveQuestion(thread);

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

      // Full re-score on topic-thread close (spec §9.2) — awaited, unlike the extraction
      // fire-and-forget above, for two reasons: it needs this turn's own extraction to have
      // actually landed in dimension_evidence first (hence awaiting `extraction` here, where
      // every other turn leaves it to run in the background), and it's cheap, DB-only arithmetic
      // with no LLM call, so the added latency is negligible next to the round trip that already
      // happened. Progression re-computation (Iteration 5) follows immediately after, since tier
      // is derived from exactly these scores — see progression.service.ts.
      await extraction;
      await this.aggregation
        .recomputeDimensions(userId, dimensions)
        .then(() => this.progression.recomputeTier(userId))
        .catch((error) => {
          console.warn(`[topic-conversation.service] score/progression aggregation failed for user ${userId}:`, error.message || error);
        });
    }

    return { assistantMessage: this.toMessage(assistantExchange, thread), complete: await this.isFlowStepComplete(userId) };
  }

  private async getActiveThread(userId: string): Promise<TopicThread | undefined> {
    return db('topic_thread').where({ user_id: userId, status: 'open' }).orderBy('opened_at', 'desc').first();
  }

  /** A real library question, or — for an ad hoc re-ask thread (flow addendum §6) — a synthetic
   *  LibraryQuestion-shaped stand-in built from the thread's own opening exchange (the re-ask
   *  prompt itself, already stored verbatim by openAdHocTopic) and its stored ad_hoc_dimensions,
   *  each treated as primary since there's no P/s distinction for a one-off follow-up. */
  private async resolveQuestion(thread: TopicThread): Promise<LibraryQuestion> {
    const libraryQuestion = getQuestion(thread.question_id);
    if (libraryQuestion) return libraryQuestion;

    if (thread.ad_hoc_dimensions?.length) {
      const [opener] = await this.getExchanges(thread.id);
      return {
        id: thread.question_id,
        shortName: 'Follow-up',
        prompt: opener?.text ?? '',
        dimensionLoads: Object.fromEntries(thread.ad_hoc_dimensions.map((d) => [d, 'P'])) as LibraryQuestion['dimensionLoads'],
        heavy: false,
        theme: 'Re-ask'
      };
    }

    throw new AppError('UNKNOWN_QUESTION', `Question "${thread.question_id}" is not in the library.`, 500);
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

  /** Flow addendum §2: Step 5 completes in flow_progress the moment progression.tier first
   *  reaches Sketch (any dimension at medium confidence) — not a fixed question count. Real tier
   *  lookup as of Iteration 5 (progression.service.ts); the placeholder this replaced ("core set
   *  closed") is gone. Callers (websocket/server.ts) didn't need to change. */
  private async isFlowStepComplete(userId: string): Promise<boolean> {
    const row = await db('progression').where({ user_id: userId }).first();
    return !!row && row.tier !== 'none';
  }
}
