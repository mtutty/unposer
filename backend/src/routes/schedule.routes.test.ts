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

jest.mock('../services/progression.service');

import express from 'express';
import request from 'supertest';
import { ProgressionService } from '../services/progression.service';
import { errorHandler } from '../middleware/error-handler';
import scheduleRoutes from './schedule.routes';

const mockProgression = (ProgressionService as jest.MockedClass<typeof ProgressionService>).mock
  .instances[0] as jest.Mocked<ProgressionService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', scheduleRoutes);
  app.use(errorHandler);
  return app;
}

describe('schedule.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('GET / returns the current progression state', async () => {
    mockProgression.getState.mockResolvedValue({ pace_preference: 'one_a_week' } as any);

    const res = await request(app).get('/').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockProgression.getState).toHaveBeenCalledWith('u1');
  });

  describe('POST /pace', () => {
    it('rejects a value outside the enum', async () => {
      const res = await request(app).post('/pace').set('x-test-user', 'u1').send({ pace: 'daily' });

      expect(res.status).toBe(400);
      expect(mockProgression.setPacePreference).not.toHaveBeenCalled();
    });

    it('accepts each valid pace value', async () => {
      mockProgression.setPacePreference.mockResolvedValue({} as any);

      for (const pace of ['whenever', 'one_a_week', 'all_now']) {
        const res = await request(app).post('/pace').set('x-test-user', 'u1').send({ pace });
        expect(res.status).toBe(200);
      }
      expect(mockProgression.setPacePreference).toHaveBeenCalledWith('u1', 'whenever');
      expect(mockProgression.setPacePreference).toHaveBeenCalledWith('u1', 'one_a_week');
      expect(mockProgression.setPacePreference).toHaveBeenCalledWith('u1', 'all_now');
    });
  });

  describe('POST /pause', () => {
    it('rejects a duration outside the enum', async () => {
      const res = await request(app).post('/pause').set('x-test-user', 'u1').send({ duration: '7d' });

      expect(res.status).toBe(400);
      expect(mockProgression.pause).not.toHaveBeenCalled();
    });

    it('pauses for a valid duration', async () => {
      mockProgression.pause.mockResolvedValue({ paused_until: '2026-11-20' } as any);

      const res = await request(app).post('/pause').set('x-test-user', 'u1').send({ duration: '90d' });

      expect(res.status).toBe(200);
      expect(mockProgression.pause).toHaveBeenCalledWith('u1', '90d');
    });
  });

  it('POST /resume resumes the caller', async () => {
    mockProgression.resume.mockResolvedValue({ paused_until: null } as any);

    const res = await request(app).post('/resume').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockProgression.resume).toHaveBeenCalledWith('u1');
  });

  it('POST /unsubscribe unsubscribes the caller', async () => {
    mockProgression.unsubscribe.mockResolvedValue({ unsubscribed: true } as any);

    const res = await request(app).post('/unsubscribe').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockProgression.unsubscribe).toHaveBeenCalledWith('u1');
  });

  it('every action requires auth', async () => {
    const getRes = await request(app).get('/');
    const paceRes = await request(app).post('/pace').send({ pace: 'whenever' });
    const pauseRes = await request(app).post('/pause').send({ duration: '30d' });
    const resumeRes = await request(app).post('/resume');
    const unsubRes = await request(app).post('/unsubscribe');

    for (const res of [getRes, paceRes, pauseRes, resumeRes, unsubRes]) {
      expect(res.status).toBe(401);
    }
  });
});
