jest.mock('../config', () => ({
  config: {
    frontendUrl: 'http://localhost:4200',
    nodeEnv: 'test',
    inviteOnly: { enabled: false },
    oidc: {
      google: { clientId: '', clientSecret: '' },
      github: { clientId: '', clientSecret: '' }
    }
  }
}));

// auth.service.ts pulls in db/connection.ts at import time (for real, even though we're about to
// jest.mock the service itself — auto-mocking still evaluates the real module to derive its
// shape), which tries to open a real knex connection using env config that doesn't exist under
// `jest`. Stub it out the same way email.service.test.ts does.
jest.mock('../db/connection', () => ({ db: jest.fn() }));
jest.mock('../services/auth.service');

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthService } from '../services/auth.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import authRoutes from './auth.routes';
import { config } from '../config';

// auth.routes.ts does `new AuthService()` once at module load — this is that same instance,
// with every method auto-mocked by jest.mock above.
const mockAuthService = (AuthService as jest.MockedClass<typeof AuthService>).mock.instances[0] as jest.Mocked<AuthService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/', authRoutes);
  app.use(errorHandler);
  return app;
}

describe('auth.routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /providers', () => {
    it('returns whatever AuthService reports as available', async () => {
      mockAuthService.getAvailableProviders.mockReturnValue(['google']);

      const res = await request(app).get('/providers');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ providers: ['google'], inviteOnly: false });
    });

    it('reflects config.inviteOnly.enabled', async () => {
      mockAuthService.getAvailableProviders.mockReturnValue([]);
      (config.inviteOnly as any).enabled = true;

      const res = await request(app).get('/providers');

      expect(res.body.inviteOnly).toBe(true);
      (config.inviteOnly as any).enabled = false;
    });
  });

  describe('POST /dev-login', () => {
    it('rejects a body missing username/password before ever calling the service', async () => {
      const res = await request(app).post('/dev-login').send({ username: 'devuser' });

      expect(res.status).toBe(400);
      expect(mockAuthService.devLogin).not.toHaveBeenCalled();
    });

    it('sets an httpOnly session_token cookie and returns the user on success', async () => {
      mockAuthService.devLogin.mockResolvedValue({
        token: 'tok-123',
        user: { id: 'u1', email: 'dev@example.com', name: 'Dev User', role: 'user' } as any
      });

      const res = await request(app).post('/dev-login').send({ username: 'devuser', password: 'devpass' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('dev@example.com');
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('session_token=tok-123'))).toBe(true);
      expect(cookies.some((c) => /HttpOnly/i.test(c))).toBe(true);
    });

    it('propagates a service AppError (e.g. dev auth disabled) as its status/code, not a 500', async () => {
      mockAuthService.devLogin.mockRejectedValue(new AppError('UNAUTHORIZED', 'Dev auth is not enabled', 401));

      const res = await request(app).post('/dev-login').send({ username: 'x', password: 'y' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /:provider (OIDC start)', () => {
    it('404s when the provider has no client id configured', async () => {
      const res = await request(app).get('/google');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_CONFIGURED');
    });

    it('sets a state cookie scoped to the provider path and redirects to the auth URL when configured', async () => {
      (config as any).oidc.google.clientId = 'configured-client-id';
      mockAuthService.getGoogleAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?state=abc');

      const res = await request(app).get('/google');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://accounts.google.com/o/oauth2/auth?state=abc');
      const cookies = res.headers['set-cookie'] as unknown as string[];
      const stateCookie = cookies.find((c) => c.startsWith('oauth_state='));
      expect(stateCookie).toBeDefined();
      expect(stateCookie).toMatch(/Path=\/api\/auth\/google/);

      (config as any).oidc.google.clientId = '';
    });
  });

  describe('GET /:provider/callback', () => {
    it('redirects to /login?error=access_denied when the provider reports an error, and clears the state cookie', async () => {
      const res = await request(app).get('/google/callback').query({ error: 'access_denied' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:4200/login?error=access_denied');
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('oauth_state=;'))).toBe(true);
    });

    it('redirects to /login?error=oauth_state_mismatch when the state cookie is missing or does not match', async () => {
      const res = await request(app)
        .get('/google/callback')
        .query({ state: 'abc', code: 'authcode' })
        .set('Cookie', 'oauth_state=different-state');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:4200/login?error=oauth_state_mismatch');
      expect(mockAuthService.googleLogin).not.toHaveBeenCalled();
    });

    it('on matching state, logs in and redirects candidates to /dashboard', async () => {
      mockAuthService.googleLogin.mockResolvedValue({
        token: 'tok-456',
        user: { id: 'u2', email: 'candidate@example.com', role: 'user' } as any
      });

      const res = await request(app)
        .get('/google/callback')
        .query({ state: 'abc', code: 'authcode' })
        .set('Cookie', 'oauth_state=abc');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:4200/dashboard');
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('session_token=tok-456'))).toBe(true);
    });

    it('redirects admins to /admin/users instead of /dashboard', async () => {
      mockAuthService.googleLogin.mockResolvedValue({
        token: 'tok-789',
        user: { id: 'u3', email: 'admin@example.com', role: 'admin' } as any
      });

      const res = await request(app)
        .get('/google/callback')
        .query({ state: 'abc', code: 'authcode' })
        .set('Cookie', 'oauth_state=abc');

      expect(res.headers.location).toBe('http://localhost:4200/admin/users');
    });

    it('redirects to /login?error=oauth_failed when the token exchange throws', async () => {
      mockAuthService.googleLogin.mockRejectedValue(new Error('token exchange failed'));

      const res = await request(app)
        .get('/google/callback')
        .query({ state: 'abc', code: 'authcode' })
        .set('Cookie', 'oauth_state=abc');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:4200/login?error=oauth_failed');
    });

    it('redirects to /login?error=invite_only when upsertOidcUser rejects with an INVITE_ONLY AppError', async () => {
      mockAuthService.googleLogin.mockRejectedValue(new AppError('INVITE_ONLY', 'nope', 403));

      const res = await request(app)
        .get('/google/callback')
        .query({ state: 'abc', code: 'authcode' })
        .set('Cookie', 'oauth_state=abc');

      expect(res.headers.location).toBe('http://localhost:4200/login?error=invite_only');
    });

    it('redirects to /login?error=email_in_use when upsertOidcUser rejects with an EMAIL_IN_USE AppError', async () => {
      mockAuthService.googleLogin.mockRejectedValue(new AppError('EMAIL_IN_USE', 'nope', 409));

      const res = await request(app)
        .get('/google/callback')
        .query({ state: 'abc', code: 'authcode' })
        .set('Cookie', 'oauth_state=abc');

      expect(res.headers.location).toBe('http://localhost:4200/login?error=email_in_use');
    });
  });

  describe('POST /logout', () => {
    it('clears the session cookie and reports success even with no session_token present', async () => {
      const res = await request(app).post('/logout');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockAuthService.logout).not.toHaveBeenCalled();
    });

    it('logs out the session and clears the cookie when a session_token is present', async () => {
      const res = await request(app).post('/logout').set('Cookie', 'session_token=tok-123');

      expect(res.status).toBe(200);
      expect(mockAuthService.logout).toHaveBeenCalledWith('tok-123');
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('session_token=;'))).toBe(true);
    });
  });

  describe('GET /me', () => {
    it('401s with no session_token cookie, without calling the service', async () => {
      const res = await request(app).get('/me');

      expect(res.status).toBe(401);
      expect(mockAuthService.getCurrentUser).not.toHaveBeenCalled();
    });

    it('returns the user for a valid session_token', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue({ id: 'u1', email: 'dev@example.com' } as any);

      const res = await request(app).get('/me').set('Cookie', 'session_token=tok-123');

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('dev@example.com');
      expect(mockAuthService.getCurrentUser).toHaveBeenCalledWith('tok-123');
    });
  });
});
