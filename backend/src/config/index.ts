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
    shareLinkMaxDays: 60
  }
};
