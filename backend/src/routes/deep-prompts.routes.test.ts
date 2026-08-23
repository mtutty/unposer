jest.mock('../db/connection', () => ({ db: jest.fn() }));

// See share.routes.test.ts for why requireAuth is stubbed rather than exercised here.
jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.header('x-test-user');
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session token provided' } });
      return;
    }
    req.userId = userId;
    next();
  }
}));

jest.mock('../services/topic-conversation.service');

import express from 'express';
import request from 'supertest';
import { TopicConversationService } from '../services/topic-conversation.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import deepPromptsRoutes from './deep-prompts.routes';

const mockTopicConversation = (TopicConversationService as jest.MockedClass<typeof TopicConversationService>).mock
  .instances[0] as jest.Mocked<TopicConversationService>;

function buildApp() {
  const app = express();
  app.use('/', deepPromptsRoutes);
  app.use(errorHandler);
  return app;
}

describe('deep-prompts.routes POST /switch-to-email', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('401s with no authenticated user', async () => {
    const res = await request(app).post('/switch-to-email');
    expect(res.status).toBe(401);
    expect(mockTopicConversation.switchActiveTopicToEmail).not.toHaveBeenCalled();
  });

  it("switches the caller's active topic thread to email and returns the resulting message", async () => {
    mockTopicConversation.switchActiveTopicToEmail.mockResolvedValue({ content: 'Continuing by email — check your inbox.' } as any);

    const res = await request(app).post('/switch-to-email').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockTopicConversation.switchActiveTopicToEmail).toHaveBeenCalledWith('u1');
    expect(res.body.message.content).toMatch(/email/);
  });

  it('propagates a service AppError as its own status/code (e.g. no active topic thread)', async () => {
    mockTopicConversation.switchActiveTopicToEmail.mockRejectedValue(
      new AppError('NO_ACTIVE_TOPIC', 'No active deep-prompt thread to switch', 400)
    );

    const res = await request(app).post('/switch-to-email').set('x-test-user', 'u1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_ACTIVE_TOPIC');
  });
});
