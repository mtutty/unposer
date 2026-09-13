jest.mock('../db/connection', () => ({ db: jest.fn() }));

const mockConfig = {
  frontendUrl: 'http://localhost:4200',
  session: { expiryDays: 7 },
  inviteOnly: { enabled: false },
  testLogin: { enabled: true },
  oidc: {
    google: { clientId: '', clientSecret: '' },
    github: { clientId: 'gh-client', clientSecret: 'gh-secret' }
  }
};
jest.mock('../config', () => ({ config: mockConfig }));

import { db } from '../db/connection';
import { AuthService } from './auth.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.whereRaw = jest.fn(() => builder);
  builder.first = jest.fn();
  builder.update = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.returning = jest.fn();
  return builder;
}

function githubProfileFixture() {
  return { id: 42, login: 'octocat', name: 'The Octocat', email: 'octo@example.com', avatar_url: 'https://example.com/a.png' };
}

// upsertOidcUser (the interesting logic — invite-only gating, invited-row claiming, email
// conflicts) is a private helper in auth.service.ts, only reachable through a login method. Every
// OIDC provider funnels through it identically (see the shared implementation), so exercising it
// via githubLogin — the one with no external SDK to mock, just plain fetch — covers google's path
// too without duplicating these cases per provider.
describe('AuthService (upsertOidcUser via githubLogin)', () => {
  let service: AuthService;
  let usersBuilder: ReturnType<typeof makeBuilder>;
  let sessionsBuilder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.inviteOnly.enabled = false;
    service = new AuthService();
    usersBuilder = makeBuilder();
    sessionsBuilder = makeBuilder();
    sessionsBuilder.insert = jest.fn(() => sessionsBuilder);
    sessionsBuilder.returning.mockResolvedValue([{ id: 'sess-1', user_id: 'u1', token: 'tok' }]);
    mockDb.mockImplementation((table: string) => (table === 'sessions' ? sessionsBuilder : usersBuilder));

    fetchSpy = jest.spyOn(global, 'fetch' as any).mockImplementation((url: any) => {
      if (String(url).includes('access_token')) {
        return Promise.resolve({ ok: true, json: async () => ({ access_token: 'gh-token' }) } as any);
      }
      if (String(url).includes('/user/emails')) {
        return Promise.resolve({ ok: true, json: async () => [] } as any);
      }
      return Promise.resolve({ ok: true, json: async () => githubProfileFixture() } as any);
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('refreshes and returns an existing (provider, subject) account without touching invite logic', async () => {
    usersBuilder.first.mockResolvedValueOnce({ id: 'u1', role: 'user' }); // (oidc_provider, oidc_subject) match
    usersBuilder.returning.mockResolvedValueOnce([{ id: 'u1', role: 'user', name: 'The Octocat' }]);

    const { user } = await service.githubLogin('code');

    expect(user).toEqual({ id: 'u1', role: 'user', name: 'The Octocat' });
    expect(usersBuilder.whereRaw).not.toHaveBeenCalled();
  });

  it('inserts a brand-new account when nothing matches and invite-only mode is off', async () => {
    usersBuilder.first
      .mockResolvedValueOnce(undefined) // (provider, subject) lookup
      .mockResolvedValueOnce(undefined); // email lookup
    usersBuilder.returning.mockResolvedValueOnce([{ id: 'u2', role: 'user', email: 'octo@example.com' }]);

    const { user } = await service.githubLogin('code');

    expect(usersBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'octo@example.com', oidc_provider: 'github', oidc_subject: '42' })
    );
    expect(user.email).toBe('octo@example.com');
  });

  it('creates a pending account (rather than rejecting) for a brand-new email when invite-only mode is on', async () => {
    mockConfig.inviteOnly.enabled = true;
    usersBuilder.first.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    usersBuilder.returning.mockResolvedValueOnce([{ id: 'u2', role: 'user', status: 'pending', email: 'octo@example.com' }]);

    const { user } = await service.githubLogin('code');

    expect(usersBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'octo@example.com', status: 'pending' })
    );
    expect(user.status).toBe('pending');
  });

  it('claims a pending invite (role invited) by email, flipping it to invited_role regardless of invite-only mode', async () => {
    mockConfig.inviteOnly.enabled = true; // must still work — invite-only only gates self-registration
    usersBuilder.first
      .mockResolvedValueOnce(undefined) // (provider, subject) lookup
      .mockResolvedValueOnce({ id: 'u3', email: 'octo@example.com', role: 'invited', invited_role: 'user', invited_by: 'admin-1' }); // email lookup
    usersBuilder.returning.mockResolvedValueOnce([{ id: 'u3', role: 'user', email: 'octo@example.com' }]);

    const { user } = await service.githubLogin('code');

    expect(usersBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', oidc_provider: 'github', oidc_subject: '42' })
    );
    expect(usersBuilder.insert).not.toHaveBeenCalled();
    expect(user.role).toBe('user');
  });

  it('claims a pending employer invite, flipping it to role employer (docs/employer-onboarding-spec.md §2.1)', async () => {
    usersBuilder.first
      .mockResolvedValueOnce(undefined) // (provider, subject) lookup
      .mockResolvedValueOnce({ id: 'u5', email: 'octo@example.com', role: 'invited', invited_role: 'employer', invited_by: 'admin-1' }); // email lookup
    usersBuilder.returning.mockResolvedValueOnce([{ id: 'u5', role: 'employer', email: 'octo@example.com' }]);

    const { user } = await service.githubLogin('code');

    expect(usersBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'employer', oidc_provider: 'github', oidc_subject: '42' })
    );
    expect(user.role).toBe('employer');
  });

  it('rejects with EMAIL_IN_USE when the email already belongs to a different, non-invited account', async () => {
    usersBuilder.first
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 'u4', email: 'octo@example.com', role: 'user' });

    await expect(service.githubLogin('code')).rejects.toMatchObject({ code: 'EMAIL_IN_USE' });
    expect(usersBuilder.insert).not.toHaveBeenCalled();
    expect(usersBuilder.update).not.toHaveBeenCalled();
  });
});

