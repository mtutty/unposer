jest.mock('../db/connection', () => ({ db: jest.fn() }));

// Unlike other route tests, requireAdmin is left as the *real* implementation here (its own
// behavior is covered separately in middleware/auth.test.ts) — this file mounts every route
// behind `router.use(requireAuth, requireAdmin)`, and that admin gate is exactly what's worth
// proving actually wires up correctly for this router. Only requireAuth's session/db lookup is
// stubbed, driven by test headers instead.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    requireAuth: (req: any, res: any, next: any) => {
      const userId = req.header('x-test-user');
      if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session token provided' } });
        return;
      }
      req.userId = userId;
      req.user = { id: userId, role: req.header('x-test-role') || 'user' };
      next();
    }
  };
});

jest.mock('../services/admin.service');

import express from 'express';
import request from 'supertest';
import { AdminService } from '../services/admin.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import adminRoutes from './admin.routes';

const mockAdminService = (AdminService as jest.MockedClass<typeof AdminService>).mock.instances[0] as jest.Mocked<AdminService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminRoutes);
  app.use(errorHandler);
  return app;
}

function asAdmin(req: request.Test) {
  return req.set('x-test-user', 'admin-1').set('x-test-role', 'admin');
}

describe('admin.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('403s a non-admin authenticated user on every route', async () => {
    const res = await request(app).get('/users').set('x-test-user', 'u1').set('x-test-role', 'user');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockAdminService.listUsers).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated request before the admin check ever runs', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(401);
  });

  describe('GET /users', () => {
    it('parses q/role/status/limit/offset from the query string, dropping invalid enum values', async () => {
      mockAdminService.listUsers.mockResolvedValue({ users: [], total: 0 } as any);

      const res = await asAdmin(request(app).get('/users')).query({
        q: 'ada',
        role: 'not-a-real-role',
        status: 'suspended',
        limit: '10',
        offset: '20'
      });

      expect(res.status).toBe(200);
      expect(mockAdminService.listUsers).toHaveBeenCalledWith({
        q: 'ada',
        role: undefined,
        status: 'suspended',
        limit: 10,
        offset: 20
      });
    });

    it("accepts role='invited' (pending-invite filter)", async () => {
      mockAdminService.listUsers.mockResolvedValue({ users: [], total: 0 } as any);

      await asAdmin(request(app).get('/users')).query({ role: 'invited' });

      expect(mockAdminService.listUsers).toHaveBeenCalledWith(expect.objectContaining({ role: 'invited' }));
    });
  });

  describe('POST /users/invite', () => {
    it('rejects an invalid email before calling the service', async () => {
      const res = await asAdmin(request(app).post('/users/invite')).send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(mockAdminService.inviteUser).not.toHaveBeenCalled();
    });

    it('creates the invite, passing the caller id and optional message through', async () => {
      mockAdminService.inviteUser.mockResolvedValue({ id: 'u3', email: 'new@example.com', role: 'invited' } as any);

      const res = await asAdmin(request(app).post('/users/invite')).send({ email: 'new@example.com', message: 'Welcome!' });

      expect(res.status).toBe(201);
      expect(mockAdminService.inviteUser).toHaveBeenCalledWith('new@example.com', 'admin-1', 'Welcome!');
      expect(res.body.user.role).toBe('invited');
    });

    it('propagates a service AppError (e.g. email already in use)', async () => {
      mockAdminService.inviteUser.mockRejectedValue(new AppError('EMAIL_IN_USE', 'An account with this email already exists', 409));

      const res = await asAdmin(request(app).post('/users/invite')).send({ email: 'taken@example.com' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_IN_USE');
    });
  });

  describe('DELETE /users/:id/invite', () => {
    it('revokes the invite and returns 204', async () => {
      mockAdminService.revokeInvite.mockResolvedValue(undefined);

      const res = await asAdmin(request(app).delete('/users/u3/invite'));

      expect(res.status).toBe(204);
      expect(mockAdminService.revokeInvite).toHaveBeenCalledWith('u3');
    });

    it('propagates a service AppError (e.g. target is not a pending invite)', async () => {
      mockAdminService.revokeInvite.mockRejectedValue(new AppError('NOT_AN_INVITE', 'Only a pending invite can be revoked', 400));

      const res = await asAdmin(request(app).delete('/users/u2/invite'));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NOT_AN_INVITE');
    });
  });

  describe('GET /users/:id', () => {
    it('404s when the user does not exist', async () => {
      mockAdminService.getUser.mockResolvedValue(undefined);

      const res = await asAdmin(request(app).get('/users/nope'));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns the user when found', async () => {
      mockAdminService.getUser.mockResolvedValue({ id: 'u2', email: 'x@y.com' } as any);

      const res = await asAdmin(request(app).get('/users/u2'));

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe('u2');
    });
  });

  it('GET /users/:id/detail returns the full accumulated-data rollup', async () => {
    mockAdminService.getUserDetail.mockResolvedValue({ resume: null, logistics: null } as any);

    const res = await asAdmin(request(app).get('/users/u2/detail'));

    expect(res.status).toBe(200);
    expect(mockAdminService.getUserDetail).toHaveBeenCalledWith('u2');
  });

  describe('POST /users/:id/reset', () => {
    it('rejects a body missing confirmEmail before calling the service', async () => {
      const res = await asAdmin(request(app).post('/users/u2/reset')).send({});

      expect(res.status).toBe(400);
      expect(mockAdminService.resetUserData).not.toHaveBeenCalled();
    });

    it('passes the confirmation email through and returns the reset user', async () => {
      mockAdminService.resetUserData.mockResolvedValue({ id: 'u2' } as any);

      const res = await asAdmin(request(app).post('/users/u2/reset')).send({ confirmEmail: 'candidate@example.com' });

      expect(res.status).toBe(200);
      expect(mockAdminService.resetUserData).toHaveBeenCalledWith('u2', 'candidate@example.com');
    });

    it('propagates a service AppError (e.g. email mismatch) as its own status/code', async () => {
      mockAdminService.resetUserData.mockRejectedValue(new AppError('CONFIRMATION_MISMATCH', 'Email does not match', 400));

      const res = await asAdmin(request(app).post('/users/u2/reset')).send({ confirmEmail: 'wrong@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CONFIRMATION_MISMATCH');
    });
  });

  describe('PATCH /users/:id', () => {
    it('rejects a body with neither role nor status', async () => {
      const res = await asAdmin(request(app).patch('/users/u2')).send({});

      expect(res.status).toBe(400);
      expect(mockAdminService.updateUser).not.toHaveBeenCalled();
    });

    it('blocks an admin from modifying their own role/status, without calling the service', async () => {
      const res = await asAdmin(request(app).patch('/users/admin-1')).send({ status: 'suspended' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
      expect(mockAdminService.updateUser).not.toHaveBeenCalled();
    });

    it("updates a different user's role/status", async () => {
      mockAdminService.updateUser.mockResolvedValue({ id: 'u2', role: 'admin' } as any);

      const res = await asAdmin(request(app).patch('/users/u2')).send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(mockAdminService.updateUser).toHaveBeenCalledWith('u2', { role: 'admin' });
    });
  });
});
