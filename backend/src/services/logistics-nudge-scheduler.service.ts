import { db } from '../db/connection';
import { ConversationThread } from '../types';
import { InboxService, threadNeedsNudge } from './inbox.service';

// Closes the Step 3 (logistics) known gap named in CLAUDE.md's Known TODOs and
// docs/system-test-plan.md's "Known gaps" section: "a nudge is composed the next time the
// candidate opens the inbox, not proactively." Deliberately a *different* mechanism from
// weekly-scheduler.service.ts (Iteration 9), which only covers Step 5 (topic_thread) — Step 3's
// stall/silence/nudge bookkeeping lives on conversation_threads, a different table with a
// different cadence (hours, not weeks; see config.flow.emailSilenceHours), and no `progression`
// row to key off. Kept as its own small service rather than folded into InboxService itself, same
// module-separation reasoning the weekly scheduler's own file comment already established: the
// *what* of a nudge (InboxService.sendNudge) stays reusable by both the on-demand and proactive
// paths, and only the *when* (this class + its own cron trigger) differs.
export interface LogisticsNudgeCheckResult {
  processed: number;
  nudged: number;
}

export class LogisticsNudgeSchedulerService {
  private inbox = new InboxService();

  /** The one entry point the cron trigger calls. Safe to call more than once in a short window —
   *  threadNeedsNudge (shared with InboxService.getInbox's own in-app indicator) is re-evaluated
   *  fresh against each thread's current last_message_at/last_nudge_at, so a thread just nudged
   *  by this same run (or by the candidate's own manual "send nudge" click moments earlier) is
   *  correctly excluded from a re-run rather than double-nudged. */
  async runCheck(): Promise<LogisticsNudgeCheckResult> {
    const candidates = await this.loadStalledThreads();
    let nudged = 0;

    for (const thread of candidates) {
      try {
        await this.inbox.sendNudge(thread.user_id);
        nudged++;
      } catch (error: any) {
        // One candidate's failure (e.g. a transient email-provider error) shouldn't stop the
        // rest of the run — same posture as every other fire-and-forget background job in this
        // codebase (evidence indexing, culture-signal regeneration).
        console.warn(`[logistics-nudge-scheduler] sendNudge failed for user ${thread.user_id}:`, error.message || error);
      }
    }

    return { processed: candidates.length, nudged };
  }

  /** Every awaiting-reply logistics email thread, narrowed to the ones threadNeedsNudge actually
   *  calls due — filtered in JS against the same predicate getInbox uses, rather than
   *  re-expressing the silence-hours/nudge-staleness math as a second SQL WHERE clause that could
   *  quietly drift from it over time. The DB filter here is just the cheap, obviously-safe
   *  narrowing (right step/channel/status); every thread it returns still needs the real
   *  time-based check. */
  private async loadStalledThreads(): Promise<ConversationThread[]> {
    const threads: ConversationThread[] = await db('conversation_threads')
      .where({ step: 'logistics', channel: 'email', status: 'awaiting_reply' })
      .select('*');
    return threads.filter((thread) => threadNeedsNudge(thread));
  }
}
