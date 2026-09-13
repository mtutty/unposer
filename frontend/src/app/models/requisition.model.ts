// Mirrors backend/src/types/index.ts's JobRequisition — employer-side onboarding Phase 1
// (docs/employer-onboarding-spec.md §3).
export type JobRequisitionStatus = 'draft' | 'active' | 'closed';

export interface JobRequisition {
  id: string;
  user_id: string;
  title: string;
  description: string;
  requirements: string | null;
  status: JobRequisitionStatus;
  created_at: string;
  updated_at: string;
}

// Phase 2 — org/situational/cultural Q&A (docs/employer-onboarding-spec.md §4).
export type RequisitionThreadStatus = 'active' | 'complete';

export interface RequisitionThread {
  id: string;
  requisition_id: string;
  status: RequisitionThreadStatus;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface RequisitionMessage {
  id: string;
  thread_id: string;
  requisition_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, any>;
  created_at: string;
}
