jest.mock('../db/connection', () => ({ db: jest.fn() }));

import { Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { requireAuth, requireAdmin, AuthRequest } from './auth';
import { AppError } from '../types';

const dbMock = db as unknown as jest.Mock;

function makeBuilder(resolvedValue: any) {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.first = jest.fn(() => Promise.resolve(resolvedValue));
  return builder;
}

function mockNext() {
  return jest.fn() as unknown as NextFunction;
}

describe('requireAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects with 401 UNAUTHORIZED when there is no session_token cookie', async () => {
    const req = { cookies: {} } as unknown as AuthRequest;
    const next = mockNext();

    await requireAuth(req, {} as Response, next);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.status).toBe(401);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('rejects with 401 SESSION_EXPIRED when the token matches no live session', async () => {
    dbMock.mockImplementation((table: string) => {
      if (table === 'sessions') return makeBuilder(undefined);
      throw new Error(`unexpected table: ${table}`);
    });
    const req = { cookies: { session_token: 'tok-1' } } as unknown as AuthRequest;
    const next = mockNext();

    await requireAuth(req, {} as Response, next);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.code).toBe('SESSION_EXPIRED');
    expect(err.status).toBe(401);
  });

  it('rejects with 401 UNAUTHORIZED when the session references a user that no longer exists', async () => {
    dbMock.mockImplementation((table: string) => {
      if (table === 'sessions') return makeBuilder({ user_id: 'u1' });
      if (table === 'users') return makeBuilder(undefined);
      throw new Error(`unexpected table: ${table}`);
    });
    const req = { cookies: { session_token: 'tok-1' } } as unknown as AuthRequest;
    const next = mockNext();

    await requireAuth(req, {} as Response, next);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('rejects with 403 ACCOUNT_SUSPENDED for a suspended user, even with a valid session', async () => {
    dbMock.mockImplementation((table: string) => {
      if (table === 'sessions') return makeBuilder({ user_id: 'u1' });
      if (table === 'users') return makeBuilder({ id: 'u1', status: 'suspended' });
      throw new Error(`unexpected table: ${table}`);
    });
    const req = { cookies: { session_token: 'tok-1' } } as unknown as AuthRequest;
    const next = mockNext();

    await requireAuth(req, {} as Response, next);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.code).toBe('ACCOUNT_SUSPENDED');
    expect(err.status).toBe(403);
  });

  it('rejects with 403 ACCOUNT_PENDING for a pending user, even with a valid session', async () => {
    dbMock.mockImplementation((table: string) => {
      if (table === 'sessions') return makeBuilder({ user_id: 'u1' });
      if (table === 'users') return makeBuilder({ id: 'u1', status: 'pending' });
      throw new Error(`unexpected table: ${table}`);
    });
    const req = { cookies: { session_token: 'tok-1' } } as unknown as AuthRequest;
    const next = mockNext();

    await requireAuth(req, {} as Response, next);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.code).toBe('ACCOUNT_PENDING');
    expect(err.status).toBe(403);
  });

  it('populates req.userId/req.user and calls next() with no error for a valid, active session', async () => {
    const user = { id: 'u1', email: 'a@b.com', status: 'active', role: 'user' };
    dbMock.mockImplementation((table: string) => {
      if (table === 'sessions') return makeBuilder({ user_id: 'u1', token: 'tok-1' });
      if (table === 'users') return makeBuilder(user);
      throw new Error(`unexpected table: ${table}`);
    });
    const req = { cookies: { session_token: 'tok-1' } } as unknown as AuthRequest;
    const next = mockNext();

    await requireAuth(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.userId).toBe('u1');
    expect(req.user).toEqual(user);
  });
});

describe('requireAdmin', () => {
  it('calls next(FORBIDDEN) for a non-admin user', () => {
    const req = { user: { role: 'user' } } as unknown as AuthRequest;
    const next = mockNext();

    requireAdmin(req, {} as Response, next);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.status).toBe(403);
  });

  it('calls next(FORBIDDEN) when req.user is missing entirely', () => {
    const req = {} as unknown as AuthRequest;
    const next = mockNext();

    requireAdmin(req, {} as Response, next);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.code).toBe('FORBIDDEN');
  });

  it('calls next() with no error for an admin user', () => {
    const req = { user: { role: 'admin' } } as unknown as AuthRequest;
    const next = mockNext();

    requireAdmin(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});
