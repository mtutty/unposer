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

    req.userId = user.id;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
