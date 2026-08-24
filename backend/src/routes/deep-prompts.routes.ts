import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { TopicConversationService } from '../services/topic-conversation.service';
import { FlowService } from '../services/flow.service';

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

export default router;
