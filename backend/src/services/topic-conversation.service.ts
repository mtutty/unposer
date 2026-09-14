import { db } from '../db/connection';
import { AppError, Channel, DimensionKey, Exchange, FlowProgress, Message, TopicThread } from '../types';
import { getQuestion, LibraryQuestion } from '../models/question-library';
import { TopicSelectionService } from './topic-selection.service';
import { DimensionScoringService } from './dimension-scoring.service';
import { ScoringAggregationService } from './scoring-aggregation.service';
import { ProgressionService } from './progression.service';
import { EvidenceService } from './evidence.service';
import { EmailService } from './email.service';
import { FlowService } from './flow.service';
import { runTopicTurn } from '../ai/topic-elicitation.chain';
import { computeOccasionId } from '../utils/occasion';

export interface TopicTurnOutcome {
  assistantMessage: Message;
  complete: boolean;
  /** True when this turn closed the topic thread (turn.closeTopic) — distinct from `complete`,
   *  which only fires the one time this closing *also* transitions the whole flow step (see
   *  isFlowStepComplete's own comment). A topic can close without the step completing in two
   *  cases: mid-way through the required/core set (tier hasn't reached Sketch yet — rare in
   *  practice since the gap-closer questions are strong single-question signal, but possible),
   *  and — the case that actually surfaced this — a bonus/optional topic closing long after the
   *  step first completed (profile-review's "Answer one more question"). Either way, there's no
   *  active thread left to reply to; deep-prompts.routes.ts surfaces this so the frontend can show
   *  a distinct "thanks for sharing, come back anytime" state instead of leaving a composer that
   *  would just 400 (NO_ACTIVE_TOPIC) on the next message. */
  topicClosed: boolean;
  /** The refreshed flow_progress row, present exactly when this turn changed
   *  steps_state.deep_prompts — either completing it for the first time (`complete: true`) or
   *  restoring it after an ad hoc correction thread closed (see postUserMessage's own comment).
   *  deep-prompts.routes.ts forwards this verbatim; undefined means nothing to forward. */
  progress?: FlowProgress;
}

