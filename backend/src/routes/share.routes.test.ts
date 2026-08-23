jest.mock('../db/connection', () => ({ db: jest.fn() }));

// requireAuth itself has its own dedicated coverage (middleware/auth.test.ts) — here it's
// stubbed to a trivial pass-through keyed off an `x-test-user` header so these tests exercise
// only the route's own logic, not session/db plumbing that's already covered elsewhere.
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

jest.mock('../services/share.service');
jest.mock('../services/flow.service');

import express from 'express';
import request from 'supertest';
import { ShareService } from '../services/share.service';
import { FlowService } from '../services/flow.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import shareRoutes from './share.routes';

const mockShareService = (ShareService as jest.MockedClass<typeof ShareService>).mock.instances[0] as jest.Mocked<ShareService>;
const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', shareRoutes);
  app.use(errorHandler);
  return app;
}

describe('share.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /', () => {
    it('401s with no authenticated user', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(401);
      expect(mockShareService.listLinks).not.toHaveBeenCalled();
    });

    it("returns the caller's share links", async () => {
      mockShareService.listLinks.mockResolvedValue([{ id: 'link-1' } as any]);

      const res = await request(app).get('/').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 'link-1' }]);
      expect(mockShareService.listLinks).toHaveBeenCalledWith('u1');
    });
  });

  describe('POST /', () => {
    it('rejects days outside the 1-60 range before calling the service', async () => {
      const res = await request(app).post('/').set('x-test-user', 'u1').send({ days: 90 });

      expect(res.status).toBe(400);
      expect(mockShareService.createLink).not.toHaveBeenCalled();
    });

    it('creates a link, marks the share step complete, and returns an absolute url', async () => {
      mockShareService.createLink.mockResolvedValue({ token: 'tok-abc' } as any);
      mockFlowService.completeStep.mockResolvedValue({ currentStep: 'share' } as any);

      const res = await request(app)
        .post('/')
        .set('x-test-user', 'u1')
        .set('Host', 'unposer.example.com')
        .send({ days: 14, label: 'Recruiter link' });

      expect(res.status).toBe(200);
      expect(mockShareService.createLink).toHaveBeenCalledWith('u1', 14, 'Recruiter link');
      expect(mockFlowService.completeStep).toHaveBeenCalledWith('u1', 'share');
      expect(res.body.url).toBe('http://unposer.example.com/shared/tok-abc');
      expect(res.body.link).toEqual({ token: 'tok-abc' });
    });

    it('propagates a service AppError as its own status/code', async () => {
      mockShareService.createLink.mockRejectedValue(new AppError('PROFILE_NOT_APPROVED', 'Profile must be approved first', 400));

      const res = await request(app).post('/').set('x-test-user', 'u1').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PROFILE_NOT_APPROVED');
    });
  });
});
