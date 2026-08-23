// 'invited' = an admin-created placeholder that hasn't signed in yet (see Invitation-only mode
// in CLAUDE.md); it flips to 'user' automatically on first login.
export type UserRole = 'user' | 'admin' | 'invited';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  oidc_provider: string | null;
  role: UserRole;
  status: UserStatus;
  last_login_at: string | null;
  invited_by?: string | null;
  invited_at?: string | null;
  created_at?: string;
}
