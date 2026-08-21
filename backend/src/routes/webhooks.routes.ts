import { Router, raw } from 'express';
import { Resend } from 'resend';
import { Webhook } from 'svix';
import { db } from '../db/connection';
import { config } from '../config';
import { AppError } from '../types';
import { ConversationService } from '../services/conversation.service';
import { EmailService } from '../services/email.service';
import { FlowService } from '../services/flow.service';
import { stripQuotedReply } from '../utils/email-reply';

const router = Router();
const conversationService = new ConversationService();
const flowService = new FlowService();
const emailService = new EmailService();

let resendClient: Resend | null = null;
function resend(): Resend {
  if (!resendClient) {
    resendClient = new Resend(config.email.resendApiKey);
  }
  return resendClient;
}

// Svix verification needs the raw, unparsed request body string (JSON.parse + re-stringify
// breaks the signature) — this router is mounted in app.ts *before* the global express.json(),
// with its own raw parser scoped to just this path.
router.use(raw({ type: '*/*' }));

/**
 * Inbound half of the real email gateway (email.service.ts is the outbound half). Turns a
 * Resend `email.received` webhook notification into the same `postUserMessage` call a chat
 * reply makes today, per CLAUDE.md's "Email-gateway design intent" — ConversationService itself
 * is untouched.
 */
router.post('/inbound-email', async (req, res) => {
  if (!config.email.enabled) {
    // Nothing configured yet — safe no-op rather than a 5xx that trains Resend to keep retrying.
    res.status(200).json({ ok: true, skipped: 'email gateway not configured' });
    return;
  }

  const rawBody = (req.body as Buffer).toString('utf8');

  let verified: any;
  try {
    const wh = new Webhook(config.email.webhookSecret);
    verified = wh.verify(rawBody, {
      'svix-id': req.header('svix-id') || '',
      'svix-timestamp': req.header('svix-timestamp') || '',
      'svix-signature': req.header('svix-signature') || ''
    });
  } catch (err: any) {
    console.warn('[webhooks.routes] inbound-email signature verification failed:', err.message || err);
    res.status(400).json({ error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' } });
    return;
  }

  if (verified?.type !== 'email.received') {
    // Some other event type this webhook is (or someday is) subscribed to — ignore, don't retry.
    res.status(200).json({ ok: true, skipped: `ignored event type ${verified?.type}` });
    return;
  }

  const data = verified.data as {
    email_id: string;
    from: string;
    to: string[];
    message_id: string;
    subject: string;
    text?: string; // simulator-only field — see scripts/simulate-inbound-email.ts; real Resend webhooks never send this
  };

  // Idempotency: Resend/Svix is at-least-once delivery, and a non-2xx response here triggers a
  // retry — dedupe by Resend's own email_id so a retried delivery never double-posts a message.
  const [claimed] = await db('processed_webhook_events')
    .insert({ source: 'resend', external_id: data.email_id })
    .onConflict(['source', 'external_id'])
    .ignore()
    .returning('id');

  if (!claimed) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  try {
    const domain = config.email.inboundDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenPattern = new RegExp(`^reply\\+([0-9a-f-]{36})@${domain}$`, 'i');
    const tokenMatch = data.to.map((addr) => addr.match(tokenPattern)).find((m) => m);

    if (!tokenMatch) {
      console.warn(`[webhooks.routes] inbound email ${data.email_id} to unrecognized address(es):`, data.to);
      res.status(200).json({ ok: true, skipped: 'no matching thread token in recipient address' });
      return;
    }

    const thread = await db('conversation_threads').where({ inbound_token: tokenMatch[1] }).first();
    if (!thread) {
      console.warn(`[webhooks.routes] inbound email ${data.email_id} token ${tokenMatch[1]} matches no thread`);
      res.status(200).json({ ok: true, skipped: 'no thread for token' });
      return;
    }

    // Real Resend webhooks carry metadata only — the body is fetched separately. The simulator
    // script sets `data.text` directly so local/CI testing doesn't need a real received email.
    let bodyText = data.text;
    if (bodyText === undefined || config.nodeEnv === 'production') {
      const { data: fullEmail, error } = await resend().emails.receiving.get(data.email_id);
      if (error || !fullEmail) {
        console.error(`[webhooks.routes] failed to fetch received email ${data.email_id}:`, error);
        res.status(200).json({ ok: true, skipped: 'could not fetch email body' });
        return;
      }
      bodyText = fullEmail.text || '';
    }

    const cleaned = stripQuotedReply(bodyText || '');
    if (!cleaned) {
      res.status(200).json({ ok: true, skipped: 'empty body after stripping quoted reply' });
      return;
    }

    const outcome = await conversationService.postUserMessage(thread.user_id, thread.step, 'email', cleaned);

    await db('conversation_threads').where({ id: thread.id }).update({ last_inbound_message_id: data.message_id });

    if (outcome.complete) {
      await flowService.completeStep(thread.user_id, thread.step);
    }

    await emailService.deliver(outcome.thread, outcome.assistantMessage, { inReplyToMessageId: data.message_id });

    res.status(200).json({ ok: true });
  } catch (err: any) {
    if (err instanceof AppError) {
      // e.g. the thread's step doesn't support the email channel — not retryable, just drop it.
      console.warn(`[webhooks.routes] inbound email ${data.email_id} rejected:`, err.message);
      res.status(200).json({ ok: true, skipped: err.message });
      return;
    }

    // Unexpected failure: release the dedupe claim so a genuine Resend retry can reprocess, then
    // return 5xx so Resend actually retries.
    await db('processed_webhook_events').where({ source: 'resend', external_id: data.email_id }).delete();
    console.error(`[webhooks.routes] error processing inbound email ${data.email_id}:`, err.message || err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to process inbound email' } });
  }
});

export default router;
