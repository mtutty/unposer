import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { InboxService } from '../services/inbox.service';
import { FlowService } from '../services/flow.service';

const router = Router();
const inboxService = new InboxService();
const flowService = new FlowService();

const replySchema = z.object({ content: z.string().min(1) });

router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await inboxService.getInbox(req.userId!));
  } catch (error) {
    next(error);
  }
});

router.post('/reply', requireAuth, validate(replySchema), async (req: AuthRequest, res, next) => {
  try {
    const outcome = await inboxService.reply(req.userId!, req.body.content);
    if (outcome.complete) {
      await flowService.completeStep(req.userId!, 'logistics');
    }
    res.json(outcome);
  } catch (error) {
    next(error);
  }
});

// No scheduler in this prototype — the frontend calls this when GET /inbox reports needsNudge.
router.post('/nudge', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await inboxService.sendNudge(req.userId!));
  } catch (error) {
    next(error);
  }
});

export default router;
