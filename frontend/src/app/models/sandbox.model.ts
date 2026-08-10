export interface SandboxMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  flagged_gap: boolean;
  gap_note: string | null;
  created_at: string;
}

export interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  expires_at: string;
  created_at: string;
}
