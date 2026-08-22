import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { AppError } from '../types';

export interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies.session_token;

    if (!token) {
      throw new AppError('UNAUTHORIZED', 'No session token provided', 401);
    }

    const session = await db('sessions')
      .where({ token })
      .where('expires_at', '>', new Date())
      .first();

    if (!session) {
      throw new AppError('SESSION_EXPIRED', 'Session expired or invalid', 401);
    }

    const user = await db('users')
      .where({ id: session.user_id })
      .first();

    if (!user) {
      throw new AppError('UNAUTHORIZED', 'User not found', 401);
    }

    // Rejected app-wide, not just at admin routes — a suspended user (set via the admin user
    // management screen) loses access to everything, same as a deleted/expired session would.
    if (user.status === 'suspended') {
      throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended', 403);
    }

    req.userId = user.id;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** Chain after requireAuth on any admin-only route — relies on req.user already being populated.
 *  See docs/calibration-console-spec.md for the higher-trust rater-access model this will need
 *  once that subsystem is built; this is just the plain admin/user-management gate for now. */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    next(new AppError('FORBIDDEN', 'Admin access required', 403));
    return;
  }
  next();
}
