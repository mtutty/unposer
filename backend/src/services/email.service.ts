import fs from 'fs';
import path from 'path';
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

/**
 * Writes one full email as a .txt file under config.email.spoolDir instead of actually sending
 * it — every outbound call in this file goes through here whenever `config.email.enabled` is
 * false (always outside NODE_ENV=production, regardless of what Resend creds happen to be
 * configured — see that config comment). Replaces the old truncated-to-80-chars console.log: the
 * whole point is being able to open the file and read the real content. Best-effort like every
 * other send path here — a spool failure (e.g. an unwritable dir) logs and moves on rather than
 * failing the turn that already succeeded and was persisted.
 */
function spoolEmail(params: { to: string; subject: string; body: string; replyTo?: string; headers?: Record<string, string> }): void {
  try {
    fs.mkdirSync(config.email.spoolDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = params.to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(config.email.spoolDir, `${stamp}_${safeTo}.txt`);

    const lines = [
      `To: ${params.to}`,
      `From: ${config.email.fromAddress}`,
      params.replyTo ? `Reply-To: ${params.replyTo}` : null,
      ...Object.entries(params.headers ?? {}).map(([key, value]) => `${key}: ${value}`),
      `Subject: ${params.subject}`,
      '',
      params.body,
      ''
    ].filter((line): line is string => line !== null);

    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    console.log(`[email.service] spooled (not sent — config.email.enabled is false) to ${file}`);
  } catch (err: any) {
    console.error('[email.service] failed to spool email to disk:', err.message || err);
  }
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
   * Spools to disk instead of sending (see spoolEmail above) whenever config.email.enabled is
   * false — always true outside a real production deploy, so nothing breaks locally and no local/
   * test run ever emails a real address.
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

  /**
   * Invitation-only mode's outbound notification (AdminService.inviteUser) — tells someone an
   * admin created an account for them and links back to /login. Unlike `deliver`/`deliverForTopic`
   * this has no `conversation_threads`/`topic_thread` row to hang a reply-to/thread-id off of (an
   * invited user hasn't started onboarding yet), so it talks to Resend directly rather than going
   * through the shared `send` helper above. Same spool-instead-of-send safe default as everything
   * else in this file — see spoolEmail.
   */
  async sendInvite(email: string, customMessage?: string): Promise<void> {
    const loginUrl = `${config.frontendUrl}/login`;
    const subject = "You're invited to Unposer";
    const body = [
      "You've been invited to Unposer — a career platform built for people, not pipelines. " +
        'No keyword bingo, no resume lottery, no ATS black box. Just real conversations that let ' +
        'you show up as more than a document.',
      "\nYour data is yours — we never sell or share it. The only use is powering your own AI " +
        'practice interviews, and only with your permission.\n',
      customMessage ? `\n${customMessage}\n` : '',
      `Sign in here to get started: ${loginUrl}`
    ]
      .filter(Boolean)
      .join('\n');

    if (!config.email.enabled) {
      spoolEmail({ to: email, subject, body });
      return;
    }

    try {
      const { error } = await resend().emails.send({
        from: config.email.fromAddress,
        to: email,
        subject,
        text: body
      });

      if (error) {
        console.error(`[email.service] Resend invite send failed for ${email}:`, error);
      }
    } catch (err: any) {
      // Best-effort — the invite row is already created regardless of whether the email lands;
      // an admin can see the pending invite in the users list either way and re-send/tell the
      // person directly if delivery failed.
      console.error(`[email.service] unexpected error sending invite to ${email}:`, err.message || err);
    }
  }

  /**
   * Contact-address forwarding (see config.email.contactAddress/contactForwardTo and
   * webhooks.routes.ts's inbound-email handler, which routes here by recipient address rather
   * than by thread token before it ever reaches the reply+token matching below). No thread, no
   * user, no ConversationService involved — this is a real question from a real person going
   * straight to a real inbox, verbatim. `replyTo` is the original sender, so replying from the
   * forwarded inbox goes straight back to them rather than to Unposer's own address.
   */
  async forwardContactMessage(params: { from: string; subject: string; text: string }): Promise<void> {
    const to = config.email.contactForwardTo;
    if (!to) {
      console.warn('[email.service] contact message received but CONTACT_FORWARD_TO is unset — dropping');
      return;
    }

    const subject = `[Unposer contact] ${params.subject || '(no subject)'}`;
    const body = `From: ${params.from}\n\n${params.text}`;

    if (!config.email.enabled) {
      spoolEmail({ to, subject, body, replyTo: params.from });
      return;
    }

    try {
      const { error } = await resend().emails.send({
        from: config.email.fromAddress,
        to,
        replyTo: params.from,
        subject,
        text: body
      });

      if (error) {
        console.error('[email.service] Resend contact-forward send failed:', error);
      }
    } catch (err: any) {
      console.error('[email.service] unexpected error forwarding contact message:', err.message || err);
    }
  }

  private async send(params: SendParams): Promise<void> {
    const user = await db('users').where({ id: params.userId }).first();
    if (!user) {
      console.warn(`[email.service] no user found for ${params.userId}, skipping send`);
      return;
    }

    const replyTo = `reply+${params.inboundToken}@${config.email.inboundDomain}`;
    const subject = `${params.inReplyTo ? 'Re: ' : ''}${params.subject} — Unposer`;
    const headers = params.inReplyTo ? { 'In-Reply-To': params.inReplyTo, References: params.inReplyTo } : undefined;

    if (!config.email.enabled) {
      spoolEmail({ to: user.email, subject, body: params.body, replyTo, headers });
      return;
    }

    try {
      const { data, error } = await resend().emails.send({
        from: config.email.fromAddress,
        to: user.email,
        replyTo,
        subject,
        text: params.body,
        headers
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
