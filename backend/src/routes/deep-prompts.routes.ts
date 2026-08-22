import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { TopicConversationService } from '../services/topic-conversation.service';

const router = Router();
const topicConversation = new TopicConversationService();

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

export default router;
