// What grounded a sandbox reply — see backend/src/types/index.ts's SandboxCitation for the
// server-side source of truth this mirrors.
export interface SandboxCitation {
  source: 'work_history' | 'insight' | 'star_story' | 'goals' | 'preferences' | 'work_style';
  label: string;
  detail: string;
}

export interface SandboxMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  flagged_gap: boolean;
  gap_note: string | null;
  citations: SandboxCitation[] | null;
  created_at: string;
}

export interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  expires_at: string;
  created_at: string;
}
