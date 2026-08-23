import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { validate } from '../middleware/validate';
import { config } from '../config';
import type { User } from '../types';
import { z } from 'zod';

const router = Router();
const authService = new AuthService();

const devLoginSchema = z.object({
  username: z.string(),
  password: z.string()
});

const OAUTH_STATE_COOKIE = 'oauth_state';

// Get available OIDC providers
router.get('/providers', (req, res) => {
  res.json({
    providers: authService.getAvailableProviders(),
    // Login page indicator — see config.inviteOnly. Purely informational; the actual gate lives
    // in AuthService.upsertOidcUser, not here.
    inviteOnly: config.inviteOnly.enabled
  });
});

// Dev bypass login
router.post('/dev-login', validate(devLoginSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const { token, user } = await authService.devLogin(username, password);

    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

/**
 * Registers the two-route pattern every OIDC-ish provider needs: GET /:provider (redirect to
 * their consent screen, with a CSRF state cookie scoped to just this provider's path so
 * concurrently-registered providers can't collide) and GET /:provider/callback (verify state,
 * exchange the code via `login`, set session_token, redirect back to the app). The registered
 * "Authorized redirect URI" on the provider's side must exactly match what that provider's
 * `<provider>RedirectUri()` in auth.service.ts derives from FRONTEND_URL — see those comments.
 */
function registerOidcRoutes(
  provider: string,
  isConfigured: () => boolean,
  getAuthUrl: (state: string) => string,
  login: (code: string) => Promise<{ token: string; user: User }>
) {
  const cookiePath = `/api/auth/${provider}`;

  router.get(`/${provider}`, (req, res) => {
    if (!isConfigured()) {
      res.status(404).json({ error: { code: 'NOT_CONFIGURED', message: `${provider} sign-in is not configured` } });
      return;
    }

    const state = crypto.randomUUID();
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // must survive the provider's cross-site redirect back to /callback
      path: cookiePath,
      maxAge: 10 * 60 * 1000 // 10 minutes — only needs to live through the round trip and back
    });

    res.redirect(getAuthUrl(state));
  });

  router.get(`/${provider}/callback`, async (req, res) => {
    const redirectTo = (path: string) => res.redirect(`${config.frontendUrl}${path}`);

    if (req.query.error) {
      // User cancelled the consent screen, or the provider itself rejected the request.
      res.clearCookie(OAUTH_STATE_COOKIE, { path: cookiePath });
      redirectTo('/login?error=access_denied');
      return;
    }

    const state = req.query.state;
    const cookieState = req.cookies[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: cookiePath });

    if (!state || !cookieState || state !== cookieState) {
      redirectTo('/login?error=oauth_state_mismatch');
      return;
    }

    try {
      const code = req.query.code as string;
      const { token, user } = await login(code);

      res.cookie('session_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      console.log(`[auth.routes] ${provider} sign-in: ${user.email}`);
      // Admins land straight on the admin console — they have no candidate dashboard/profile of
      // their own (see authGuard on the frontend, which also bounces a direct /dashboard hit).
      // A freshly-created 'pending' account (invite-only self-registration — see upsertOidcUser)
      // goes to the waiting page instead; pendingGuard/authGuard would bounce it there anyway,
      // this just skips the extra round trip.
      redirectTo(user.status === 'pending' ? '/pending' : user.role === 'admin' ? '/admin/users' : '/dashboard');
    } catch (error: any) {
      console.error(`[auth.routes] ${provider} sign-in failed:`, error.message || error);
      // INVITE_ONLY (no invite on file, invite-only mode on) and EMAIL_IN_USE (email already
      // belongs to a different account) are the two AppErrors upsertOidcUser can throw — give
      // the login page enough to show a specific message for each rather than a generic failure.
      const code = error.code === 'INVITE_ONLY' || error.code === 'EMAIL_IN_USE' ? error.code.toLowerCase() : 'oauth_failed';
      redirectTo(`/login?error=${code}`);
    }
  });
}

registerOidcRoutes(
  'google',
  () => !!config.oidc.google.clientId,
  (state) => authService.getGoogleAuthUrl(state),
  (code) => authService.googleLogin(code)
);

registerOidcRoutes(
  'github',
  () => !!config.oidc.github.clientId,
  (state) => authService.getGithubAuthUrl(state),
  (code) => authService.githubLogin(code)
);

// Logout
router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies.session_token;
    if (token) {
      await authService.logout(token);
    }
    res.clearCookie('session_token');
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', async (req, res, next) => {
  try {
    const token = req.cookies.session_token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await authService.getCurrentUser(token);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Self-delete — deliberately doesn't go through requireAuth (a 'pending' account is exactly who
// needs this, and requireAuth would 403 it) — just needs a valid session, checked directly the
// same way GET /me does.
router.delete('/me', async (req, res, next) => {
  try {
    const token = req.cookies.session_token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = await authService.getCurrentUser(token);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    await authService.deleteOwnAccount(user.id);
    res.clearCookie('session_token');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
