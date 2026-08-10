import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { publicLimiter } from '../middleware/rate-limit';
import { ShareService } from '../services/share.service';

const router = Router();
const shareService = new ShareService();

router.use(publicLimiter);

// Step 8: anyone with the link gets the same interactive chat, backed by the same approved
// profile — no auth, gated only by the (unguessable) token and its natural expiry.
router.get('/share/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token);
    res.json(await shareService.getPublicProfileView(token));
  } catch (error) {
    next(error);
  }
});

const chatSchema = z.object({
  question: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(60)
    .optional()
});

router.post('/share/:token/message', validate(chatSchema), async (req, res, next) => {
  try {
    const token = String(req.params.token);
    const reply = await shareService.publicChat(token, req.body.history || [], req.body.question);
    res.json({ reply });
  } catch (error) {
    next(error);
  }
});

export default router;
