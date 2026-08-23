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

jest.mock('../services/profile.service');
jest.mock('../services/flow.service');
jest.mock('../services/progression.service');

import express from 'express';
import request from 'supertest';
import { ProfileService } from '../services/profile.service';
import { FlowService } from '../services/flow.service';
import { ProgressionService } from '../services/progression.service';
import { errorHandler } from '../middleware/error-handler';
import profileRoutes from './profile.routes';

const mockProfileService = (ProfileService as jest.MockedClass<typeof ProfileService>).mock.instances[0] as jest.Mocked<ProfileService>;
const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;
const mockProgression = (ProgressionService as jest.MockedClass<typeof ProgressionService>).mock
  .instances[0] as jest.Mocked<ProgressionService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', profileRoutes);
  app.use(errorHandler);
  return app;
}

describe('profile.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('GET / returns the profile', async () => {
    mockProfileService.getProfile.mockResolvedValue({ id: 'p1' } as any);

    const res = await request(app).get('/').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockProfileService.getProfile).toHaveBeenCalledWith('u1');
  });

  it('GET /progression combines tier and temporal-depth summary into one payload', async () => {
    mockProgression.getTier.mockResolvedValue('sketch' as any);
    mockProgression.getTemporalDepthSummary.mockResolvedValue({ singleOccasionDimensions: ['leadership'] } as any);

    const res = await request(app).get('/progression').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tier: 'sketch', singleOccasionDimensions: ['leadership'] });
  });

  it('POST /generate generates and returns the profile', async () => {
    mockProfileService.generateProfile.mockResolvedValue({ id: 'p1', status: 'draft' } as any);

    const res = await request(app).post('/generate').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockProfileService.generateProfile).toHaveBeenCalledWith('u1');
  });

  describe('POST /insights/flag', () => {
    it('rejects a body missing insightId', async () => {
      const res = await request(app).post('/insights/flag').set('x-test-user', 'u1').send({});

      expect(res.status).toBe(400);
      expect(mockProfileService.flagInsight).not.toHaveBeenCalled();
    });

    it('flags the insight and reopens deep_prompts, routing the client there', async () => {
      mockProfileService.flagInsight.mockResolvedValue({ profile: { id: 'p1' }, reaskQuestion: 'Tell me more about X' } as any);

      const res = await request(app).post('/insights/flag').set('x-test-user', 'u1').send({ insightId: 'insight-1' });

      expect(res.status).toBe(200);
      expect(mockProfileService.flagInsight).toHaveBeenCalledWith('u1', 'insight-1');
      expect(mockFlowService.reopenStep).toHaveBeenCalledWith('u1', 'deep_prompts');
      expect(res.body.routedTo).toBe('deep_prompts');
    });
  });

  it('POST /apply-corrections applies every currently-flagged sandbox gap and reports the count', async () => {
    mockProfileService.applyGapCorrections.mockResolvedValue({ profile: { id: 'p1' } as any, appliedCount: 3 });

    const res = await request(app).post('/apply-corrections').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(res.body.appliedCount).toBe(3);
  });

  it('POST /approve approves the profile and completes the profile_review step', async () => {
    mockProfileService.approveProfile.mockResolvedValue({ id: 'p1', status: 'approved' } as any);
    mockFlowService.completeStep.mockResolvedValue({ currentStep: 'sandbox' } as any);

    const res = await request(app).post('/approve').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockFlowService.completeStep).toHaveBeenCalledWith('u1', 'profile_review');
    expect(res.body.progress.currentStep).toBe('sandbox');
  });
});
