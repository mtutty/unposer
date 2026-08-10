import { db } from '../db/connection';
import { config } from '../config';
import { AppError, User, Session } from '../types';

export class AuthService {
  getAvailableProviders(): string[] {
    const providers = ['dev'];

    if (config.oidc.google.clientId) providers.push('google');
    if (config.oidc.github.clientId) providers.push('github');

    return providers;
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
