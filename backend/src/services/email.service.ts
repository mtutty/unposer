import { Resend } from 'resend';
import { db } from '../db/connection';
import { config } from '../config';
import { getStep } from '../models/flow-steps';
import { ConversationThread, Message } from '../types';

let client: Resend | null = null;
function resend(): Resend {
  if (!client) {
    client = new Resend(config.email.resendApiKey);
  }
  return client;
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
  async deliver(
    thread: ConversationThread,
    message: Message,
    opts: { inReplyToMessageId?: string | null } = {}
  ): Promise<void> {
    if (!config.email.enabled) {
      console.log(
        `[email.service] (disabled — no RESEND_API_KEY/RESEND_WEBHOOK_SECRET) would send ${thread.step} email ` +
          `to user ${thread.user_id}: ${message.content.slice(0, 80)}${message.content.length > 80 ? '…' : ''}`
      );
      return;
    }

    const user = await db('users').where({ id: thread.user_id }).first();
    if (!user) {
      console.warn(`[email.service] no user found for thread ${thread.id}, skipping send`);
      return;
    }

    const inReplyTo = opts.inReplyToMessageId || thread.last_inbound_message_id || undefined;
    const stepDef = getStep(thread.step);

    try {
      const { data, error } = await resend().emails.send({
        from: config.email.fromAddress,
        to: user.email,
        replyTo: `reply+${thread.inbound_token}@${config.email.inboundDomain}`,
        subject: `${inReplyTo ? 'Re: ' : ''}${stepDef.name} — Unposer`,
        text: message.content,
        headers: inReplyTo ? { 'In-Reply-To': inReplyTo, References: inReplyTo } : undefined
      });

      if (error) {
        console.error(`[email.service] Resend send failed for thread ${thread.id}:`, error);
        return;
      }

      await db('conversation_threads')
        .where({ id: thread.id })
        .update({ last_outbound_message_id: data?.id ?? null, updated_at: new Date() });
    } catch (err: any) {
      // Best-effort delivery, not part of the elicitation transaction — a Resend outage should
      // never appear to break a conversation turn that already succeeded and was persisted.
      console.error(`[email.service] unexpected error sending email for thread ${thread.id}:`, err.message || err);
    }
  }
}
