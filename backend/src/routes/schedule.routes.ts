import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ProgressionService } from '../services/progression.service';

const router = Router();
const progression = new ProgressionService();

// Personality engine (spec §3.5 "Re-engagement cadence", Iteration 9). "Every email carries a
// link back to the site for pace controls, suspend, and unsubscribe" — this is that destination.
// All four actions read back the current progression row so the frontend never has to guess the
// resulting state from the request it just sent.

const paceSchema = z.object({ pace: z.enum(['whenever', 'one_a_week', 'all_now']) });
const pauseSchema = z.object({ duration: z.enum(['30d', '90d', 'indefinite']) });

router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await progression.getState(req.userId!));
  } catch (error) {
    next(error);
  }
});

router.post('/pace', requireAuth, validate(paceSchema), async (req: AuthRequest, res, next) => {
  try {
    res.json(await progression.setPacePreference(req.userId!, req.body.pace));
  } catch (error) {
    next(error);
  }
});

router.post('/pause', requireAuth, validate(pauseSchema), async (req: AuthRequest, res, next) => {
  try {
    res.json(await progression.pause(req.userId!, req.body.duration));
  } catch (error) {
    next(error);
  }
});

router.post('/resume', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await progression.resume(req.userId!));
  } catch (error) {
    next(error);
  }
});

router.post('/unsubscribe', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await progression.unsubscribe(req.userId!));
  } catch (error) {
    next(error);
  }
});

export default router;
