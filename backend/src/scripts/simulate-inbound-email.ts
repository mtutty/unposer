/**
 * Builds a validly-signed Resend `email.received` webhook payload and (optionally) POSTs it to
 * the local API, for exercising webhooks.routes.ts without a real inbound email. Run inside the
 * API container — there's no dotenv in this repo, env comes from `env_file: .env` same as every
 * other backend process:
 *
 *   docker-compose exec api npm run simulate:inbound-email -- --user devuser@example.com --text "Remote only, staff level."
 *   docker-compose exec api npm run simulate:inbound-email -- --token <inbound_token> --post
 *   docker-compose exec api npm run simulate:inbound-email -- --user devuser@example.com --email-id re_realIdFromResend
 *   docker-compose exec api npm run simulate:inbound-email -- --user devuser@example.com --step deep_prompts --text "More detail on that." --post
 *
 * Flags:
 *   --user <email>       Look up the user's thread — `logistics` conversation_threads by default,
 *                          or their currently-open `topic_thread` with --step deep_prompts
 *                          (Iteration 6, flow addendum §3; the candidate must have an open topic —
 *                          use POST /api/deep-prompts/switch-to-email first, or the app UI's
 *                          "continue by email" action, same as a real candidate would).
 *   --step <logistics|deep_prompts>  Which thread type --user resolves against (default logistics).
 *   --token <uuid>        Use this inbound_token directly instead of --user — tried against both
 *                          conversation_threads and topic_thread, same fallback order
 *                          webhooks.routes.ts itself uses.
 *   --text <body>          Inbound message body (default: a canned reply). FAST/OFFLINE MODE:
 *                           sets a `data.text` field the real Resend webhook never sends —
 *                           webhooks.routes.ts has a narrow, NODE_ENV-guarded bypass that uses it
 *                           instead of calling Resend's Received-Email API, so this whole path is
 *                           testable without a real received email.
 *   --email-id <id>        REAL MODE: use a genuine Resend-received email id (you actually sent
 *                           an email into the inbound address first and copied its id) — omits
 *                           `data.text`, so the handler does the real GET /emails/receiving/{id}
 *                           fetch. Overrides --text if both are given. Also useful for the dedupe
 *                           test: run twice with the same --email-id and confirm the second call
 *                           is dropped.
 *   --from <email>          Sender address in the payload (default: the resolved user's email).
 *   --post [url]            Actually POST the signed payload (default url: the API's own dev port,
 *                            http://localhost:3000/api/webhooks/inbound-email). Without --post,
 *                            just prints the headers + body so they can be piped into curl by hand.
 */
import { randomUUID } from 'crypto';
import { Webhook } from 'svix';
import { db } from '../db/connection';
import { config } from '../config';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function resolveThread(args: Record<string, string | boolean>) {
  const step = typeof args.step === 'string' ? args.step : 'logistics';
  if (step !== 'logistics' && step !== 'deep_prompts') {
    throw new Error(`--step must be "logistics" or "deep_prompts", got "${step}"`);
  }

  if (typeof args.token === 'string') {
    // Same conversation_threads-then-topic_thread fallback webhooks.routes.ts itself uses — the
    // two tables' inbound_token values never collide, so trying both in order is safe.
    const thread = await db('conversation_threads').where({ inbound_token: args.token }).first();
    if (thread) return thread;
    const topicThread = await db('topic_thread').where({ inbound_token: args.token }).first();
    if (topicThread) return topicThread;
    throw new Error(`No conversation_threads or topic_thread row with inbound_token ${args.token}`);
  }

  if (typeof args.user === 'string') {
    const user = await db('users').where({ email: args.user }).first();
    if (!user) throw new Error(`No user with email ${args.user}`);

    if (step === 'deep_prompts') {
      const thread = await db('topic_thread').where({ user_id: user.id, status: 'open' }).orderBy('opened_at', 'desc').first();
      if (!thread) {
        throw new Error(
          `User ${args.user} has no open topic_thread yet — have them start Step 5 and switch a topic to email first ` +
            `(POST /api/deep-prompts/switch-to-email), which is what generates the inbound_token this simulates a reply to.`
        );
      }
      return { thread, user };
    }

    const thread = await db('conversation_threads').where({ user_id: user.id, step: 'logistics' }).first();
    if (!thread) {
      throw new Error(
        `User ${args.user} has no logistics conversation_threads row yet — have them pick the email channel in ` +
          `Step 3 first (POST /api/logistics/channel), which creates it.`
      );
    }
    return { thread, user };
  }

  throw new Error('Pass --user <email> or --token <uuid> to identify the thread to simulate a reply on.');
}

async function main() {
  if (!config.email.webhookSecret) {
    throw new Error('RESEND_WEBHOOK_SECRET is not set — the simulator signs with the same secret the real handler verifies against.');
  }
  if (!config.email.inboundDomain) {
    throw new Error('EMAIL_INBOUND_DOMAIN is not set — needed to build the reply+<token>@<domain> recipient address.');
  }

  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveThread(args);
  const thread = 'thread' in resolved ? resolved.thread : resolved;
  const user = 'user' in resolved ? resolved.user : await db('users').where({ id: thread.user_id }).first();

  const from = typeof args.from === 'string' ? args.from : user.email;
  const to = `reply+${thread.inbound_token}@${config.email.inboundDomain}`;
  const emailId = typeof args['email-id'] === 'string' ? args['email-id'] : `sim_${randomUUID()}`;
  const usingRealEmailId = typeof args['email-id'] === 'string';

  if (usingRealEmailId && typeof args.text === 'string') {
    console.warn('--email-id given alongside --text — ignoring --text, the handler will fetch the real body from Resend.');
  }

  const text = usingRealEmailId ? undefined : typeof args.text === 'string' ? args.text : "Sounds good — let's continue.";

  const payload = {
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: {
      email_id: emailId,
      created_at: new Date().toISOString(),
      from,
      to: [to],
      bcc: [],
      cc: [],
      received_for: [to],
      message_id: `<${randomUUID()}@simulate-inbound-email>`,
      subject: 'Re: Your Unposer career profile',
      attachments: [],
      ...(text !== undefined ? { text } : {})
    }
  };

  const body = JSON.stringify(payload);
  const msgId = `msg_${randomUUID().replace(/-/g, '')}`;
  const timestamp = new Date();
  const wh = new Webhook(config.email.webhookSecret);
  const signature = wh.sign(msgId, timestamp, body);

  const headers = {
    'content-type': 'application/json',
    'svix-id': msgId,
    'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'svix-signature': signature
  };

  console.log('--- payload ---');
  console.log(body);
  console.log('--- headers ---');
  console.log(JSON.stringify(headers, null, 2));

  if (args.post) {
    const url = typeof args.post === 'string' ? args.post : 'http://localhost:3000/api/webhooks/inbound-email';
    console.log(`\nPOSTing to ${url} ...`);
    const response = await fetch(url, { method: 'POST', headers, body });
    console.log(`--- response ${response.status} ---`);
    console.log(await response.text());
  } else {
    console.log('\n(not posted — pass --post [url] to actually send it, default http://localhost:3000/api/webhooks/inbound-email)');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[simulate-inbound-email] failed:', err.message || err);
  process.exit(1);
});
