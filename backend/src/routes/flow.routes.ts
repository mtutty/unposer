import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { FlowService } from '../services/flow.service';
import { flowStages, flowSteps } from '../models/flow-steps';

const router = Router();
const flowService = new FlowService();

// Server-driven UI: the frontend renders its progress rail purely from this list. `stages`
// groups the granular steps into the two rail-facing stages (see flow-steps.ts) — steps_state
// tracking is unaffected, this is presentation-only.
router.get('/steps', requireAuth, (_req, res) => {
  res.json({ steps: flowSteps, stages: flowStages });
});

router.get('/progress', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const progress = await flowService.getProgress(req.userId!);
    res.json(progress);
  } catch (error) {
    next(error);
  }
});

router.post('/reset', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await flowService.resetProgress(req.userId!);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
