// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  oidc_provider: 'google' | 'github' | 'linkedin' | 'facebook' | 'dev';
  oidc_subject: string;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Flow progress (server-driven step machine — see models/flow-steps.ts)
// ---------------------------------------------------------------------------

export type FlowStepId =
  | 'resume'
  | 'logistics'
  | 'deep_prompts'
  | 'profile_review'
  | 'sandbox'
  | 'share';

// UI-facing grouping only — the 6 FlowStepIds above remain the unit of progress tracking
// (steps_state, completion criteria, data tables all key off them unchanged). "story" bundles
// resume/logistics/deep_prompts into one rail entry ("Tell Your Story"); "interview" bundles
// profile_review/sandbox/share ("Interview Yourself"), where sandbox and share are reached as
// CTAs from within the stage rather than as their own rail tabs. See models/flow-steps.ts.
export type FlowStageId = 'story' | 'interview';

export type StepStatus = 'pending' | 'in_progress' | 'complete';

export type Channel = 'app' | 'email';

export interface FlowProgress {
  id: string;
  user_id: string;
  current_step: FlowStepId;
  steps_state: Record<FlowStepId, StepStatus>;
  logistics_channel: Channel | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Step 2 — Resume / manual entry
// ---------------------------------------------------------------------------

export interface ResumeStructuredData {
  contact: {
    email: string;
    phone: string;
    location: string;
    linkedin: string;
  };
  workHistory: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate: string;
    description: string;
    highlights: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field: string;
    graduationYear: string;
  }>;
  skills: string[];
  certifications: string[];
  summary: string;
  // Populated only on the career-changer path.
  transferableSkills?: string[];
  changeMotivation?: string;
  movingToward?: string;
}

export interface Resume {
  id: string;
  user_id: string;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  raw_text: string | null;
  structured_data: ResumeStructuredData | null;
  is_career_changer: boolean;
  confirmed: boolean;
  confirmed_at: Date | null;
  parse_status: 'pending' | 'processing' | 'complete' | 'failed';
  parse_error: string | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Step 3/4 — Logistics + conversation threads (chat or email, unified)
// ---------------------------------------------------------------------------

// Field names here are the canonical extraction keys — kept in sync by hand with the `id`s in
// models/logistics-areas.ts (which is what actually drives extraction-prompt guidance and the
// frontend's glyph tracker; this interface is compile-time documentation of the same vocabulary).
export interface LogisticsData {
  motivation?: string; // what's prompting the search, not personality — see logistics step's completionCriteria
  targetRolesIndustries?: string;
  jobLevel?: string;
  locationPreference?: string;
  timeframe?: string; // how soon, and how actively they're looking
  salaryRange?: string;
  priorities?: string; // comp vs growth vs stability, etc.
  [key: string]: unknown;
}

// No `channel` field — this table is deliberately channel-agnostic (see its migration comment
// and LogisticsService.ensureResponse). The channel choice itself lives on
// FlowProgress.logistics_channel. An earlier version of this type claimed a channel column that
// never actually existed, which is what caused every insert/update here to fail — see the fix.
export interface LogisticsResponse {
  id: string;
  user_id: string;
  data: LogisticsData;
  status: 'in_progress' | 'complete';
  created_at: Date;
  updated_at: Date;
}

export type ThreadStep = 'logistics' | 'deep_prompts';
export type ThreadStatus = 'active' | 'awaiting_reply' | 'stalled' | 'complete';

export interface ConversationThread {
  id: string;
  user_id: string;
  step: ThreadStep;
  channel: Channel;
  status: ThreadStatus;
  message_count: number;
  thread_cap: number;
  last_message_at: Date | null;
  last_nudge_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  thread_id: string | null;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  channel: Channel;
  step: string;
  metadata: Record<string, any>;
  created_at: Date;
}

// Structured output every elicitation LLM turn (logistics or deep-prompt) must produce.
export interface ElicitationTurnResult {
  reply: string;
  extracted: Record<string, any>;
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Step 6 — Candidate profile
// ---------------------------------------------------------------------------

export interface STARNarrative {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface ProfileInsight {
  id: string;
  category: 'strength' | 'collaboration' | 'stress_response' | 'growth_area' | 'other';
  statement: string;
  evidence: string;
  status: 'active' | 'flagged' | 'resolved';
}

export interface ProfileData {
  headline: string;
  summary: string;
  workHistory: ResumeStructuredData['workHistory'];
  insights: ProfileInsight[];
  workStyle: {
    preferredEnvironment: string;
    teamDynamics: string;
    communicationStyle: string;
  };
  goals: {
    shortTerm: string;
    longTerm: string;
    idealNextRole: string;
  };
  preferences: {
    remote: string;
    companySize: string;
    industry: string[];
  };
  starStories: STARNarrative[];
  // Gaps surfaced by the Step 7 sandbox that haven't been routed back into a re-ask yet.
  openQuestions: Array<{ id: string; note: string; createdAt: string; resolved: boolean }>;
}

export interface CorrectionLogEntry {
  insightId: string;
  originalStatement: string;
  flaggedAt: Date;
  reaskQuestion: string;
  resolvedAt: Date | null;
}

export interface CandidateProfile {
  id: string;
  user_id: string;
  status: 'draft' | 'pending_review' | 'approved';
  version: number;
  profile_data: ProfileData;
  correction_log: CorrectionLogEntry[];
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Step 7 — Sandbox
// ---------------------------------------------------------------------------

// What grounded a sandbox reply — surfaced as an expandable "why this answer" disclosure so the
// candidate can judge (and, via flagging, correct) the reply against the actual evidence rather
// than just the prose. Identified by a follow-up call once the reply is fully streamed — see
// sandbox-chat.chain.ts's identifySandboxCitations.
export interface SandboxCitation {
  source: 'work_history' | 'insight' | 'star_story' | 'goals' | 'preferences' | 'work_style';
  label: string;
  detail: string;
}

export interface SandboxMessage {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  flagged_gap: boolean;
  gap_note: string | null;
  citations: SandboxCitation[] | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Step 8 — Share links
// ---------------------------------------------------------------------------

export interface ShareLink {
  id: string;
  user_id: string;
  token: string;
  label: string | null;
  expires_at: Date;
  created_at: Date;
}

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}
