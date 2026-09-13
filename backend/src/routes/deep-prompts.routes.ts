import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { TopicConversationService } from '../services/topic-conversation.service';
import { FlowService } from '../services/flow.service';
import { startSSE, writeSSEEvent } from '../utils/sse';

const router = Router();
const topicConversation = new TopicConversationService();
const flowService = new FlowService();

const channelSchema = z.object({ channel: z.enum(['app', 'email']) });

// Flow addendum §3 (Iteration 6): candidate-initiated mid-thread channel switch — "continue this
// by email instead." Chat (over the existing /ws?step=deep_prompts WebSocket) stays the default
// entry point; this is the one REST action Step 5 needs of its own, since it isn't a live-chat
// turn. Separate from logistics' inbox.routes.ts on purpose — Step 5 has no "inbox view" of its
// own (the candidate replies from their real email client, or comes back to the chat), it's just
// this one action plus the existing chat WebSocket.
router.post('/switch-to-email', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const message = await topicConversation.switchActiveTopicToEmail(req.userId!);
    res.json({ message });
  } catch (error) {
    next(error);
  }
});

// Step 5's channel picker, mirroring logistics' POST /channel — see
// docs/deep-prompts-email-channel-gap-assessment.md. Persists the choice on
// flow_progress.deep_prompts_channel so every subsequent topic defaults to it.
router.post('/channel', requireAuth, validate(channelSchema), async (req: AuthRequest, res, next) => {
  try {
    const { channel } = req.body;
    await flowService.setChannel(req.userId!, 'deep_prompts', channel);
    const messages = await topicConversation.chooseChannel(req.userId!, channel);
    res.json({ channel, messages });
  } catch (error) {
    next(error);
  }
});

// Read-only view backing the frontend's email-thread UI (initial load / manual refresh).
router.get('/thread', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await topicConversation.getActiveThreadView(req.userId!));
  } catch (error) {
    next(error);
  }
});

// App-channel live chat, replacing the old /ws?step=deep_prompts WebSocket connection — one
// shared interaction model with every other chat surface in the app now (see utils/sse.ts).
// Resume/open: returns the active topic's exchanges, opening (selecting + inserting) a fresh one
// on a candidate's first visit — same role chat:resume + ensureOpeningExchanges played together
// over the socket.
router.get('/open', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const messages = await topicConversation.ensureOpeningExchanges(req.userId!, 'app');
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});

const messageSchema = z.object({ content: z.string().min(1) });

// One turn: runTopicTurn is a single non-streaming call (see topic-elicitation.chain.ts), so
// there's nothing to chunk — this emits exactly one 'delta' frame carrying the whole reply, then
// 'done', same envelope shape sandbox.routes.ts uses for its own (genuinely chunked) stream. See
// utils/sse.ts's header comment for why every chat route speaks this one format regardless of
// whether its underlying chain actually streams. Preserves the same "complete flips the step"
// wiring the old WS handler had — see websocket/server.ts's removed handleChatMessage.
router.post('/message', requireAuth, validate(messageSchema), async (req: AuthRequest, res, next) => {
  const userId = req.userId!;
  try {
    const outcome = await topicConversation.postUserMessage(userId, 'app', req.body.content);

    startSSE(res);
    writeSSEEvent(res, 'delta', { text: outcome.assistantMessage.content });

    const progress = outcome.complete ? await flowService.completeStep(userId, 'deep_prompts') : undefined;
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
