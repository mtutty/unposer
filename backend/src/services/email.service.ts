import { Resend } from 'resend';
import { db } from '../db/connection';
import { config } from '../config';
import { getStep } from '../models/flow-steps';
import { getQuestion } from '../models/question-library';
import { ConversationThread, Message, TopicThread } from '../types';

let client: Resend | null = null;
function resend(): Resend {
  if (!client) {
    client = new Resend(config.email.resendApiKey);
  }
  return client;
}

interface SendParams {
  logLabel: string;
  userId: string;
  inboundToken: string;
  subject: string;
  body: string;
  inReplyTo: string | undefined;
  onSent: (resendMessageId: string | null) => Promise<void>;
}

/**
 * Outbound half of the real email gateway (backend/src/routes/webhooks.routes.ts is the inbound
 * half). Direct Resend-backed service, not a swappable provider factory — like embeddings.ts,
 * this is a deliberate exception to the provider-agnostic principle: inbound routing (the
 * `reply+<token>@` address scheme, the Received Emails API fetch) is Resend-specific enough that
 * a generic abstraction would be speculative, not reusable.
 */
export class EmailService {
  /**
   * Sends `message` as a real email on `thread`'s channel. Called for every system/AI-generated
   * message on an email-channel thread — the elicitation opener, a reply to a genuine inbound
   * email, and silence nudges — but deliberately NOT for the response to a reply typed into the
   * in-app inbox view (see inbox.routes.ts POST /reply, which never calls this).
   *
   * No-ops (logs only) when config.email.enabled is false, so nothing breaks locally without a
   * Resend account — same safe-default pattern as devAuth.enabled.
   */
  async deliver(thread: ConversationThread, message: Message, opts: { inReplyToMessageId?: string | null } = {}): Promise<void> {
    const stepDef = getStep(thread.step);
    await this.send({
      logLabel: `${thread.step} email`,
      userId: thread.user_id,
      inboundToken: thread.inbound_token,
      subject: stepDef.name,
      body: message.content,
      inReplyTo: opts.inReplyToMessageId || thread.last_inbound_message_id || undefined,
      onSent: async (resendMessageId) => {
        await db('conversation_threads')
          .where({ id: thread.id })
          .update({ last_outbound_message_id: resendMessageId, updated_at: new Date() });
      }
    });
  }

  /** Step 5's per-topic email channel (flow addendum §3, Iteration 6) — same delivery mechanics
   *  as `deliver` above, generalized off `topic_thread`/plain content instead of
   *  `conversation_threads`/`Message`, since a topic thread's "subject" is the question, not a
   *  fixed step name, and there's no `Message` row shape to reuse (the caller already has the
   *  text it wants sent). Subject falls back to "Your Stories" for an ad hoc re-ask thread, which
   *  has no LibraryQuestion to name it after. */
  async deliverForTopic(thread: TopicThread, content: string, opts: { inReplyToMessageId?: string | null } = {}): Promise<void> {
    const subject = getQuestion(thread.question_id)?.shortName ?? 'Your Stories';
    await this.send({
      logLabel: 'deep_prompts topic email',
      userId: thread.user_id,
      inboundToken: thread.inbound_token,
      subject,
      body: content,
      inReplyTo: opts.inReplyToMessageId || thread.last_inbound_message_id || undefined,
      onSent: async (resendMessageId) => {
        await db('topic_thread')
          .where({ id: thread.id })
          .update({ last_outbound_message_id: resendMessageId, updated_at: new Date() });
      }
    });
  }

  private async send(params: SendParams): Promise<void> {
    if (!config.email.enabled) {
      console.log(
        `[email.service] (disabled — no RESEND_API_KEY/RESEND_WEBHOOK_SECRET) would send ${params.logLabel} ` +
          `to user ${params.userId}: ${params.body.slice(0, 80)}${params.body.length > 80 ? '…' : ''}`
      );
      return;
    }

    const user = await db('users').where({ id: params.userId }).first();
    if (!user) {
      console.warn(`[email.service] no user found for ${params.userId}, skipping send`);
      return;
    }

    try {
      const { data, error } = await resend().emails.send({
        from: config.email.fromAddress,
        to: user.email,
        replyTo: `reply+${params.inboundToken}@${config.email.inboundDomain}`,
        subject: `${params.inReplyTo ? 'Re: ' : ''}${params.subject} — Unposer`,
        text: params.body,
        headers: params.inReplyTo ? { 'In-Reply-To': params.inReplyTo, References: params.inReplyTo } : undefined
      });

      if (error) {
        console.error(`[email.service] Resend send failed for ${params.logLabel} (user ${params.userId}):`, error);
        return;
      }

      await params.onSent(data?.id ?? null);
    } catch (err: any) {
      // Best-effort delivery, not part of the elicitation transaction — a Resend outage should
      // never appear to break a conversation turn that already succeeded and was persisted.
      console.error(`[email.service] unexpected error sending ${params.logLabel} (user ${params.userId}):`, err.message || err);
    }
  }
}
