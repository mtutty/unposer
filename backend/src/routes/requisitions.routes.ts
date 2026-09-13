import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireEmployer, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { RequisitionService } from '../services/requisition.service';

const router = Router();
const requisitionService = new RequisitionService();

// Employer-side onboarding, Phase 1 (docs/employer-onboarding-spec.md §3) — every route requires
// an authenticated, non-suspended user (requireAuth) with role 'employer' (requireEmployer, see
// middleware/auth.ts). Owner-scoped throughout: an employer only ever sees their own requisitions
// (no company/org entity yet — spec §2.1).
router.use(requireAuth, requireEmployer);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const requisitions = await requisitionService.list(req.userId!);
    res.json({ requisitions });
  } catch (error) {
    next(error);
  }
});

const createSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  requirements: z.string().optional()
});

router.post('/', validate(createSchema), async (req: AuthRequest, res, next) => {
  try {
    const requisition = await requisitionService.create(req.userId!, req.body);
    res.status(201).json({ requisition });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const requisition = await requisitionService.get(req.userId!, String(req.params.id));
    res.json({ requisition });
  } catch (error) {
    next(error);
  }
});

const updateSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().min(1).optional(),
    requirements: z.string().optional()
  })
  .refine((data) => data.title !== undefined || data.description !== undefined || data.requirements !== undefined, {
    message: 'At least one field must be provided'
  });

router.patch('/:id', validate(updateSchema), async (req: AuthRequest, res, next) => {
  try {
    const requisition = await requisitionService.update(req.userId!, String(req.params.id), req.body);
    res.json({ requisition });
  } catch (error) {
    next(error);
  }
});

export default router;
