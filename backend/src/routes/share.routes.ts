import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ShareService } from '../services/share.service';
import { FlowService } from '../services/flow.service';

const router = Router();
const shareService = new ShareService();
const flowService = new FlowService();

router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await shareService.listLinks(req.userId!));
  } catch (error) {
    next(error);
  }
});

const createSchema = z.object({ days: z.number().int().min(1).max(60).optional(), label: z.string().optional() });

router.post('/', requireAuth, validate(createSchema), async (req: AuthRequest, res, next) => {
  try {
    const link = await shareService.createLink(req.userId!, req.body.days, req.body.label);
    const progress = await flowService.completeStep(req.userId!, 'share');
    const url = `${req.protocol}://${req.get('host')}/shared/${link.token}`;
    res.json({ link, url, progress });
  } catch (error) {
    next(error);
  }
});

export default router;
