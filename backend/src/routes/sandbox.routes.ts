import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { SandboxService } from '../services/sandbox.service';
import { ProfileService } from '../services/profile.service';
import { FlowService } from '../services/flow.service';
import { identifySandboxCitations, streamSandboxChat } from '../ai/sandbox-chat.chain';
import { startSSE, writeSSEEvent } from '../utils/sse';

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

/**
 * Streams the reply over SSE instead of one buffered res.json() — this is the one AI call in the
 * app where the human, not the model, holds the conversational initiative, so most of a turn
 * really is spent waiting on the reply (including a possible search_candidate_evidence lookup —
 * see llm.ts/sandbox-chat.chain.ts for the streaming plumbing this forwards, and utils/sse.ts for
 * the shared envelope every streaming chat route in the app now uses, not just this one).
 *
 * Event sequence: zero or more `tool_call_start`/`tool_call_end` pairs, then one or more `delta`
 * events, then `done` ({message: SandboxMessage}), optionally followed by `citations`
 * ({messageId, citations}) once the follow-up identify-citations call resolves — deliberately
 * after `done` rather than blocking it, so the visible answer is never held up waiting on a call
 * the candidate might not even open the disclosure for. Or `error` ({message}) in place of
 * either.
 */
router.post('/message', requireAuth, validate(messageSchema), async (req: AuthRequest, res, next) => {
  const userId = req.userId!;
  try {
    const { profile, history } = await sandboxService.beginMessage(userId, req.body.content);

    startSSE(res);

    let full = '';
    for await (const event of streamSandboxChat({ profile, history, question: req.body.content, userId })) {
      if (event.type === 'delta') full += event.text;
      writeSSEEvent(res, event.type, event.type === 'delta' ? { text: event.text } : { tool: event.tool });
    }

    const assistantMessage = await sandboxService.saveAssistantMessage(userId, full);
    await flowService.completeStep(userId, 'sandbox');
    writeSSEEvent(res, 'done', { message: assistantMessage });

    try {
      const citations = await identifySandboxCitations({ profile, history, question: req.body.content, answer: full, userId });
      await sandboxService.saveCitations(assistantMessage.id, citations);
      writeSSEEvent(res, 'citations', { messageId: assistantMessage.id, citations });
    } catch (citationError) {
      // Non-critical — the reply itself already landed successfully. Leave citations null rather
      // than failing the whole exchange over a "why did it say that" extra.
      console.error('[sandbox] identifySandboxCitations failed:', citationError);
    }

    res.end();
  } catch (error: any) {
    // Headers already sent once we're mid-stream — next(error) can't turn a part-written response
    // into a clean JSON error at that point, so report it inline on the same stream instead.
    if (res.headersSent) {
      writeSSEEvent(res, 'error', { code: error.code, message: error.message || 'Something went wrong' });
      res.end();
    } else {
      next(error);
    }
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
