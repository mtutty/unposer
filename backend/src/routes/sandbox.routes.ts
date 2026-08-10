import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { SandboxService } from '../services/sandbox.service';
import { ProfileService } from '../services/profile.service';
import { FlowService } from '../services/flow.service';

const router = Router();
const sandboxService = new SandboxService();
const profileService = new ProfileService();
const flowService = new FlowService();

router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await sandboxService.getHistory(req.userId!));
  } catch (error) {
    next(error);
  }
});

const messageSchema = z.object({ content: z.string().min(1) });

router.post('/message', requireAuth, validate(messageSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await sandboxService.postMessage(req.userId!, req.body.content);
    await flowService.completeStep(req.userId!, 'sandbox');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

const gapSchema = z.object({ messageId: z.string(), note: z.string().min(1) });

// Step 7 -> Step 5/6 feedback loop: a surfaced gap becomes an open question on the profile.
router.post('/flag-gap', requireAuth, validate(gapSchema), async (req: AuthRequest, res, next) => {
  try {
    const message = await sandboxService.flagGap(req.userId!, req.body.messageId, req.body.note);
    const profile = await profileService.addOpenQuestion(req.userId!, req.body.note);
    res.json({ message, profile, routedTo: 'profile_review' });
  } catch (error) {
    next(error);
  }
});

export default router;
