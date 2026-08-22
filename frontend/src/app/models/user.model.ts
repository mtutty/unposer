export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  oidc_provider: string;
  role: UserRole;
  status: UserStatus;
  last_login_at: string | null;
  created_at?: string;
}
