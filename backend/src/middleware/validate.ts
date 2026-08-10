import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';
import { AppError } from '../types';

export function validate(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error: any) {
      next(new AppError('VALIDATION_ERROR', 'Invalid request data', 400, error.issues));
    }
  };
}
