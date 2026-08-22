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

  devAuth: {
    enabled: process.env.DEV_AUTH_ENABLED === 'true',
    username: process.env.DEV_AUTH_USERNAME || 'devuser',
    password: process.env.DEV_AUTH_PASSWORD || 'devpass'
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
  // webhooks.routes.ts). `enabled` is the safe-default gate, same pattern as devAuth.enabled:
  // with no credentials configured (the out-of-the-box dev state) the webhook route no-ops and
  // EmailService logs instead of calling Resend, so nothing breaks locally without a Resend
  // account.
  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET || '',
    // Inbound subdomain Resend's MX record points at, e.g. "reply.unposer.com". Outbound
    // Reply-To addresses and inbound-webhook token extraction both key off this.
    inboundDomain: process.env.EMAIL_INBOUND_DOMAIN || '',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'Unposer <onboarding@resend.dev>',
    enabled: !!(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET)
  },

  // Weekly re-engagement scheduler (spec §3.5, Iteration 9). Off by default even when Resend is
  // fully configured — this is the one job that emails real candidates unprompted on a timer, so
  // it needs its own explicit opt-in rather than inheriting `email.enabled`. A dev/staging stack
  // with real Resend creds for testing the webhook (Iteration 6) doesn't also want every restart
  // silently arming a cron job that emails whoever happens to be in the dev database.
  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED === 'true',
    // Default: every Monday 09:00 server time. node-cron syntax (5-field, no seconds field).
    cronExpression: process.env.SCHEDULER_CRON || '0 9 * * 1'
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
