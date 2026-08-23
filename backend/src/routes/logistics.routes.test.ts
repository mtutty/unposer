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

jest.mock('../services/logistics.service');
jest.mock('../services/conversation.service');
jest.mock('../services/inbox.service');
jest.mock('../services/flow.service');

import express from 'express';
import request from 'supertest';
import { LogisticsService } from '../services/logistics.service';
import { ConversationService } from '../services/conversation.service';
import { InboxService } from '../services/inbox.service';
import { FlowService } from '../services/flow.service';
import { errorHandler } from '../middleware/error-handler';
import logisticsRoutes from './logistics.routes';

const mockLogisticsService = (LogisticsService as jest.MockedClass<typeof LogisticsService>).mock
  .instances[0] as jest.Mocked<LogisticsService>;
const mockConversationService = (ConversationService as jest.MockedClass<typeof ConversationService>).mock
  .instances[0] as jest.Mocked<ConversationService>;
const mockInboxService = (InboxService as jest.MockedClass<typeof InboxService>).mock.instances[0] as jest.Mocked<InboxService>;
const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', logisticsRoutes);
  app.use(errorHandler);
  return app;
}

describe('logistics.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /', () => {
    it("returns the caller's logistics response", async () => {
      mockLogisticsService.getResponse.mockResolvedValue({ goals: 'grow into staff eng' } as any);

      const res = await request(app).get('/').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(mockLogisticsService.getResponse).toHaveBeenCalledWith('u1');
    });
  });

  describe('POST /channel', () => {
    it('rejects an unrecognized channel value before touching any service', async () => {
      const res = await request(app).post('/channel').set('x-test-user', 'u1').send({ channel: 'sms' });

      expect(res.status).toBe(400);
      expect(mockLogisticsService.ensureResponse).not.toHaveBeenCalled();
    });

    it('for "app": ensures the response row, sets the channel, and opens the live chat opener', async () => {
      mockConversationService.ensureOpeningMessage.mockResolvedValue([{ role: 'assistant', content: 'hi' }] as any);

      const res = await request(app).post('/channel').set('x-test-user', 'u1').send({ channel: 'app' });

      expect(res.status).toBe(200);
      expect(mockLogisticsService.ensureResponse).toHaveBeenCalledWith('u1');
      expect(mockFlowService.setChannel).toHaveBeenCalledWith('u1', 'app');
      expect(mockConversationService.ensureOpeningMessage).toHaveBeenCalledWith('u1', 'logistics', 'app');
      expect(mockInboxService.openThread).not.toHaveBeenCalled();
      expect(res.body.channel).toBe('app');
    });

    it('for "email": opens the inbox thread instead of the app conversation opener', async () => {
      mockInboxService.openThread.mockResolvedValue([{ role: 'assistant', content: 'sent you an email' }] as any);

      const res = await request(app).post('/channel').set('x-test-user', 'u1').send({ channel: 'email' });

      expect(res.status).toBe(200);
      expect(mockFlowService.setChannel).toHaveBeenCalledWith('u1', 'email');
      expect(mockInboxService.openThread).toHaveBeenCalledWith('u1');
      expect(mockConversationService.ensureOpeningMessage).not.toHaveBeenCalled();
      expect(res.body.channel).toBe('email');
    });
  });
});
