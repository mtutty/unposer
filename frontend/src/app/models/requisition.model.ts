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
