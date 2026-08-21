import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { validate } from './validate';
import { AppError } from '../types';

function mockNext() {
  return jest.fn() as unknown as NextFunction;
}

describe('validate middleware', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('calls next() with no error when the body matches the schema', () => {
    const req = { body: { name: 'Ada' } } as Request;
    const next = mockNext();

    validate(schema)(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(AppError) with a 400 when the body fails validation', () => {
    const req = { body: { name: '' } } as Request;
    const next = mockNext();

    validate(schema)(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
  });

  it('rejects a body missing a required field', () => {
    const req = { body: {} } as Request;
    const next = mockNext();

    validate(schema)(req, {} as Response, next);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
  });
});
