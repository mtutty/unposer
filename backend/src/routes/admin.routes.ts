import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AdminService } from '../services/admin.service';
import { AppError } from '../types';

const router = Router();
const adminService = new AdminService();

// Every route below requires an authenticated, non-suspended user (requireAuth) with role
// 'admin' (requireAdmin) — see middleware/auth.ts.
router.use(requireAuth, requireAdmin);

router.get('/users', async (req: AuthRequest, res, next) => {
  try {
    const { q, role, status, limit, offset } = req.query;
    const result = await adminService.listUsers({
      q: typeof q === 'string' ? q : undefined,
      role: role === 'user' || role === 'admin' ? role : undefined,
      status: status === 'active' || status === 'suspended' ? status : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id', async (req: AuthRequest, res, next) => {
  try {
    const user = await adminService.getUser(String(req.params.id));
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found', 404);
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Read-only rollup of everything the candidate has accumulated — resume, logistics, both
// conversation transcripts, profile, sandbox history, share links. See AdminService.getUserDetail.
router.get('/users/:id/detail', async (req: AuthRequest, res, next) => {
  try {
    const detail = await adminService.getUserDetail(String(req.params.id));
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

const resetSchema = z.object({ confirmEmail: z.string().min(1) });

// Irreversible — wipes the target's resume/logistics/conversations/profile/sandbox/share data
// back to a blank slate (same wipe as the candidate's own POST /api/flow/reset). Gated on the
// caller echoing the target's email back; see AdminService.resetUserData for the rest of the
// guardrails (blocked on admin targets, 404 on a missing user).
router.post('/users/:id/reset', validate(resetSchema), async (req: AuthRequest, res, next) => {
  try {
    const user = await adminService.resetUserData(String(req.params.id), req.body.confirmEmail);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

const updateUserSchema = z
  .object({
    role: z.enum(['user', 'admin']).optional(),
    status: z.enum(['active', 'suspended']).optional()
  })
  .refine((data) => data.role !== undefined || data.status !== undefined, {
    message: 'At least one of role or status must be provided'
  });

router.patch('/users/:id', validate(updateUserSchema), async (req: AuthRequest, res, next) => {
  try {
    // Guards against an admin locking themselves out (demoting or suspending their own account)
    // — must be done by a different admin. No such thing yet as a "the last admin" concept to
    // protect further than this; revisit if that ever becomes a real risk (e.g. once there's
    // more than a couple of admin accounts).
    const id = String(req.params.id);
    if (id === req.userId) {
      throw new AppError('CANNOT_MODIFY_SELF', 'Use another admin account to change your own role or status', 400);
    }
    const user = await adminService.updateUser(id, req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

export default router;
