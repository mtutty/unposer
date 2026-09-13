import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { LogisticsService } from '../services/logistics.service';
import { ConversationService } from '../services/conversation.service';
import { InboxService } from '../services/inbox.service';
import { FlowService } from '../services/flow.service';
import { startSSE, writeSSEEvent } from '../utils/sse';

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
    await flowService.setChannel(req.userId!, 'logistics', channel);

    const messages =
      channel === 'app'
        ? await conversationService.ensureOpeningMessage(req.userId!, 'logistics', 'app')
        : await inboxService.openThread(req.userId!);

    res.json({ channel, messages });
  } catch (error) {
    next(error);
  }
});

// App-channel live chat, replacing the old /ws?step=logistics WebSocket connection — one shared
// interaction model with every other chat surface in the app now (see utils/sse.ts). Resume/open:
// returns existing history, or generates+persists the opening question on a candidate's first
// visit — same role chat:resume + ensureOpeningMessage played together over the socket.
router.get('/open', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const messages = await conversationService.ensureOpeningMessage(req.userId!, 'logistics', 'app');
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});

const messageSchema = z.object({ content: z.string().min(1) });

// One turn: runElicitationTurn is a single non-streaming structured call (see
// elicitation.chain.ts), so there's nothing to chunk — this emits exactly one 'delta' frame
// carrying the whole reply, then 'done', same envelope shape sandbox.routes.ts uses for its own
// (genuinely chunked) stream. See utils/sse.ts's header comment for why every chat route speaks
// this one format regardless of whether its underlying chain actually streams.
router.post('/message', requireAuth, validate(messageSchema), async (req: AuthRequest, res, next) => {
  const userId = req.userId!;
  try {
    const outcome = await conversationService.postUserMessage(userId, 'logistics', 'app', req.body.content);

    startSSE(res);
    writeSSEEvent(res, 'delta', { text: outcome.assistantMessage.content });

    const progress = outcome.complete ? await flowService.completeStep(userId, 'logistics') : undefined;
    writeSSEEvent(res, 'done', { message: outcome.assistantMessage, complete: outcome.complete, progress });
    res.end();
  } catch (error: any) {
    if (res.headersSent) {
      writeSSEEvent(res, 'error', { code: error.code, message: error.message || 'Something went wrong' });
      res.end();
    } else {
      next(error);
    }
  }
});

export default router;
