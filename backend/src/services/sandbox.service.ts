import { db } from '../db/connection';
import { AppError, SandboxMessage } from '../types';
import { runSandboxChat } from '../ai/sandbox-chat.chain';

/**
 * Step 7 — and, via the identical `runSandboxChat` call, Step 8's public share link. Both talk
 * to the same approved profile the same way; this service owns only the candidate's own,
 * authenticated practice runs (sandbox_messages). The public share path reuses the chain
 * directly (see share.service.ts) since it isn't tied to a logged-in user.
 */
export class SandboxService {
  async getHistory(userId: string): Promise<SandboxMessage[]> {
    return db('sandbox_messages').where({ user_id: userId }).orderBy('created_at', 'asc');
  }

  async postMessage(userId: string, content: string): Promise<{ userMessage: SandboxMessage; assistantMessage: SandboxMessage }> {
    const profile = await db('candidate_profiles').where({ user_id: userId }).first();
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Generate and approve a profile before trying the sandbox.', 400);
    }

    const [userMessage] = await db('sandbox_messages')
      .insert({ user_id: userId, role: 'user', content })
      .returning('*');

    const history = await this.getHistory(userId);
    const reply = await runSandboxChat({
      profile: profile.profile_data,
      history: history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      question: content
    });

    const [assistantMessage] = await db('sandbox_messages')
      .insert({ user_id: userId, role: 'assistant', content: reply })
      .returning('*');

    return { userMessage, assistantMessage };
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
