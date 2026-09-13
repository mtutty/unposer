jest.mock('../db/connection', () => ({ db: jest.fn() }));

// requireAuth/requireEmployer have their own dedicated coverage (middleware/auth.test.ts) —
// stubbed here to a trivial pass-through keyed off headers so these tests exercise only the
// route's own logic, not session/db plumbing or role checking that's already covered elsewhere.
jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.header('x-test-user');
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session token provided' } });
      return;
    }
    req.userId = userId;
    req.user = { role: req.header('x-test-role') || 'employer' };
    next();
  },
  requireEmployer: (req: any, res: any, next: any) => {
    if (req.user?.role !== 'employer') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Employer access required' } });
      return;
    }
    next();
  }
}));

jest.mock('../services/requisition.service');
jest.mock('../services/requisition-conversation.service');

import express from 'express';
import request from 'supertest';
import { RequisitionService } from '../services/requisition.service';
import { RequisitionConversationService } from '../services/requisition-conversation.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import requisitionsRoutes from './requisitions.routes';

const mockRequisitionService = (RequisitionService as jest.MockedClass<typeof RequisitionService>).mock
  .instances[0] as jest.Mocked<RequisitionService>;
const mockRequisitionConversation = (RequisitionConversationService as jest.MockedClass<typeof RequisitionConversationService>).mock
  .instances[0] as jest.Mocked<RequisitionConversationService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', requisitionsRoutes);
  app.use(errorHandler);
  return app;
}

