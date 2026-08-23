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

// Same reasoning as googleRedirectUri() above.
function githubRedirectUri(): string {
  return `${config.frontendUrl}/api/auth/github/callback`;
}

// GitHub's REST API 403s any request with no User-Agent header.
const GITHUB_USER_AGENT = 'unposer-app';

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}
interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}
interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * Finds the existing (provider, subject) user and refreshes their display data, or creates a
 * new one. Shared by googleLogin/githubLogin — the only OIDC-specific work happens before this
 * (extracting sub/email/name/avatar from whatever shape that provider hands back).
 */
async function upsertOidcUser(params: {
  provider: string;
  subject: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}): Promise<User> {
  let user = await db('users').where({ oidc_provider: params.provider, oidc_subject: params.subject }).first();

  if (user) {
    // Display data can go stale between logins (name/photo changes) — refresh it each time.
    [user] = await db('users')
      .where({ id: user.id })
      .update({ name: params.name || user.name, avatar_url: params.avatarUrl || user.avatar_url, updated_at: new Date() })
      .returning('*');
    return user;
  }

  // No account already linked to this (provider, subject) — either this email has a pending
  // invite (role 'invited', no oidc_* yet — see AdminService.inviteUser) that this login should
  // claim, or it's brand new. Case-insensitive to match how AdminService.inviteUser looks
  // invites up.
  const existingByEmail = await db('users').whereRaw('lower(email) = lower(?)', [params.email]).first();

  if (existingByEmail && existingByEmail.role === 'invited') {
    // First real login for an invited user: claim the placeholder row rather than inserting a
    // new one — fills in the oidc identity and flips role 'invited' -> 'user'. invited_by/
    // invited_at are left as-is (see the migration's comment) so the admin list keeps showing
    // who invited them.
    [user] = await db('users')
      .where({ id: existingByEmail.id })
      .update({
        name: params.name || existingByEmail.email,
        avatar_url: params.avatarUrl,
        oidc_provider: params.provider,
        oidc_subject: params.subject,
        role: 'user',
        updated_at: new Date()
      })
      .returning('*');
    return user;
  }

  if (existingByEmail) {
    // users.email is globally unique — this email already belongs to a different, non-invited
    // account (e.g. a dev-created one, or a different provider). No account-linking policy
    // exists yet, so surface it clearly rather than letting the insert below crash with a raw
    // constraint-violation error.
    throw new AppError('EMAIL_IN_USE', 'An account with this email already exists', 409);
  }

  // Invitation-only mode: no existing row for this email at all means nobody invited them. Still
  // create the account rather than rejecting the login outright — just parked as 'pending' until
  // an admin approves it (flips status back to 'active' via the admin Users page). The frontend
  // routes a signed-in 'pending' user to a waiting page (see pendingGuard); requireAuth blocks
  // every candidate-flow route for them in the meantime the same way it blocks 'suspended'.
  const status = config.inviteOnly.enabled ? 'pending' : 'active';

  [user] = await db('users')
    .insert({
      email: params.email,
      name: params.name || params.email,
      avatar_url: params.avatarUrl,
      oidc_provider: params.provider,
      oidc_subject: params.subject,
      status
    })
    .returning('*');
  return user;
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

    const user = await upsertOidcUser({
      provider: 'google',
      subject: payload.sub,
      email: payload.email,
      name: payload.name || payload.email,
      avatarUrl: payload.picture || null
    });

    const session = await this.createSession(user.id);
    return { token: session.token, user };
  }

  /** state: same CSRF role as getGoogleAuthUrl's — see the oauth_state cookie in auth.routes.ts. */
  getGithubAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: config.oidc.github.clientId,
      redirect_uri: githubRedirectUri(),
      scope: 'read:user user:email',
      state
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async githubLogin(code: string): Promise<{ token: string; user: User }> {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.oidc.github.clientId,
        client_secret: config.oidc.github.clientSecret,
        code,
        redirect_uri: githubRedirectUri()
      })
    });
    const tokenBody = (await tokenRes.json()) as GithubTokenResponse;
    if (!tokenRes.ok || !tokenBody.access_token) {
      throw new AppError('OAUTH_ERROR', `GitHub token exchange failed: ${tokenBody.error_description || tokenBody.error || tokenRes.status}`, 502);
    }

    const githubHeaders = {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'User-Agent': GITHUB_USER_AGENT,
      Accept: 'application/vnd.github+json'
    };

    const profileRes = await fetch('https://api.github.com/user', { headers: githubHeaders });
    if (!profileRes.ok) {
      throw new AppError('OAUTH_ERROR', `GitHub profile fetch failed: ${profileRes.status}`, 502);
    }
    const profile = (await profileRes.json()) as GithubProfile;

    // GitHub omits `email` from /user when the account's email is private (common default) —
    // /user/emails (needs the user:email scope) returns it regardless of that visibility setting
    // since it's the authenticated user's own data.
    let email: string | null = profile.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', { headers: githubHeaders });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as GithubEmail[];
        email = emails.find((e) => e.primary && e.verified)?.email || emails.find((e) => e.verified)?.email || emails[0]?.email || null;
      }
    }
    if (!email) {
      throw new AppError('OAUTH_ERROR', "Couldn't get an email address from GitHub — check the account has a verified email", 400);
    }

    const user = await upsertOidcUser({
      provider: 'github',
      subject: String(profile.id),
      email,
      name: profile.name || profile.login,
      avatarUrl: profile.avatar_url || null
    });

    const session = await this.createSession(user.id);
    return { token: session.token, user };
  }

  async devLogin(username: string, password: string): Promise<{ token: string; user: User }> {
    if (!config.devAuth.enabled) {
      throw new AppError('UNAUTHORIZED', 'Dev auth is not enabled', 401);
    }

    // Two dev-bypass identities, so local/dev environments can reach admin-only screens (see
    // routes/admin.routes.ts) without wiring up real Google/GitHub OIDC. `role: 'admin'` is only
    // set on first insert — an admin later demoting this user via the admin API isn't silently
    // re-promoted on next dev-login.
    let subject: string;
    let seed: { email: string; name: string; role: 'admin' | 'user' };
    if (username === config.devAuth.username && password === config.devAuth.password) {
      subject = 'dev-user';
      seed = { email: 'dev@example.com', name: 'Dev User', role: 'user' };
    } else if (username === config.devAuth.adminUsername && password === config.devAuth.adminPassword) {
      subject = 'dev-admin';
      seed = { email: 'devadmin@example.com', name: 'Dev Admin', role: 'admin' };
    } else {
      throw new AppError('UNAUTHORIZED', 'Invalid credentials', 401);
    }

    // Create or get the dev user for this identity
    let user = await db('users')
      .where({ oidc_provider: 'dev', oidc_subject: subject })
      .first();

    if (!user) {
      [user] = await db('users')
        .insert({
          email: seed.email,
          name: seed.name,
          oidc_provider: 'dev',
          oidc_subject: subject,
          role: seed.role
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

    // Single choke point for every login path (Google, GitHub, dev) — see each *Login method
    // above, all of which end here — so last_login_at only needs updating in one place.
    await db('users').where({ id: userId }).update({ last_login_at: new Date() });

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

  /** Self-service account deletion — currently only exposed to a signed-in user from the
   *  "pending approval" waiting page (see PendingApprovalComponent / DELETE /api/auth/me), so
   *  they can back out of an invite-only signup without waiting on an admin. Sessions cascade-
   *  delete with the user row (see the sessions migration's onDelete('CASCADE')). */
  async deleteOwnAccount(userId: string): Promise<void> {
    await db('users').where({ id: userId }).delete();
  }
}
