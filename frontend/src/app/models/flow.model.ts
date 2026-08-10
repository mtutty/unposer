export type FlowStepId = 'resume' | 'logistics' | 'deep_prompts' | 'profile_review' | 'sandbox' | 'share';
export type StepStatus = 'pending' | 'in_progress' | 'complete';
export type Channel = 'app' | 'email';

// Presentation grouping only — mirrors backend/src/types/index.ts. The 6 FlowStepIds above stay
// the unit of progress tracking; "story"/"interview" just group them for the rail.
export type FlowStageId = 'story' | 'interview';

export interface InfoArea {
  id: string;
  label: string;
  /** Second person (you/your) — shown directly to the candidate as tooltip body text. */
  description: string;
  /** 'resume' areas are filled from the resume record rather than chat extraction — see
   *  LogisticsStepComponent, which merges resume-derived data into what it passes the tracker. */
  source?: 'chat' | 'resume';
}

export interface FlowStep {
  id: FlowStepId;
  name: string;
  description: string;
  order: number;
  stage: FlowStageId;
  /** False for steps reached only as an in-page CTA (sandbox, share) rather than rail navigation. */
  railVisible?: boolean;
  channels: Channel[];
  completionCriteria: string;
  conversationStarters: string[];
  /** Named information areas this step tracks (currently only 'logistics'). Drives the glyph tracker. */
  infoAreas?: InfoArea[];
}

export interface FlowStage {
  id: FlowStageId;
  name: string;
  description: string;
  order: number;
  steps: FlowStepId[];
}

export const STEP_ROUTES: Record<FlowStepId, string> = {
  resume: '/onboarding/resume',
  logistics: '/onboarding/logistics',
  deep_prompts: '/onboarding/deep-prompts',
  profile_review: '/onboarding/profile',
  sandbox: '/onboarding/sandbox',
  share: '/onboarding/share'
};

export interface FlowProgress {
  id: string;
  user_id: string;
  current_step: FlowStepId;
  steps_state: Record<FlowStepId, StepStatus>;
  logistics_channel: Channel | null;
  created_at: string;
  updated_at: string;
}
