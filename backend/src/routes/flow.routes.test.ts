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

jest.mock('../services/flow.service');

import express from 'express';
import request from 'supertest';
import { FlowService } from '../services/flow.service';
import { errorHandler } from '../middleware/error-handler';
import { flowStages, flowSteps } from '../models/flow-steps';
import flowRoutes from './flow.routes';

const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;

function buildApp() {
  const app = express();
  app.use('/', flowRoutes);
  app.use(errorHandler);
  return app;
}

describe('flow.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /steps', () => {
    it('serves the server-driven step and stage definitions verbatim, requiring auth', async () => {
      const unauth = await request(app).get('/steps');
      expect(unauth.status).toBe(401);

      const res = await request(app).get('/steps').set('x-test-user', 'u1');
      expect(res.status).toBe(200);
      expect(res.body.steps).toEqual(flowSteps);
      expect(res.body.stages).toEqual(flowStages);
    });
  });

  describe('GET /progress', () => {
    it("401s with no authenticated user, and returns the caller's progress otherwise", async () => {
      const unauth = await request(app).get('/progress');
      expect(unauth.status).toBe(401);
      expect(mockFlowService.getProgress).not.toHaveBeenCalled();

      mockFlowService.getProgress.mockResolvedValue({ currentStep: 'resume' } as any);
      const res = await request(app).get('/progress').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ currentStep: 'resume' });
      expect(mockFlowService.getProgress).toHaveBeenCalledWith('u1');
    });
  });

  describe('POST /reset', () => {
    it("resets the caller's own progress only", async () => {
      const res = await request(app).post('/reset').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockFlowService.resetProgress).toHaveBeenCalledWith('u1');
    });
  });
});
