import { Channel } from './flow.model';

export interface Message {
  id: string;
  thread_id: string | null;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  channel: Channel;
  step: string;
  metadata: Record<string, any>;
  created_at: string;
}

export type ThreadStatus = 'active' | 'awaiting_reply' | 'stalled' | 'complete';

export interface ConversationThread {
  id: string;
  step: string;
  channel: Channel;
  status: ThreadStatus;
  message_count: number;
  thread_cap: number;
  last_message_at: string | null;
  last_nudge_at: string | null;
}

// Field names mirror backend/src/models/logistics-areas.ts's InfoArea ids — that list (served via
// FlowStep.infoAreas) is the actual source of truth; this interface just documents the same
// vocabulary for typed access to LogisticsResponse.data.
export interface LogisticsData {
  motivation?: string;
  targetRolesIndustries?: string;
  jobLevel?: string;
  locationPreference?: string;
  timeframe?: string;
  salaryRange?: string;
  priorities?: string;
  [key: string]: unknown;
}

// No `channel` field — this table is deliberately channel-agnostic; the channel choice itself
// lives on FlowProgress.logistics_channel. See backend LogisticsService.ensureResponse.
export interface LogisticsResponse {
  id: string;
  data: LogisticsData;
  status: 'in_progress' | 'complete';
}

export interface InboxView {
  thread: ConversationThread | null;
  messages: Message[];
  needsNudge: boolean;
  hoursSinceLastMessage: number | null;
}
