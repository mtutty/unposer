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
import { AppError } from '../types';
import logisticsRoutes from './logistics.routes';

// Parses `event: <type>\ndata: <json>\n\n` frames back into {type, ...data} objects — see
// utils/sse.ts and sandbox.routes.test.ts's identical helper.
function parseSSE(text: string) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const [eventLine, dataLine] = frame.split('\n');
      return { type: eventLine.replace('event: ', ''), ...JSON.parse(dataLine.replace('data: ', '')) };
    });
}

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
      expect(mockFlowService.setChannel).toHaveBeenCalledWith('u1', 'logistics', 'app');
      expect(mockConversationService.ensureOpeningMessage).toHaveBeenCalledWith('u1', 'logistics', 'app');
      expect(mockInboxService.openThread).not.toHaveBeenCalled();
      expect(res.body.channel).toBe('app');
    });

    it('for "email": opens the inbox thread instead of the app conversation opener', async () => {
      mockInboxService.openThread.mockResolvedValue([{ role: 'assistant', content: 'sent you an email' }] as any);

      const res = await request(app).post('/channel').set('x-test-user', 'u1').send({ channel: 'email' });

      expect(res.status).toBe(200);
      expect(mockFlowService.setChannel).toHaveBeenCalledWith('u1', 'logistics', 'email');
      expect(mockInboxService.openThread).toHaveBeenCalledWith('u1');
      expect(mockConversationService.ensureOpeningMessage).not.toHaveBeenCalled();
      expect(res.body.channel).toBe('email');
    });
  });

  describe('GET /open', () => {
    it('opens/resumes the app-channel thread and returns its messages', async () => {
      mockConversationService.ensureOpeningMessage.mockResolvedValue([{ role: 'assistant', content: 'hi' }] as any);

      const res = await request(app).get('/open').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(mockConversationService.ensureOpeningMessage).toHaveBeenCalledWith('u1', 'logistics', 'app');
      expect(res.body).toEqual({ messages: [{ role: 'assistant', content: 'hi' }] });
    });
  });

  describe('POST /message', () => {
    it('rejects empty content before calling the service', async () => {
      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: '' });

      expect(res.status).toBe(400);
      expect(mockConversationService.postUserMessage).not.toHaveBeenCalled();
    });

    it('streams one delta frame with the full reply, then done, without completing the step when the turn is not finished', async () => {
      mockConversationService.postUserMessage.mockResolvedValue({
        assistantMessage: { id: 'm1', content: 'What timeframe are you targeting?' } as any,
        complete: false,
        thread: {} as any
      });

      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'Looking for staff eng roles' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/event-stream/);
      expect(mockConversationService.postUserMessage).toHaveBeenCalledWith('u1', 'logistics', 'app', 'Looking for staff eng roles');
      const frames = parseSSE(res.text);
      expect(frames).toEqual([
        { type: 'delta', text: 'What timeframe are you targeting?' },
        { type: 'done', message: { id: 'm1', content: 'What timeframe are you targeting?' }, complete: false }
      ]);
      expect(mockFlowService.completeStep).not.toHaveBeenCalled();
    });

    it('completes the step and includes the resulting progress in "done" when the turn finishes', async () => {
      mockConversationService.postUserMessage.mockResolvedValue({
        assistantMessage: { id: 'm2', content: 'All set!' } as any,
        complete: true,
        thread: {} as any
      });
      mockFlowService.completeStep.mockResolvedValue({ currentStep: 'deep_prompts' } as any);

      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'done' });

      expect(mockFlowService.completeStep).toHaveBeenCalledWith('u1', 'logistics');
      const frames = parseSSE(res.text);
      expect(frames[1]).toEqual({
        type: 'done',
        message: { id: 'm2', content: 'All set!' },
        complete: true,
        progress: { currentStep: 'deep_prompts' }
      });
    });

    it('falls back to a normal JSON error response when the service fails before any bytes are written', async () => {
      mockConversationService.postUserMessage.mockRejectedValue(new AppError('THREAD_CAP_REACHED', 'This conversation has reached its length limit.', 400));

      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'hi' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('THREAD_CAP_REACHED');
    });
  });
});
