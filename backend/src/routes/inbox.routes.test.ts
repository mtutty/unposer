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

jest.mock('../services/inbox.service');
jest.mock('../services/flow.service');

import express from 'express';
import request from 'supertest';
import { InboxService } from '../services/inbox.service';
import { FlowService } from '../services/flow.service';
import { errorHandler } from '../middleware/error-handler';
import inboxRoutes from './inbox.routes';

const mockInboxService = (InboxService as jest.MockedClass<typeof InboxService>).mock.instances[0] as jest.Mocked<InboxService>;
const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', inboxRoutes);
  app.use(errorHandler);
  return app;
}

describe('inbox.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /', () => {
    it("returns the caller's inbox view", async () => {
      mockInboxService.getInbox.mockResolvedValue({ messages: [], needsNudge: false } as any);

      const res = await request(app).get('/').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(mockInboxService.getInbox).toHaveBeenCalledWith('u1');
    });
  });

  describe('POST /reply', () => {
    it('rejects an empty content body before calling the service', async () => {
      const res = await request(app).post('/reply').set('x-test-user', 'u1').send({ content: '' });

      expect(res.status).toBe(400);
      expect(mockInboxService.reply).not.toHaveBeenCalled();
    });

    it('does not complete the logistics step when the turn is not yet complete', async () => {
      mockInboxService.reply.mockResolvedValue({ complete: false, assistantMessage: {} } as any);

      const res = await request(app).post('/reply').set('x-test-user', 'u1').send({ content: 'Sounds good.' });

      expect(res.status).toBe(200);
      expect(mockInboxService.reply).toHaveBeenCalledWith('u1', 'Sounds good.');
      expect(mockFlowService.completeStep).not.toHaveBeenCalled();
    });

    it('completes the logistics step (hardcoded — inbox only ever backs logistics) when the turn completes', async () => {
      mockInboxService.reply.mockResolvedValue({ complete: true, assistantMessage: {} } as any);

      const res = await request(app).post('/reply').set('x-test-user', 'u1').send({ content: 'That works.' });

      expect(res.status).toBe(200);
      expect(mockFlowService.completeStep).toHaveBeenCalledWith('u1', 'logistics');
    });
  });

  describe('POST /nudge', () => {
    it('sends a nudge for the caller', async () => {
      mockInboxService.sendNudge.mockResolvedValue({ content: 'Still there?' } as any);

      const res = await request(app).post('/nudge').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(mockInboxService.sendNudge).toHaveBeenCalledWith('u1');
    });
  });
});
