jest.mock('../db/connection', () => ({ db: jest.fn() }));
jest.mock('../services/share.service');

import express from 'express';
import request from 'supertest';
import { ShareService } from '../services/share.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import publicRoutes from './public.routes';

const mockShareService = (ShareService as jest.MockedClass<typeof ShareService>).mock.instances[0] as jest.Mocked<ShareService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', publicRoutes);
  app.use(errorHandler);
  return app;
}

describe('public.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /share/:token', () => {
    it('is unauthenticated — no session cookie needed — and returns the public profile view', async () => {
      mockShareService.getPublicProfileView.mockResolvedValue({ headline: 'Product-minded engineer' } as any);

      const res = await request(app).get('/share/tok-abc');

      expect(res.status).toBe(200);
      expect(mockShareService.getPublicProfileView).toHaveBeenCalledWith('tok-abc');
      expect(res.body.headline).toBe('Product-minded engineer');
    });

    it('404s once the service reports the link expired/invalid', async () => {
      mockShareService.getPublicProfileView.mockRejectedValue(new AppError('NOT_FOUND', 'This link has expired.', 404));

      const res = await request(app).get('/share/expired-tok');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /share/:token/message', () => {
    it('rejects an empty question before calling the service', async () => {
      const res = await request(app).post('/share/tok-abc/message').send({ question: '' });

      expect(res.status).toBe(400);
      expect(mockShareService.publicChat).not.toHaveBeenCalled();
    });

    it('rejects a history array over the 60-message cap', async () => {
      const history = Array.from({ length: 61 }, () => ({ role: 'user', content: 'hi' }));

      const res = await request(app).post('/share/tok-abc/message').send({ question: 'hi', history });

      expect(res.status).toBe(400);
      expect(mockShareService.publicChat).not.toHaveBeenCalled();
    });

    it('passes token, history (defaulting to []), and question through to the service', async () => {
      mockShareService.publicChat.mockResolvedValue('Great question — here is my answer.');

      const res = await request(app).post('/share/tok-abc/message').send({ question: 'Tell me about a challenge you faced.' });

      expect(res.status).toBe(200);
      expect(mockShareService.publicChat).toHaveBeenCalledWith('tok-abc', [], 'Tell me about a challenge you faced.');
      expect(res.body.reply).toMatch(/Great question/);
    });

    it('propagates a service AppError (e.g. expired link) as its own status/code', async () => {
      mockShareService.publicChat.mockRejectedValue(new AppError('NOT_FOUND', 'This profile is no longer available.', 404));

      const res = await request(app).post('/share/tok-abc/message').send({ question: 'hi' });

      expect(res.status).toBe(404);
    });
  });
});