describe('AuthService.testLogin', () => {
  let service: AuthService;
  let usersBuilder: ReturnType<typeof makeBuilder>;
  let sessionsBuilder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.testLogin.enabled = true;
    service = new AuthService();
    usersBuilder = makeBuilder();
    sessionsBuilder = makeBuilder();
    sessionsBuilder.insert = jest.fn(() => sessionsBuilder);
    sessionsBuilder.returning.mockResolvedValue([{ id: 'sess-1', user_id: 'u1', token: 'tok' }]);
    mockDb.mockImplementation((table: string) => (table === 'sessions' ? sessionsBuilder : usersBuilder));
  });

  it('throws UNAUTHORIZED without touching the db when disabled', async () => {
    mockConfig.testLogin.enabled = false;

    await expect(service.testLogin('devuser')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(usersBuilder.whereRaw).not.toHaveBeenCalled();
  });

  it('rejects a blank identifier', async () => {
    await expect(service.testLogin('   ')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('logs into an existing account by email, whatever its real role/status, without inserting', async () => {
    usersBuilder.first.mockResolvedValueOnce({ id: 'u9', email: 'real.candidate@example.com', role: 'employer', status: 'active' });

    const { user, token } = await service.testLogin('Real.Candidate@example.com');

    expect(usersBuilder.whereRaw).toHaveBeenCalledWith('lower(email) = ?', ['real.candidate@example.com']);
    expect(usersBuilder.insert).not.toHaveBeenCalled();
    expect(user.role).toBe('employer');
    expect(token).toBe('tok');
  });

  it('expands a bare word with no "@" to <word>@example.com and creates a plain user account', async () => {
    usersBuilder.first.mockResolvedValueOnce(undefined);
    usersBuilder.returning.mockResolvedValueOnce([{ id: 'u10', email: 'someone@example.com', role: 'user' }]);

    await service.testLogin('someone');

    expect(usersBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'someone@example.com', role: 'user', oidc_provider: 'test', oidc_subject: 'someone@example.com' })
    );
  });

  it('bootstraps "devadmin" (only on first insert) as a role:admin account', async () => {
    usersBuilder.first.mockResolvedValueOnce(undefined);
    usersBuilder.returning.mockResolvedValueOnce([{ id: 'u11', email: 'devadmin@example.com', role: 'admin' }]);

    const { user } = await service.testLogin('devadmin');

    expect(usersBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
    expect(user.role).toBe('admin');
  });

  it('does not re-promote devadmin to admin on a later login once an admin has demoted it', async () => {
    usersBuilder.first.mockResolvedValueOnce({ id: 'u11', email: 'devadmin@example.com', role: 'user' });

    const { user } = await service.testLogin('devadmin');

    expect(usersBuilder.insert).not.toHaveBeenCalled();
    expect(user.role).toBe('user');
  });

  it('creates a brand-new real email as a plain user account', async () => {
    usersBuilder.first.mockResolvedValueOnce(undefined);
    usersBuilder.returning.mockResolvedValueOnce([{ id: 'u12', email: 'a.new.candidate@example.com', role: 'user' }]);

    await service.testLogin('a.new.candidate@example.com');

    expect(usersBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a.new.candidate@example.com', name: 'A New Candidate', role: 'user' })
    );
  });
});
