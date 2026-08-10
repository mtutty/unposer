import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { LogisticsService } from '../services/logistics.service';
import { ConversationService } from '../services/conversation.service';
import { InboxService } from '../services/inbox.service';
import { FlowService } from '../services/flow.service';

const router = Router();
const logisticsService = new LogisticsService();
const conversationService = new ConversationService();
const inboxService = new InboxService();
const flowService = new FlowService();

const channelSchema = z.object({ channel: z.enum(['app', 'email']) });

router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await logisticsService.getResponse(req.userId!));
  } catch (error) {
    next(error);
  }
});

// Step 3/4: pick app (live chat) or email (async thread) — framed as an affordance, not a fallback.
router.post('/channel', requireAuth, validate(channelSchema), async (req: AuthRequest, res, next) => {
  try {
    const { channel } = req.body;
    await logisticsService.ensureResponse(req.userId!);
    await flowService.setChannel(req.userId!, channel);

    const messages =
      channel === 'app'
        ? await conversationService.ensureOpeningMessage(req.userId!, 'logistics', 'app')
        : await inboxService.openThread(req.userId!);

    res.json({ channel, messages });
  } catch (error) {
    next(error);
  }
});

export default router;