/**
 * Personality engine (docs/personality-analysis-engine-spec.md §3/§5, tracked in
 * docs/personality-engine-implementation-plan.md Iteration 3). The deep_prompts-only sibling to
 * ConversationService: same external shape (ensureOpeningExchanges/postUserMessage returning
 * Message-shaped payloads) so deep-prompts.routes.ts's GET /open and POST /message can call this
 * service the same way logistics.routes.ts calls ConversationService, without a bigger rewrite,
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
  private flow = new FlowService();

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
   *  question or mid-thread" — this is that action, candidate-initiated. sendScheduledPrompt
   *  below is the *proactive* counterpart (Iteration 9's weekly scheduler), which composes its
   *  own content rather than re-sending an existing exchange verbatim. Re-sends the active
   *  thread's most recent assistant exchange
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

    const lastAssistant = await this.resendPendingQuestionByEmail(thread);
    return this.toMessage(lastAssistant, thread);
  }

  /** Step 5's channel picker (mirrors LogisticsService/InboxService's pattern — see
   *  docs/deep-prompts-email-channel-gap-assessment.md). Unlike logistics, the choice persists
   *  on flow_progress.deep_prompts_channel (set by the caller, deep-prompts.routes.ts) and every
   *  subsequent topic opens on it by default; this method is what happens the moment the
   *  candidate picks or changes it. Returns the active/just-opened topic's full exchange history
   *  either way, so the frontend has something to render immediately. */
  async chooseChannel(userId: string, channel: Channel): Promise<Message[]> {
    const active = await this.getActiveThread(userId);
    if (active) {
      if (channel === 'email') {
        await this.resendPendingQuestionByEmail(active);
      }
      const exchanges = await this.getExchanges(active.id);
      return exchanges.map((e) => this.toMessage(e, active));
    }

    const question = await this.selection.selectNextQuestion(userId);
    const thread = await this.openThread(userId, question.id);
    const opener = await this.insertExchange(thread.id, 'assistant', question.prompt, channel);
    if (channel === 'email') {
      await this.email.deliverForTopic(thread, opener.text);
    }
    return [this.toMessage(opener, thread)];
  }

  /** Read-only view for the frontend's initial load / manual refresh of the email-thread UI — no
   *  nudge computation like InboxService.getInbox has, since deep_prompts has no nudge concept of
   *  its own (the weekly scheduler already handles proactive re-engagement, per the addendum). */
  async getActiveThreadView(userId: string): Promise<{ channel: Channel; messages: Message[]; threadStatus: TopicThread['status'] | null }> {
    const progress = await db('flow_progress').where({ user_id: userId }).first();
    const channel: Channel = progress?.deep_prompts_channel ?? 'app';

    const active = await this.getActiveThread(userId);
    if (!active) {
      return { channel, messages: [], threadStatus: null };
    }

    const messages = (await this.getExchanges(active.id)).map((e) => this.toMessage(e, active));
    return { channel, messages, threadStatus: active.status };
  }

  /** Re-sends the active thread's most recent assistant exchange (the question currently awaiting
   *  an answer) as a real email — shared by switchActiveTopicToEmail and chooseChannel's
   *  active-thread branch. Doesn't insert a new exchange or touch thread continuity. */
  private async resendPendingQuestionByEmail(thread: TopicThread): Promise<Exchange> {
    const exchanges = await this.getExchanges(thread.id);
    const lastAssistant = [...exchanges].reverse().find((e) => e.role === 'assistant');
    if (!lastAssistant) {
      throw new AppError('NO_PENDING_QUESTION', 'Nothing to send yet — this topic has no question pending a reply.', 400);
    }

    await this.email.deliverForTopic(thread, lastAssistant.text);
    return lastAssistant;
  }

  /** Weekly scheduler's send primitive (Iteration 9, spec §3.5) — never called from the reply
   *  path (postUserMessage), only from weekly-scheduler.service.ts's own proactive checks; kept
   *  as its own method rather than reusing postUserMessage's machinery because a scheduled prompt
   *  has no user reply to react to and no topic-close/aggregation/tier-recompute of its own to
   *  trigger. `threadId: null` opens a fresh thread for `questionId` (the "new question" payload);
   *  a real `threadId` appends to an existing one (the "continue" / "offer to close" payloads) —
   *  either way the message is both persisted as a real exchange and actually emailed. */
  async sendScheduledPrompt(userId: string, threadId: string | null, content: string, questionId?: string): Promise<Message> {
    const thread = threadId ? await db('topic_thread').where({ id: threadId }).first() : await this.openThread(userId, questionId!);
    if (!thread) {
      throw new AppError('NOT_FOUND', `No topic_thread with id ${threadId}`, 404);
    }

    const exchange = await this.insertExchange(thread.id, 'assistant', content, 'email');
    await this.email.deliverForTopic(thread, content);
    return this.toMessage(exchange, thread);
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

    // Spec §3.5: "returning is a single click from any prior email or from the site" — any real
    // reply re-engages a dormant candidate automatically, not just an explicit "resume" action.
    // Fire-and-forget: never worth failing or delaying the turn itself over.
    this.progression.clearDormancy(userId).catch((error) => {
      console.warn(`[topic-conversation.service] clearDormancy failed for user ${userId}:`, error.message || error);
    });

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
    const evidenceSource = { questionId: question.id, heavy: question.heavy };
    const extraction = this.scoring
      .extractAndPersist(userExchange.id, question.prompt, content, dimensions, question.heavy)
      .then((rows) => {
        // Indexed for RAG (spec §8/Iteration 8) as its own fire-and-forget step, same posture as
        // indexDeepPromptSubstrate below — never gates the turn.
        this.evidence.indexDimensionEvidenceSpans(userId, rows, evidenceSource).catch((error) => {
          console.warn(`[topic-conversation.service] dimension-evidence indexing failed for user ${userId}:`, error.message || error);
        });
        return rows;
      })
      .catch((error) => {
        console.warn(`[topic-conversation.service] evidence extraction failed for user ${userId}:`, error.message || error);
      });

    this.evidence
      .indexDeepPromptSubstrate(userId, this.toMessage(userExchange, thread), this.toMessage(assistantExchange, thread), evidenceSource)
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

    // Whether/how this turn should move flow_progress.steps_state.deep_prompts, decided here (the
    // one place that has both the thread's type and the turn's outcome) rather than split between
    // this service's `complete` flag and the route deciding whether to act on it — that split is
    // exactly what caused the "message box disappears after a bonus follow-up" bug and this ad hoc
    // one, both fixed by ad-hoc-ing another special case into the route/frontend instead of fixing
    // the one place that should own this decision. Two distinct, non-overlapping triggers:
    //  - A library-question thread reaching tier != 'none' for the first time (existing
    //    isFlowStepComplete heuristic) — the *original* step completing. `complete` (below) stays
    //    true only for this case, since it also drives the chat UI's "Step complete" banner text,
    //    which would be a misleading thing to show for an ad hoc correction thread's close.
    //  - An ad hoc thread closing (turn.closeTopic) — never "completes" the step (it was already
    //    complete; that's *why* profile.service.ts could open a correction against it in the first
    //    place), it only *restores* steps_state.deep_prompts (and current_step, which reopenStep
    //    moved to 'deep_prompts') now that the thread reopened for is done. completeStep is safe to
    //    call here even though nothing "newly completed": current_step is already 'deep_prompts' at
    //    this point, so its own "don't regress if we're already past this step" guard doesn't apply
    //    and it correctly advances back to wherever comes next (profile_review).
    let complete = false;
    let progress: FlowProgress | undefined;
    if (thread.ad_hoc_dimensions == null) {
      complete = await this.isFlowStepComplete(userId);
      if (complete) progress = await this.flow.completeStep(userId, 'deep_prompts');
    } else if (turn.closeTopic) {
      progress = await this.flow.completeStep(userId, 'deep_prompts');
    }

    return {
      assistantMessage: this.toMessage(assistantExchange, thread),
      complete,
      topicClosed: turn.closeTopic,
      progress
    };
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

    // Presence of the column (even an empty array) is what marks this thread as ad hoc — a
    // library-opened thread never sets it (stays null). An older/non-personality-engine insight's
    // re-ask legitimately has zero target dimensions (see profile.service.ts's
    // reaskDimensionsFor), so `?.length` here would wrongly fall through to the "unknown
    // question" error below for exactly the case this branch exists to handle.
    if (thread.ad_hoc_dimensions != null) {
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

  /** Flow addendum §2: Step 5 completes in flow_progress the moment progression.tier *first*
   *  reaches Sketch (any dimension at medium confidence) — not a fixed question count, and,
   *  per that same wording, a one-time transition, not "for as long as tier stays above none."
   *  Real tier lookup as of Iteration 5 (progression.service.ts); the placeholder this replaced
   *  ("core set closed") is gone. Callers (deep-prompts.routes.ts) didn't need to change.
   *
   *  The `steps_state` check guards exactly that one-time-ness: once tier has ever left 'none' it
   *  stays there, so without this guard every later turn — including a deliberate bonus/optional
   *  question from profile-review's "Answer one more question" banner, long after this step first
   *  completed — would also report `complete: true`. The frontend's chat-panel treats that as
   *  terminal (hides the composer, shows the "done" banner) the moment it sees it once; a bonus
   *  question's own follow-up reply would then arrive with nowhere for the candidate to type a
   *  reply. Reporting false once the step is already marked complete keeps the composer usable
   *  for as many optional follow-ups as the candidate wants — flowService.completeStep is a no-op
   *  past that point anyway (steps_state.deep_prompts is already 'complete'), so this doesn't
   *  change what actually gets persisted, only what gets reported back to the frontend. */
  private async isFlowStepComplete(userId: string): Promise<boolean> {
    const [progressRow, progressionRow] = await Promise.all([
      db('flow_progress').where({ user_id: userId }).first(),
      db('progression').where({ user_id: userId }).first()
    ]);
    if (progressRow?.steps_state?.deep_prompts === 'complete') return false;
    return !!progressionRow && progressionRow.tier !== 'none';
  }
}
