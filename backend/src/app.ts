import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middleware/error-handler';
import { apiLimiter } from './middleware/rate-limit';

import authRoutes from './routes/auth.routes';
import resumeRoutes from './routes/resume.routes';
import flowRoutes from './routes/flow.routes';
import logisticsRoutes from './routes/logistics.routes';
import inboxRoutes from './routes/inbox.routes';
import profileRoutes from './routes/profile.routes';
import sandboxRoutes from './routes/sandbox.routes';
import shareRoutes from './routes/share.routes';
import publicRoutes from './routes/public.routes';
import webhookRoutes from './routes/webhooks.routes';

export function createApp() {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    credentials: true
  }));

  // Inbound webhooks (Resend) are server-to-server, not browser requests — no CORS/cookie
  // concerns — and mounted *before* the global express.json() below because Svix signature
  // verification needs the raw, untouched request body (webhooks.routes.ts applies its own
  // express.raw() parser scoped to just this path).
  app.use('/api/webhooks', webhookRoutes);

  // Parsing middleware
  app.use(express.json());
  app.use(cookieParser());

  // Rate limiting
  app.use('/api', apiLimiter);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/resume', resumeRoutes);
  app.use('/api/flow', flowRoutes);
  app.use('/api/logistics', logisticsRoutes);
  app.use('/api/inbox', inboxRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/sandbox', sandboxRoutes);
  app.use('/api/share', shareRoutes);
  app.use('/api/public', publicRoutes);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
