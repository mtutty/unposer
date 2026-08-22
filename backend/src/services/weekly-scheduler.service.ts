import { db } from '../db/connection';
import { config } from '../config';
import { Progression } from '../types';
import { getQuestion } from '../models/question-library';
import { TopicSelectionService } from './topic-selection.service';
import { TopicConversationService } from './topic-conversation.service';

// Personality engine (spec §3.5 "Re-engagement cadence", tracked in
// docs/personality-engine-implementation-plan.md Iteration 9). Deliberately its own module,
// separate from topic-conversation.service.ts's reply-handling path — the spec's own explicit
// concern ("keep prompt-sending isolated enough at the module level that it could be split to a
// different sender later without breaking threading") is about *this* class never being called
// from the reply path and vice versa, even though both currently run in the same `api` process
// and both ultimately call email.service.ts. See weekly-scheduler.cron.ts for what actually
// triggers runWeeklyCheck on a schedule.

const OFFER_TO_CLOSE_AFTER_DAYS = 21;
const CADENCE_DAYS = 7;
const DORMANCY_THRESHOLD = 4;

export interface WeeklyCheckResult {
  processed: number;
  sent: number;
  wentDormant: number;
}

export class WeeklySchedulerService {
  private selection = new TopicSelectionService();
  private topicConversation = new TopicConversationService();

  /** The one entry point the cron trigger calls. Safe to call more than once in a day — every
   *  user it touches is independently re-checked against the same eligibility gates, so a second
   *  run within the same week is a no-op for everyone it already sent to (see
   *  `isDueForContact` — "never a second email in the same week" is enforced here, not by
   *  trusting the cron schedule alone). */
  async runWeeklyCheck(): Promise<WeeklyCheckResult> {
    const candidates = await this.loadEligibleCandidates();
    let sent = 0;
    let wentDormant = 0;

    for (const progression of candidates) {
      const outcome = await this.processCandidate(progression);
      if (outcome === 'sent') sent++;
      if (outcome === 'dormant') wentDormant++;
    }

    return { processed: candidates.length, sent, wentDormant };
  }

  /** Every progression row that *could* be due — pause/unsubscribe/dormancy/cadence are re-
   *  checked per-candidate in processCandidate rather than folded entirely into this SQL, since
   *  the "did they reply since last contact" check needs its own query per user anyway. */
  private async loadEligibleCandidates(): Promise<Progression[]> {
    const cutoff = new Date(Date.now() - CADENCE_DAYS * 24 * 60 * 60 * 1000);
    return db('progression')
      .where('tier', '!=', 'none')
      .whereNull('unsubscribed_at')
      .whereNull('dormant_at')
      .where((qb) => qb.whereNull('paused_until').orWhere('paused_until', '<', new Date()))
      .where('paused_indefinitely', false)
      .where((qb) => qb.whereNull('last_contact_at').orWhere('last_contact_at', '<', cutoff))
      .select('*');
  }

  private async processCandidate(progression: Progression): Promise<'sent' | 'dormant' | 'skipped'> {
    const repliedSinceLastContact = progression.last_contact_at ? await this.hasRepliedSince(progression.user_id, progression.last_contact_at) : true;

    if (progression.last_contact_at && !repliedSinceLastContact) {
      const unansweredCount = progression.unanswered_count + 1;
      if (unansweredCount >= DORMANCY_THRESHOLD) {
        await db('progression').where({ id: progression.id }).update({ unanswered_count: unansweredCount, dormant_at: new Date() });
        return 'dormant';
      }
      await db('progression').where({ id: progression.id }).update({ unanswered_count: unansweredCount });
    } else if (repliedSinceLastContact) {
      await db('progression').where({ id: progression.id }).update({ unanswered_count: 0 });
    }

    await this.sendPayload(progression.user_id);
    await db('progression').where({ id: progression.id }).update({ last_contact_at: new Date() });
    return 'sent';
  }

  private async hasRepliedSince(userId: string, since: Date): Promise<boolean> {
    const threads: { id: string }[] = await db('topic_thread').where({ user_id: userId }).select('id');
    if (threads.length === 0) return false;
    const reply = await db('exchange')
      .whereIn(
        'thread_id',
        threads.map((t) => t.id)
      )
      .where({ role: 'user' })
      .where('sent_at', '>', since)
      .first();
    return !!reply;
  }

  /** §3.5's payload table: continue an active thread, open a new question, or offer to close a
   *  stale one — in that priority order. Every branch funnels through sendWithSettingsFooter
   *  rather than calling topicConversation.sendScheduledPrompt directly, so the "link back to the
   *  site for pace controls, suspend, and unsubscribe" §3.5 requires can't be missed by a new
   *  branch added later. */
  private async sendPayload(userId: string): Promise<void> {
    const openThread = await db('topic_thread').where({ user_id: userId, status: 'open' }).orderBy('opened_at', 'desc').first();

    if (!openThread) {
      const question = await this.selection.selectNextQuestion(userId);
      await this.sendWithSettingsFooter(userId, null, question.prompt, question.id);
      return;
    }

    const lastExchange = await db('exchange').where({ thread_id: openThread.id }).orderBy('sent_at', 'desc').first();
    const daysIdle = lastExchange ? (Date.now() - new Date(lastExchange.sent_at).getTime()) / (24 * 60 * 60 * 1000) : Infinity;

    if (daysIdle > OFFER_TO_CLOSE_AFTER_DAYS) {
      const nextQuestion = await this.selection.selectNextQuestion(userId);
      const topicName = getQuestion(openThread.question_id)?.shortName ?? 'that topic';
      const content =
        `Shall we call "${topicName}" done for now? No worries either way — there's no wrong answer here. ` +
        `If you're up for something new in the meantime: ${nextQuestion.prompt}`;
      await this.sendWithSettingsFooter(userId, openThread.id, content);
      return;
    }

    // Continue — quotes the candidate's own last answer for context (spec §3.5), composed
    // directly rather than via an LLM call: a weekly nudge doesn't need the full topic-
    // elicitation reasoning runTopicTurn does for a live reply-driven turn.
    const lastUserExchange = await db('exchange').where({ thread_id: openThread.id, role: 'user' }).orderBy('sent_at', 'desc').first();
    const quote = lastUserExchange ? truncate(lastUserExchange.text, 200) : null;
    const content = quote
      ? `Last time you told us: "${quote}" — want to add more to that, or is that complete for now? Either way is fine.`
      : "Still curious to hear more on this one whenever you're ready — no rush.";
    await this.sendWithSettingsFooter(userId, openThread.id, content);
  }

  /** "Every email carries a link back to the site for pace controls, suspend, and unsubscribe"
   *  (spec §3.5). The link is the authenticated settings page (frontend/.../schedule-settings) —
   *  no unauthenticated per-token magic-link action, since these controls read/write the
   *  candidate's own progression row and the candidate already has a real session on every
   *  device they've logged into. Landing on the login screen first when a stale session has
   *  expired is an acceptable cost for not building and securing a separate magic-link mechanism. */
  private async sendWithSettingsFooter(userId: string, threadId: string | null, content: string, questionId?: string): Promise<void> {
    const settingsUrl = `${config.frontendUrl}/settings/schedule`;
    const withFooter = `${content}\n\n— \nManage how often we reach out, pause, or unsubscribe: ${settingsUrl}`;
    await this.topicConversation.sendScheduledPrompt(userId, threadId, withFooter, questionId);
  }
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}
