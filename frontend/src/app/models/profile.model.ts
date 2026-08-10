import { WorkHistoryItem } from './resume.model';

export interface ProfileInsight {
  id: string;
  category: 'strength' | 'collaboration' | 'stress_response' | 'growth_area' | 'other';
  statement: string;
  evidence: string;
  status: 'active' | 'flagged' | 'resolved';
}

export interface STARNarrative {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface ProfileData {
  headline: string;
  summary: string;
  workHistory: WorkHistoryItem[];
  insights: ProfileInsight[];
  workStyle: { preferredEnvironment: string; teamDynamics: string; communicationStyle: string };
  goals: { shortTerm: string; longTerm: string; idealNextRole: string };
  preferences: { remote: string; companySize: string; industry: string[] };
  starStories: STARNarrative[];
  openQuestions: Array<{ id: string; note: string; createdAt: string; resolved: boolean }>;
}

export interface CandidateProfile {
  id: string;
  status: 'draft' | 'pending_review' | 'approved';
  version: number;
  profile_data: ProfileData;
  correction_log: Array<{ insightId: string; originalStatement: string; flaggedAt: string; reaskQuestion: string }>;
  approved_at: string | null;
}
