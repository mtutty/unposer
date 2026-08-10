import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types';
import { config } from '../config';

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error('Error:', err);

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(config.nodeEnv === 'development' && { details: err.details })
      }
    });
    return;
  }

  // Unknown errors
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.nodeEnv === 'development' ? err.message : 'An unexpected error occurred'
    }
  });
}
