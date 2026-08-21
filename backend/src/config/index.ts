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
