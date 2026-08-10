import { db } from '../db/connection';
import { AppError, ConversationThread, Message } from '../types';
import { config } from '../config';
import { ConversationService } from './conversation.service';

export interface InboxView {
  thread: ConversationThread | null;
  messages: Message[];
  needsNudge: boolean;
  hoursSinceLastMessage: number | null;
}

/**
 * Simulated email channel for Step 3/4. There is no real mail server here — the "inbox" is an
 * in-app view over the same conversation_threads/messages rows the app-channel chat uses, styled
 * as a thread so the async affordance (reply when convenient, pick it back up from the app) is
 * real even though delivery isn't wired to actual SMTP/IMAP for this prototype.
 */
export class InboxService {
  private conversation = new ConversationService();

  async getInbox(userId: string): Promise<InboxView> {
    const thread = await db('conversation_threads').where({ user_id: userId, step: 'logistics' }).first();

    if (!thread || thread.channel !== 'email') {
      return { thread: null, messages: [], needsNudge: false, hoursSinceLastMessage: null };
    }

    const messages = await this.conversation.getHistory(userId, 'logistics');
    const lastMessageAt = thread.last_message_at ? new Date(thread.last_message_at) : null;
    const hoursSinceLastMessage = lastMessageAt ? (Date.now() - lastMessageAt.getTime()) / (1000 * 60 * 60) : null;

    const lastNudgeAt = thread.last_nudge_at ? new Date(thread.last_nudge_at) : null;
    const nudgeIsStale = !lastNudgeAt || (lastMessageAt && lastNudgeAt < lastMessageAt);

    const needsNudge =
      thread.status === 'awaiting_reply' &&
      hoursSinceLastMessage !== null &&
      hoursSinceLastMessage >= config.flow.emailSilenceHours &&
      !!nudgeIsStale;

    return { thread, messages, needsNudge, hoursSinceLastMessage };
  }

  /** Opens the email thread, generating the first "email" if none exists yet. */
  async openThread(userId: string): Promise<Message[]> {
    return this.conversation.ensureOpeningMessage(userId, 'logistics', 'email');
  }

  async reply(userId: string, content: string) {
    return this.conversation.postUserMessage(userId, 'logistics', 'email', content);
  }

  /** No scheduler in this prototype — a nudge is composed the next time the candidate opens the inbox. */
  async sendNudge(userId: string): Promise<Message> {
    const thread = await db('conversation_threads').where({ user_id: userId, step: 'logistics' }).first();
    if (!thread || thread.channel !== 'email') {
      throw new AppError('NOT_FOUND', 'No email thread found', 404);
    }

    const lastQuestion = await db('messages')
      .where({ user_id: userId, step: 'logistics', role: 'assistant' })
      .orderBy('created_at', 'desc')
      .first();

    const nudgeContent = lastQuestion
      ? `Just checking in — no rush at all. Whenever you have a few minutes: ${lastQuestion.content}`
      : 'Just checking in — whenever you have a few minutes, we\'d love to hear from you.';

    const [message] = await db('messages')
      .insert({
        thread_id: thread.id,
        user_id: userId,
        role: 'assistant',
        content: nudgeContent,
        channel: 'email',
        step: 'logistics',
        metadata: { nudge: true }
      })
      .returning('*');

    await db('conversation_threads').where({ id: thread.id }).update({ last_nudge_at: new Date(), updated_at: new Date() });

    return message;
  }
}
