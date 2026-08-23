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

jest.mock('../services/sandbox.service');
jest.mock('../services/profile.service');
jest.mock('../services/flow.service');

const mockStreamSandboxChat = jest.fn();
const mockIdentifySandboxCitations = jest.fn();
jest.mock('../ai/sandbox-chat.chain', () => ({
  streamSandboxChat: (...args: any[]) => mockStreamSandboxChat(...args),
  identifySandboxCitations: (...args: any[]) => mockIdentifySandboxCitations(...args)
}));

import express from 'express';
import request from 'supertest';
import { SandboxService } from '../services/sandbox.service';
import { ProfileService } from '../services/profile.service';
import { FlowService } from '../services/flow.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import sandboxRoutes from './sandbox.routes';

const mockSandboxService = (SandboxService as jest.MockedClass<typeof SandboxService>).mock.instances[0] as jest.Mocked<SandboxService>;
const mockProfileService = (ProfileService as jest.MockedClass<typeof ProfileService>).mock.instances[0] as jest.Mocked<ProfileService>;
const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', sandboxRoutes);
  app.use(errorHandler);
  return app;
}

// Turns a plain array of string chunks into the async generator streamSandboxChat produces.
async function* chunksOf(parts: string[]) {
  for (const p of parts) yield p;
}

function parseNdjson(text: string) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('sandbox.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('GET / returns the sandbox history', async () => {
    mockSandboxService.getHistory.mockResolvedValue([{ id: 'm1' } as any]);

    const res = await request(app).get('/').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockSandboxService.getHistory).toHaveBeenCalledWith('u1');
  });

  describe('POST /message', () => {
    it('rejects an empty content body before ever calling the service', async () => {
      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: '' });

      expect(res.status).toBe(400);
      expect(mockSandboxService.beginMessage).not.toHaveBeenCalled();
    });

    it('streams delta lines, then done, then citations, completing the sandbox step along the way', async () => {
      mockSandboxService.beginMessage.mockResolvedValue({ profile: { id: 'p1' } as any, history: [] });
      mockStreamSandboxChat.mockReturnValue(chunksOf(['Hel', 'lo']));
      mockSandboxService.saveAssistantMessage.mockResolvedValue({ id: 'msg-1', content: 'Hello' } as any);
      mockIdentifySandboxCitations.mockResolvedValue([{ evidenceId: 'ev-1' }]);
      mockSandboxService.saveCitations.mockResolvedValue({ id: 'msg-1' } as any);

      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'Tell me about yourself' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/x-ndjson/);
      expect(res.headers['x-accel-buffering']).toBe('no');

      const lines = parseNdjson(res.text);
      expect(lines).toEqual([
        { type: 'delta', text: 'Hel' },
        { type: 'delta', text: 'lo' },
        { type: 'done', message: { id: 'msg-1', content: 'Hello' } },
        { type: 'citations', messageId: 'msg-1', citations: [{ evidenceId: 'ev-1' }] }
      ]);
      expect(mockSandboxService.saveAssistantMessage).toHaveBeenCalledWith('u1', 'Hello');
      expect(mockFlowService.completeStep).toHaveBeenCalledWith('u1', 'sandbox');
    });

    it('still ends the stream with "done" (no citations line) when identifySandboxCitations fails — non-critical', async () => {
      mockSandboxService.beginMessage.mockResolvedValue({ profile: { id: 'p1' } as any, history: [] });
      mockStreamSandboxChat.mockReturnValue(chunksOf(['ok']));
      mockSandboxService.saveAssistantMessage.mockResolvedValue({ id: 'msg-1', content: 'ok' } as any);
      mockIdentifySandboxCitations.mockRejectedValue(new Error('citation lookup exploded'));

      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'hi' });

      expect(res.status).toBe(200);
      const lines = parseNdjson(res.text);
      expect(lines.map((l) => l.type)).toEqual(['delta', 'done']);
    });

    it('reports an inline {"type":"error"} line instead of a JSON error response once streaming has begun', async () => {
      mockSandboxService.beginMessage.mockResolvedValue({ profile: { id: 'p1' } as any, history: [] });
      mockStreamSandboxChat.mockImplementation(async function* () {
        yield 'partial';
        throw new Error('model dropped mid-stream');
      });

      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'hi' });

      expect(res.status).toBe(200); // headers were already flushed before the failure
      const lines = parseNdjson(res.text);
      expect(lines[0]).toEqual({ type: 'delta', text: 'partial' });
      expect(lines[1]).toEqual({ type: 'error', message: 'model dropped mid-stream' });
    });

    it('falls back to a normal JSON error response when beginMessage fails before any bytes are written', async () => {
      mockSandboxService.beginMessage.mockRejectedValue(new AppError('NO_APPROVED_PROFILE', 'Approve your profile first', 400));

      const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'hi' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_APPROVED_PROFILE');
    });
  });

  describe('POST /flag-gap', () => {
    it('rejects a body missing messageId/note', async () => {
      const res = await request(app).post('/flag-gap').set('x-test-user', 'u1').send({ messageId: 'msg-1' });

      expect(res.status).toBe(400);
      expect(mockSandboxService.flagGap).not.toHaveBeenCalled();
    });

    it('flags the gap and adds it as an open question on the profile, routing the client to profile_review', async () => {
      mockSandboxService.flagGap.mockResolvedValue({ id: 'msg-1', flagged_gap: true } as any);
      mockProfileService.addOpenQuestion.mockResolvedValue({ id: 'p1' } as any);

      const res = await request(app)
        .post('/flag-gap')
        .set('x-test-user', 'u1')
        .send({ messageId: 'msg-1', note: 'Never actually asked about conflict resolution' });

      expect(res.status).toBe(200);
      expect(mockSandboxService.flagGap).toHaveBeenCalledWith('u1', 'msg-1', 'Never actually asked about conflict resolution');
      expect(mockProfileService.addOpenQuestion).toHaveBeenCalledWith('u1', 'Never actually asked about conflict resolution');
      expect(res.body.routedTo).toBe('profile_review');
    });
  });
});
