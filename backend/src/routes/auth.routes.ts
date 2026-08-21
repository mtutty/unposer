import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { validate } from '../middleware/validate';
import { config } from '../config';
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

// Kick off Google sign-in: redirect to Google's consent screen. The registered "Authorized
// redirect URI" in Google Cloud Console must exactly match what auth.service.ts's
// googleRedirectUri() derives from FRONTEND_URL — see that file's comment for the exact values.
router.get('/google', (req, res) => {
  if (!config.oidc.google.clientId) {
    res.status(404).json({ error: { code: 'NOT_CONFIGURED', message: 'Google sign-in is not configured' } });
    return;
  }

  const state = crypto.randomUUID();
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // must survive Google's cross-site redirect back to /google/callback
    path: '/api/auth/google',
    maxAge: 10 * 60 * 1000 // 10 minutes — only needs to live through the round trip to Google and back
  });

  res.redirect(authService.getGoogleAuthUrl(state));
});

// Google redirects here after consent (or cancellation/failure).
router.get('/google/callback', async (req, res) => {
  const redirectTo = (path: string) => res.redirect(`${config.frontendUrl}${path}`);

  if (req.query.error) {
    // User cancelled the consent screen, or Google itself rejected the request.
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth/google' });
    redirectTo('/login?error=access_denied');
    return;
  }

  const state = req.query.state;
  const cookieState = req.cookies[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth/google' });

  if (!state || !cookieState || state !== cookieState) {
    redirectTo('/login?error=oauth_state_mismatch');
    return;
  }

  try {
    const code = req.query.code as string;
    const { token, user } = await authService.googleLogin(code);

    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    console.log(`[auth.routes] Google sign-in: ${user.email}`);
    redirectTo('/dashboard');
  } catch (error: any) {
    console.error('[auth.routes] Google sign-in failed:', error.message || error);
    redirectTo('/login?error=oauth_failed');
  }
});

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
