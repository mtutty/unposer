import { OAuth2Client } from 'google-auth-library';
import { db } from '../db/connection';
import { config } from '../config';
import { AppError, User, Session } from '../types';

// Google requires this to be pre-registered in Cloud Console and to match exactly what's sent
// in both the auth-URL request and the token exchange. Derived from FRONTEND_URL rather than a
// separate env var so it can't drift out of sync with the CORS origin, which is already keyed
// off the same value (see app.ts). Production: https://unposer.com/api/auth/google/callback.
// Local dev: http://localhost:4200/api/auth/google/callback (frontend/proxy.conf.json already
// proxies /api from :4200 to the backend).
function googleRedirectUri(): string {
  return `${config.frontendUrl}/api/auth/google/callback`;
}

let googleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!googleClient) {
    googleClient = new OAuth2Client({
      clientId: config.oidc.google.clientId,
      clientSecret: config.oidc.google.clientSecret,
      redirectUri: googleRedirectUri()
    });
  }
  return googleClient;
}

export class AuthService {
  getAvailableProviders(): string[] {
    const providers = ['dev'];

    if (config.oidc.google.clientId) providers.push('google');
    if (config.oidc.github.clientId) providers.push('github');

    return providers;
  }

  /** state: caller-generated CSRF token — see the oauth_state cookie in auth.routes.ts, which
   *  is what makes this safe against a forged callback. */
  getGoogleAuthUrl(state: string): string {
    return getGoogleClient().generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state
    });
  }

  async googleLogin(code: string): Promise<{ token: string; user: User }> {
    const client = getGoogleClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new AppError('OAUTH_ERROR', 'Google did not return an ID token', 502);
    }

    // Verifies signature, issuer, audience, and expiry against Google's published keys — this
    // id_token came straight from Google's token endpoint over TLS, but we still verify it
    // properly rather than just decoding it, since that's what this library is for.
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.oidc.google.clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new AppError('OAUTH_ERROR', 'Google ID token missing required claims', 502);
    }

    let user = await db('users').where({ oidc_provider: 'google', oidc_subject: payload.sub }).first();

    if (user) {
      // Display data can go stale between logins (name/photo changes) — refresh it each time.
      [user] = await db('users')
        .where({ id: user.id })
        .update({ name: payload.name || user.name, avatar_url: payload.picture || user.avatar_url, updated_at: new Date() })
        .returning('*');
    } else {
      try {
        [user] = await db('users')
          .insert({
            email: payload.email,
            name: payload.name || payload.email,
            avatar_url: payload.picture || null,
            oidc_provider: 'google',
            oidc_subject: payload.sub
          })
          .returning('*');
      } catch (err: any) {
        if (err.code === '23505') {
          // users.email is globally unique — this email already belongs to a different account
          // (e.g. a dev-created one). No account-linking policy exists yet, so surface it
          // clearly rather than crashing with a raw constraint-violation error.
          throw new AppError('EMAIL_IN_USE', 'An account with this email already exists', 409);
        }
        throw err;
      }
    }

    const session = await this.createSession(user.id);
    return { token: session.token, user };
  }

  async devLogin(username: string, password: string): Promise<{ token: string; user: User }> {
    if (!config.devAuth.enabled) {
      throw new AppError('UNAUTHORIZED', 'Dev auth is not enabled', 401);
    }

    if (username !== config.devAuth.username || password !== config.devAuth.password) {
      throw new AppError('UNAUTHORIZED', 'Invalid credentials', 401);
    }

    // Create or get dev user
    let user = await db('users')
      .where({ oidc_provider: 'dev', oidc_subject: 'dev-user' })
      .first();

    if (!user) {
      [user] = await db('users')
        .insert({
          email: 'dev@example.com',
          name: 'Dev User',
          oidc_provider: 'dev',
          oidc_subject: 'dev-user'
        })
        .returning('*');
    }

    const session = await this.createSession(user.id);
    return { token: session.token, user };
  }

  async createSession(userId: string): Promise<Session> {
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.session.expiryDays);

    const [session] = await db('sessions')
      .insert({
        user_id: userId,
        token,
        expires_at: expiresAt
      })
      .returning('*');

    return session;
  }

  async getCurrentUser(token: string): Promise<User | null> {
    const session = await db('sessions')
      .where({ token })
      .where('expires_at', '>', new Date())
      .first();

    if (!session) {
      return null;
    }

    const user = await db('users')
      .where({ id: session.user_id })
      .first();

    return user || null;
  }

  async logout(token: string): Promise<void> {
    await db('sessions').where({ token }).delete();
  }
}
