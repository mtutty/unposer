import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();
const authService = new AuthService();

const devLoginSchema = z.object({
  username: z.string(),
  password: z.string()
});

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
