import fs from 'fs';
import os from 'os';
import path from 'path';

// resume.routes.ts builds its multer disk storage from config.uploads.dir at *module load time*
// (config.uploads.dir defaults to '/app/uploads', which only exists inside the real container) —
// point it at a real, writable temp dir instead so multer's actual upload/filter/size-limit
// behavior runs for real rather than being mocked away.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-routes-test-'));
jest.mock('../config', () => ({
  config: { uploads: { dir: '', maxSize: 1024 } } // dir set below, after mkdtemp
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
(require('../config') as any).config.uploads.dir = uploadDir;

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

jest.mock('../services/resume.service');
jest.mock('../services/flow.service');

import express from 'express';
import request from 'supertest';
import { ResumeService } from '../services/resume.service';
import { FlowService } from '../services/flow.service';
import { errorHandler } from '../middleware/error-handler';
import resumeRoutes from './resume.routes';

const mockResumeService = (ResumeService as jest.MockedClass<typeof ResumeService>).mock.instances[0] as jest.Mocked<ResumeService>;
const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', resumeRoutes);
  app.use(errorHandler);
  return app;
}

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe('resume.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('POST /upload', () => {
    it('400s NO_FILE when no file field is attached', async () => {
      const res = await request(app).post('/upload').set('x-test-user', 'u1');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FILE');
      expect(mockResumeService.uploadAndParse).not.toHaveBeenCalled();
    });

    it('rejects a disallowed file extension via multer fileFilter before reaching the service', async () => {
      const res = await request(app)
        .post('/upload')
        .set('x-test-user', 'u1')
        .attach('resume', Buffer.from('not a resume'), 'resume.exe');

      expect(res.status).toBe(500); // multer's fileFilter Error isn't an AppError — falls to the generic handler
      expect(mockResumeService.uploadAndParse).not.toHaveBeenCalled();
    });

    it('accepts an allowed extension, writes it to disk, and passes isCareerChanger through', async () => {
      mockResumeService.uploadAndParse.mockResolvedValue({ id: 'resume-1' } as any);

      const res = await request(app)
        .post('/upload')
        .set('x-test-user', 'u1')
        .field('isCareerChanger', 'true')
        .attach('resume', Buffer.from('%PDF-1.4 fake pdf content'), 'resume.pdf');

      expect(res.status).toBe(200);
      expect(mockResumeService.uploadAndParse).toHaveBeenCalledTimes(1);
      const [userId, file, isCareerChanger] = mockResumeService.uploadAndParse.mock.calls[0];
      expect(userId).toBe('u1');
      expect(isCareerChanger).toBe(true);
      expect(fs.existsSync(file.path)).toBe(true);
    });
  });

  describe('POST /manual', () => {
    it('starts a blank manual-entry resume for the caller', async () => {
      mockResumeService.startManualEntry.mockResolvedValue({ id: 'resume-2' } as any);

      const res = await request(app).post('/manual').set('x-test-user', 'u1').send({ isCareerChanger: true });

      expect(res.status).toBe(200);
      expect(mockResumeService.startManualEntry).toHaveBeenCalledWith('u1', true);
    });
  });

  describe('GET /', () => {
    it("returns the caller's resume", async () => {
      mockResumeService.getResume.mockResolvedValue({ id: 'resume-1' } as any);

      const res = await request(app).get('/').set('x-test-user', 'u1');

      expect(res.status).toBe(200);
      expect(mockResumeService.getResume).toHaveBeenCalledWith('u1');
    });
  });

  describe('PUT /confirm', () => {
    it('confirms the structured data and completes the resume flow step', async () => {
      mockResumeService.confirm.mockResolvedValue({ id: 'resume-1', confirmed: true } as any);
      mockFlowService.completeStep.mockResolvedValue({ currentStep: 'logistics' } as any);

      const structuredData = { name: 'Ada Lovelace' };
      const res = await request(app).put('/confirm').set('x-test-user', 'u1').send({ structuredData });

      expect(res.status).toBe(200);
      expect(mockResumeService.confirm).toHaveBeenCalledWith('u1', structuredData);
      expect(mockFlowService.completeStep).toHaveBeenCalledWith('u1', 'resume');
      expect(res.body.progress.currentStep).toBe('logistics');
    });
  });
});