describe('requisitions.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('401s with no authenticated user', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it("403s a non-employer role", async () => {
    const res = await request(app).get('/').set('x-test-user', 'u1').set('x-test-role', 'user');
    expect(res.status).toBe(403);
    expect(mockRequisitionService.list).not.toHaveBeenCalled();
  });

  describe('GET /', () => {
    it("returns the caller's own requisitions", async () => {
      mockRequisitionService.list.mockResolvedValue([{ id: 'r1' } as any]);

      const res = await request(app).get('/').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ requisitions: [{ id: 'r1' }] });
      expect(mockRequisitionService.list).toHaveBeenCalledWith('u1');
    });
  });

  describe('POST /', () => {
    it('rejects a missing title before calling the service', async () => {
      const res = await request(app).post('/').set('x-test-user', 'u1').send({ description: 'desc only' });

      expect(res.status).toBe(400);
      expect(mockRequisitionService.create).not.toHaveBeenCalled();
    });

    it('creates a draft requisition', async () => {
      mockRequisitionService.create.mockResolvedValue({ id: 'r1', status: 'draft' } as any);

      const res = await request(app)
        .post('/')
        .set('x-test-user', 'u1')
        .send({ title: 'Engineer', description: 'Build things' });

      expect(res.status).toBe(201);
      expect(mockRequisitionService.create).toHaveBeenCalledWith('u1', { title: 'Engineer', description: 'Build things' });
      expect(res.body.requisition).toEqual({ id: 'r1', status: 'draft' });
    });
  });

  describe('GET /:id', () => {
    it('propagates a NOT_FOUND AppError', async () => {
      mockRequisitionService.get.mockRejectedValue(new AppError('NOT_FOUND', 'Requisition not found', 404));

      const res = await request(app).get('/r1').set('x-test-user', 'u1');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns the requisition', async () => {
      mockRequisitionService.get.mockResolvedValue({ id: 'r1' } as any);

      const res = await request(app).get('/r1').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(mockRequisitionService.get).toHaveBeenCalledWith('u1', 'r1');
      expect(res.body.requisition).toEqual({ id: 'r1' });
    });
  });

  describe('PATCH /:id', () => {
    it('rejects an empty body before calling the service', async () => {
      const res = await request(app).patch('/r1').set('x-test-user', 'u1').send({});

      expect(res.status).toBe(400);
      expect(mockRequisitionService.update).not.toHaveBeenCalled();
    });

    it('updates the requisition', async () => {
      mockRequisitionService.update.mockResolvedValue({ id: 'r1', title: 'New title' } as any);

      const res = await request(app).patch('/r1').set('x-test-user', 'u1').send({ title: 'New title' });

      expect(res.status).toBe(200);
      expect(mockRequisitionService.update).toHaveBeenCalledWith('u1', 'r1', { title: 'New title' });
      expect(res.body.requisition).toEqual({ id: 'r1', title: 'New title' });
    });

    it('propagates a NOT_DRAFT AppError', async () => {
      mockRequisitionService.update.mockRejectedValue(new AppError('NOT_DRAFT', 'Only a draft requisition can be edited', 400));

      const res = await request(app).patch('/r1').set('x-test-user', 'u1').send({ title: 'New title' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NOT_DRAFT');
    });
  });

  describe('GET /:id/qa', () => {
    it('checks ownership via requisitionService.get before touching the conversation', async () => {
      mockRequisitionService.get.mockRejectedValue(new AppError('NOT_FOUND', 'Requisition not found', 404));

      const res = await request(app).get('/r1/qa').set('x-test-user', 'u1');

      expect(res.status).toBe(404);
      expect(mockRequisitionConversation.ensureOpeningMessage).not.toHaveBeenCalled();
    });

    it('opens/resumes the thread and returns messages + thread status', async () => {
      mockRequisitionService.get.mockResolvedValue({ id: 'r1' } as any);
      mockRequisitionConversation.ensureOpeningMessage.mockResolvedValue([{ id: 'm1', content: 'hi' } as any]);
      mockRequisitionConversation.getOrCreateThread.mockResolvedValue({ id: 'thread-1', status: 'active' } as any);

      const res = await request(app).get('/r1/qa').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(mockRequisitionConversation.ensureOpeningMessage).toHaveBeenCalledWith('r1');
      expect(res.body).toEqual({ messages: [{ id: 'm1', content: 'hi' }], thread: { id: 'thread-1', status: 'active' } });
    });
  });

  describe('POST /:id/qa/message', () => {
    it('rejects empty content before calling the service', async () => {
      const res = await request(app).post('/r1/qa/message').set('x-test-user', 'u1').send({ content: '' });

      expect(res.status).toBe(400);
      expect(mockRequisitionConversation.postUserMessage).not.toHaveBeenCalled();
    });

    it('checks ownership via requisitionService.get before posting', async () => {
      mockRequisitionService.get.mockRejectedValue(new AppError('NOT_FOUND', 'Requisition not found', 404));

      const res = await request(app).post('/r1/qa/message').set('x-test-user', 'u1').send({ content: 'hi' });

      expect(res.status).toBe(404);
      expect(mockRequisitionConversation.postUserMessage).not.toHaveBeenCalled();
    });

    it('posts the message and returns the turn outcome', async () => {
      mockRequisitionService.get.mockResolvedValue({ id: 'r1' } as any);
      mockRequisitionConversation.postUserMessage.mockResolvedValue({
        assistantMessage: { content: 'reply' } as any,
        complete: false,
        thread: { id: 'thread-1' } as any
      });

      const res = await request(app).post('/r1/qa/message').set('x-test-user', 'u1').send({ content: 'Team of 5.' });

      expect(res.status).toBe(200);
      expect(mockRequisitionConversation.postUserMessage).toHaveBeenCalledWith('r1', 'Team of 5.');
      expect(res.body).toEqual({ assistantMessage: { content: 'reply' }, complete: false, thread: { id: 'thread-1' } });
    });

    it('propagates a THREAD_COMPLETE AppError', async () => {
      mockRequisitionService.get.mockResolvedValue({ id: 'r1' } as any);
      mockRequisitionConversation.postUserMessage.mockRejectedValue(new AppError('THREAD_COMPLETE', 'This conversation is already complete.', 400));

      const res = await request(app).post('/r1/qa/message').set('x-test-user', 'u1').send({ content: 'hi' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('THREAD_COMPLETE');
    });
  });
});
