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
    providers: authService.getAvailableProviders()
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
      redirectTo('/dashboard');
    } catch (error: any) {
      console.error(`[auth.routes] ${provider} sign-in failed:`, error.message || error);
      redirectTo('/login?error=oauth_failed');
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

export default router;
