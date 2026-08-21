import { db } from '../db/connection';
import { AppError, ConversationThread, Message } from '../types';
import { config } from '../config';
import { ConversationService } from './conversation.service';
import { EmailService } from './email.service';

export interface InboxView {
  thread: ConversationThread | null;
  messages: Message[];
  needsNudge: boolean;
  hoursSinceLastMessage: number | null;
}

/**
 * In-app view of the Step 3/4 email channel — the "inbox" is the same conversation_threads/
 * messages rows the app-channel chat uses, styled as a thread so the candidate can pick it back
 * up from the app exactly as it looks in their real inbox. Real delivery (the opener, nudges,
 * and replies to genuine inbound email) goes through EmailService/webhooks.routes.ts; this class
 * doesn't send email itself except by delegating to EmailService at the specific points where
 * the candidate's real inbox needs to hear from us — see openThread/sendNudge below.
 */
export class InboxService {
  private conversation = new ConversationService();
  private email = new EmailService();

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

  /** Opens the email thread, generating the first "email" if none exists yet — and, unlike a
   *  reply typed into the in-app inbox (see `reply` below), actually sends that opener as a real
   *  email: it's the candidate's only way to ever receive something to reply to in their real
   *  inbox. */
  async openThread(userId: string): Promise<Message[]> {
    const before = await this.conversation.getHistory(userId, 'logistics');
    const messages = await this.conversation.ensureOpeningMessage(userId, 'logistics', 'email');

    if (before.length === 0 && messages.length > 0) {
      const thread = await this.conversation.getOrCreateThread(userId, 'logistics', 'email');
      await this.email.deliver(thread, messages[0]);
    }

    return messages;
  }

  /** A reply typed into the in-app inbox view. Deliberately stays in-app only — the response is
   *  just returned here and rendered in the UI, never re-emailed — so the real inbox only ever
   *  hears from us via the opener above, a genuine inbound-email reply, or a nudge. */
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

    // Nudging a stalled email thread only does anything if it actually reaches the candidate's
    // real inbox — showing it in-app alone does nothing for someone who's gone silent on email.
    await this.email.deliver(thread, message);

    return message;
  }
}
