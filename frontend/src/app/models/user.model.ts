// 'invited' = an admin-created placeholder that hasn't signed in yet (see Invitation-only mode
// in CLAUDE.md); it flips to 'user' automatically on first login.
export type UserRole = 'user' | 'admin' | 'invited';
// 'pending' = self-registered while invite-only mode was on — awaiting an admin's approval (see
// pendingGuard / PendingApprovalComponent).
export type UserStatus = 'active' | 'suspended' | 'pending';

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
