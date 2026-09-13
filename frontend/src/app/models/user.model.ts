// 'invited' = an admin-created placeholder that hasn't signed in yet (see Invitation-only mode
// in CLAUDE.md); it flips to whatever role the invite targeted (see invited_role) automatically
// on first login. 'employer' (docs/employer-onboarding-spec.md §2.1) is invite-only, same
// mechanism as an ordinary invite, just targeting that role instead of 'user'.
export type UserRole = 'user' | 'admin' | 'invited' | 'employer';
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
