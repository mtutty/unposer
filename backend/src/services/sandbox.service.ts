import { db } from '../db/connection';
import { AppError, ProfileData, SandboxCitation, SandboxMessage } from '../types';
import { config } from '../config';

/**
 * Step 7 — and, via the identical sandbox-chat chain, Step 8's public share link. Both talk to
 * the same approved profile the same way; this service owns only the candidate's own,
 * authenticated practice runs (sandbox_messages). The public share path reuses the chain
 * directly (see share.service.ts) since it isn't tied to a logged-in user.
 */
export class SandboxService {
  async getHistory(userId: string): Promise<SandboxMessage[]> {
    return db('sandbox_messages').where({ user_id: userId }).orderBy('created_at', 'asc');
  }

  /** Same as getHistory, but capped to the most recent `limit` messages — used only for what
   *  actually gets sent to the LLM each turn (see beginMessage below), not the GET /sandbox route
   *  that shows the candidate their full history. sandbox_messages has no thread/cap concept the
   *  way conversation_threads does, so this is the only bound on per-turn context size; the
   *  profile digest + evidence-search tool (see sandbox-chat.chain.ts) carry durable memory
   *  beyond this window, not raw replay. */
  async getRecentHistory(userId: string, limit: number): Promise<SandboxMessage[]> {
    const rows = await db('sandbox_messages').where({ user_id: userId }).orderBy('created_at', 'desc').limit(limit);
    return rows.reverse();
  }

  /**
   * Persists the candidate's question and hands back everything streamSandboxChat needs to
   * generate a reply. Split from saveAssistantMessage below (rather than one postMessage like
   * before streaming) so the route can insert the user's row, open the response stream, and only
   * persist the assistant's reply once it's fully accumulated — see sandbox.routes.ts.
   */
  async beginMessage(
    userId: string,
    content: string
  ): Promise<{ profile: ProfileData; history: Array<{ role: 'user' | 'assistant'; content: string }> }> {
    const profile = await db('candidate_profiles').where({ user_id: userId }).first();
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Generate and approve a profile before trying the sandbox.', 400);
    }

    await db('sandbox_messages').insert({ user_id: userId, role: 'user', content });

    // Includes the row just inserted above — drop it since the chain takes it separately as
    // `question`, not as the last turn of `history`. Windowed rather than the full unbounded
    // history — see getRecentHistory above.
    const history = await this.getRecentHistory(userId, config.flow.sandboxHistoryWindow);
    return {
      profile: profile.profile_data,
      history: history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
    };
  }

  async saveAssistantMessage(userId: string, content: string): Promise<SandboxMessage> {
    const [assistantMessage] = await db('sandbox_messages')
      .insert({ user_id: userId, role: 'assistant', content })
      .returning('*');
    return assistantMessage;
  }

  /** Backfills citations onto an already-saved (and already-shown) reply — run as a follow-up
   *  after the fact, see identifySandboxCitations, so the visible answer never waits on it. */
  async saveCitations(messageId: string, citations: SandboxCitation[]): Promise<SandboxMessage> {
    const [message] = await db('sandbox_messages').where({ id: messageId }).update({ citations }).returning('*');
    return message;
  }

  /** Marks the triggering exchange as a surfaced gap; routing it back to Step 5/6 happens in the route. */
  async flagGap(userId: string, messageId: string, note: string): Promise<SandboxMessage> {
    const [message] = await db('sandbox_messages')
      .where({ id: messageId, user_id: userId })
      .update({ flagged_gap: true, gap_note: note })
      .returning('*');

    if (!message) {
      throw new AppError('NOT_FOUND', 'Sandbox message not found', 404);
    }

    return message;
  }
}
