import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ProfileService } from '../services/profile.service';
import { FlowService } from '../services/flow.service';
import { ProgressionService } from '../services/progression.service';

const router = Router();
const profileService = new ProfileService();
const flowService = new FlowService();
const progressionService = new ProgressionService();

router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await profileService.getProfile(req.userId!));
  } catch (error) {
    next(error);
  }
});

// Personality engine (Iteration 5): the persistent post-Sketch affordance and "single session so
// far" caveat (flow addendum §5) both read off this — tier plus which medium+ dimensions are
// still single-occasion. Separate from GET / (the narrative profile itself) since a page can want
// this before a profile exists yet (Sketch tier reached, profile not generated) or without
// re-fetching the whole profile just to check tier.
router.get('/progression', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [tier, temporalDepth] = await Promise.all([
      progressionService.getTier(req.userId!),
      progressionService.getTemporalDepthSummary(req.userId!)
    ]);
    res.json({ tier, ...temporalDepth });
  } catch (error) {
    next(error);
  }
});

router.post('/generate', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const profile = await profileService.generateProfile(req.userId!);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

const flagSchema = z.object({ insightId: z.string() });

// Flag as "not accurate" -> one targeted re-ask, routed back into the Step 5 chat.
router.post('/insights/flag', requireAuth, validate(flagSchema), async (req: AuthRequest, res, next) => {
  try {
    const { profile, reaskQuestion } = await profileService.flagInsight(req.userId!, req.body.insightId);
    await flowService.reopenStep(req.userId!, 'deep_prompts');
    res.json({ profile, reaskQuestion, routedTo: 'deep_prompts' });
  } catch (error) {
    next(error);
  }
});

// Step 7 -> Step 6 feedback loop: regenerate the profile from every currently-flagged sandbox gap
// at once. See ProfileService.applyGapCorrections — corrections are discarded once incorporated,
// and the result goes straight back to `approved` (no re-approval gate, no reopening the step).
router.post('/apply-corrections', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { profile, appliedCount } = await profileService.applyGapCorrections(req.userId!);
    res.json({ profile, appliedCount });
  } catch (error) {
    next(error);
  }
});

router.post('/approve', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const profile = await profileService.approveProfile(req.userId!);
    const progress = await flowService.completeStep(req.userId!, 'profile_review');
    res.json({ profile, progress });
  } catch (error) {
    next(error);
  }
});

export default router;
