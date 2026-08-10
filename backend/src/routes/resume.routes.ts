import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ResumeService } from '../services/resume.service';
import { FlowService } from '../services/flow.service';
import { config } from '../config';
import { AppError } from '../types';

const router = Router();
const resumeService = new ResumeService();
const flowService = new FlowService();

const storage = multer.diskStorage({
  destination: config.uploads.dir,
  filename: (_req, file, cb) => {
    const uniqueName = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxSize },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, and TXT allowed.'));
    }
  }
});

// Standard path: upload + AI parse.
router.post('/upload', requireAuth, upload.single('resume'), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('NO_FILE', 'No file uploaded', 400);
    }
    const isCareerChanger = req.body.isCareerChanger === 'true';
    const result = await resumeService.uploadAndParse(req.userId!, req.file, isCareerChanger);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Career-changer / no-resume path: blank slate for manual entry.
router.post('/manual', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const isCareerChanger = !!req.body.isCareerChanger;
    const result = await resumeService.startManualEntry(req.userId!, isCareerChanger);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const resume = await resumeService.getResume(req.userId!);
    res.json(resume);
  } catch (error) {
    next(error);
  }
});

// Confirmation/correction screen — parser output only becomes ground truth here.
router.put('/confirm', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const resume = await resumeService.confirm(req.userId!, req.body.structuredData);
    const progress = await flowService.completeStep(req.userId!, 'resume');
    res.json({ resume, progress });
  } catch (error) {
    next(error);
  }
});

export default router;
