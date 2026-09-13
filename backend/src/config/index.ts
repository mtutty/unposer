export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://appuser:apppass@postgres:5432/appdb'
  },

  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    model: process.env.LLM_MODEL || 'gpt-4o',
    apiKey: process.env.LLM_API_KEY || ''
  },

  // Anthropic has no embeddings API, so this is independent of `llm` above — always OpenAI
  // regardless of LLM_PROVIDER. Falls back to LLM_API_KEY only when that's already an OpenAI key
  // (i.e. LLM_PROVIDER=openai); otherwise a dedicated EMBEDDINGS_API_KEY is required. See
  // ai/embeddings.ts.
  embeddings: {
    apiKey:
      process.env.EMBEDDINGS_API_KEY ||
      (process.env.LLM_PROVIDER !== 'anthropic' ? process.env.LLM_API_KEY : '') ||
      ''
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    expiryDays: 7
  },

  // Test login — type any username/email, no password, and sign in as that account (creating a
  // plain role:'user' one if it doesn't exist yet). Enabled by default, since this app's default
  // state is a local checkout being developed/tested against; a real deployment turns it off via
  // an explicit `TEST_LOGIN_ENABLED=false` environment override in docker-compose.production.yml
  // rather than relying on whatever happens to be in a shared .env file (see that file's comment
  // for why the override lives there instead of just documenting "set this to false in prod").
  testLogin: {
    enabled: process.env.TEST_LOGIN_ENABLED !== 'false'
  },

  // Invitation-only mode: when enabled, OIDC self-registration is blocked for any email that
  // doesn't already have a users row (see upsertOidcUser in auth.service.ts) — only an
  // admin-created 'invited' row (AdminService.inviteUser) can turn into a real account. The
  // invite/revoke admin endpoints and dev-login both work regardless of this flag; it only gates
  // the self-registration branch of OIDC login.
  inviteOnly: {
    enabled: process.env.INVITE_ONLY_MODE === 'true'
  },

  oidc: {
    google: {
      clientId: process.env.OIDC_GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.OIDC_GOOGLE_CLIENT_SECRET || ''
    },
    github: {
      clientId: process.env.OIDC_GITHUB_CLIENT_ID || '',
      clientSecret: process.env.OIDC_GITHUB_CLIENT_SECRET || ''
    }
  },

  uploads: {
    dir: '/app/uploads',
    maxSize: 10 * 1024 * 1024 // 10MB
  },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',

  // Real email gateway (Resend, both inbound and outbound — see email.service.ts and
  // webhooks.routes.ts).
  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET || '',
    // Inbound subdomain Resend's MX record points at, e.g. "reply.unposer.com". Outbound
    // Reply-To addresses and inbound-webhook token extraction both key off this.
    inboundDomain: process.env.EMAIL_INBOUND_DOMAIN || '',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'Unposer <onboarding@resend.dev>',
    // Credentials present at all — gates the inbound webhook route (accepting mail isn't the
    // "does this leak" risk sending is, so this stays creds-based regardless of NODE_ENV; lets
    // scripts/simulate-inbound-email.ts exercise that path locally with real Resend creds).
    configured: !!(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET),
    // Outbound sending additionally requires NODE_ENV=production — local/test environments must
    // never actually send email regardless of what creds happen to be sitting in .env (a stray
    // real key should never turn "run the tests" into "email real people"). EmailService spools
    // the full message to disk instead whenever this is false — see its spoolEmail/spoolDir.
    enabled: process.env.NODE_ENV === 'production' && !!(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET),
    // Where spooled (not actually sent) emails get written as one .txt file each — see
    // EmailService.spoolEmail. Defaults to a path inside the bind-mounted backend/ source dir in
    // dev (docker-compose.override.yml mounts the whole tree), so spooled mail shows up directly
    // on the host at backend/email-outbox/ without any extra volume wiring.
    spoolDir: process.env.EMAIL_SPOOL_DIR || '/app/email-outbox',
    // Public "ask us anything" address surfaced on /how-your-profile-works (contact@unposer.com,
    // not the reply subdomain above — a candidate/recruiter reading that page should never see
    // the technical inbound domain). Requires its own domain verified for *receiving* in Resend
    // (see infra/README.md's "Contact address forwarding" section) — same webhook endpoint as
    // the reply+token flow, routed by recipient address rather than a token. Forwards verbatim to
    // contactForwardTo rather than entering ConversationService; there's no thread, no user, no
    // conversation model involved, just a real person's question reaching a real inbox.
    contactAddress: process.env.CONTACT_EMAIL_ADDRESS || '',
    contactForwardTo: process.env.CONTACT_FORWARD_TO || ''
  },

  // Weekly re-engagement scheduler (spec §3.5, Iteration 9). Off by default even when Resend is
  // fully configured — this is the one job that emails real candidates unprompted on a timer, so
  // it needs its own explicit opt-in rather than inheriting `email.enabled`. A dev/staging stack
  // with real Resend creds for testing the webhook (Iteration 6) doesn't also want every restart
  // silently arming a cron job that emails whoever happens to be in the dev database.
  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED === 'true',
    // Default: every Monday 09:00 server time. node-cron syntax (5-field, no seconds field).
    cronExpression: process.env.SCHEDULER_CRON || '0 9 * * 1',
    // Step 3 (logistics) email-thread nudges (logistics-nudge-scheduler.service.ts) — a
    // different cadence than the weekly re-engagement job above (hours-since-silence, not
    // weeks), so its own cron expression, but the same master `enabled` switch: both are "emails
    // a real candidate unprompted on a timer," and one kill switch for that class of job is
    // simpler to reason about in ops than two flags that would almost always be set together.
    // Default: hourly — cheap to check, and keeps the actual nudge close to the
    // config.flow.emailSilenceHours threshold rather than trailing it by up to a full day.
    logisticsNudgeCronExpression: process.env.LOGISTICS_NUDGE_CRON || '0 * * * *'
  },

  flow: {
    // Step 4 email-thread bounds (open item in the spec, defaulted here for the prototype).
    emailThreadCap: 30,
    emailSilenceHours: 48,
    shareLinkDefaultDays: 14,
    shareLinkMaxDays: 60,
    // How much raw message history gets sent to the LLM per elicitation/sandbox turn (messages,
    // not tokens) — a recency window, not a hard thread-length limit (thread_cap/no-cap-at-all
    // still govern how long a conversation can actually get). Durable "memory" beyond this window
    // comes from knownData (logistics) or the profile digest + evidence-search tool (sandbox),
    // not from replaying the full raw transcript. See conversation.service.ts/sandbox.service.ts.
    elicitationHistoryWindow: 20,
    sandboxHistoryWindow: 20
  }
};
