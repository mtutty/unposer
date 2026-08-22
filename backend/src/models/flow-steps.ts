import { Channel, FlowStageId, FlowStepId } from '../types';
import { InfoArea, logisticsInfoAreas } from './logistics-areas';

export interface FlowStep {
  id: FlowStepId;
  name: string;
  description: string;
  order: number;
  /** Which rail stage this step belongs to. See FlowStageId and `flowStages` below. */
  stage: FlowStageId;
  /**
   * Whether this step gets its own entry in the stage's rail sub-nav. Defaults to true when
   * omitted. False for steps reached only as an in-page CTA (sandbox, share) rather than direct
   * rail navigation — they still track progress via steps_state, they just aren't nav targets.
   */
  railVisible?: boolean;
  /** Channels the candidate may use for this step. A single entry means the channel is fixed. */
  channels: Channel[];
  /** Fed to the LLM turn so it knows when to stop asking and mark the step complete. */
  completionCriteria: string;
  /** Illustrative prompt bank / conversation starters. Not a fixed script — the AI adapts from here. */
  conversationStarters: string[];
  /**
   * Named information areas this step is trying to fill (currently only 'logistics'). Drives both
   * the extraction-key guidance given to the elicitation chain (see ConversationService) and the
   * frontend's glyph tracker — server-driven per CLAUDE.md, so the UI never hardcodes the list.
   */
  infoAreas?: InfoArea[];
}

export interface FlowStage {
  id: FlowStageId;
  name: string;
  description: string;
  order: number;
  /** FlowStepIds in this stage, in order. Includes railVisible:false steps (e.g. sandbox, share). */
  steps: FlowStepId[];
}

// The two rail-facing stages. Purely a presentation grouping over the granular steps below —
// see the FlowStageId comment in types/index.ts for why the underlying steps don't collapse.
export const flowStages: FlowStage[] = [
  {
    id: 'story',
    name: 'Tell Your Story',
    description: 'Resume, goals, and the stories that show how you actually work.',
    order: 1,
    steps: ['resume', 'logistics', 'deep_prompts']
  },
  {
    id: 'interview',
    name: 'Interview Yourself',
    description: 'Review the profile we wrote, then try it and share it out.',
    order: 2,
    steps: ['profile_review', 'sandbox', 'share']
  }
];

// Server-driven UI per CLAUDE.md: the frontend renders the progress rail purely from
// GET /api/flow/steps — nothing about step order, names, stage grouping, or channel options is
// hardcoded there.
//
// Maps to docs/onboarding-ux-flow-spec.md Steps 2,3(+4),5,6,7,8. Step 1 (registration) is stubbed
// in auth; the flow machine starts at "resume".
export const flowSteps: FlowStep[] = [
  {
    id: 'resume',
    name: 'Resume',
    description: 'Upload your resume, or start fresh if you\'re changing industries or roles.',
    order: 1,
    stage: 'story',
    channels: ['app'],
    completionCriteria:
      'The candidate has either uploaded a resume and confirmed the parsed data is accurate, ' +
      'or completed manual/career-changer entry and confirmed it.',
    conversationStarters: []
  },
  {
    id: 'logistics',
    name: 'Goals & Logistics',
    description: 'Your goals, target roles, location, and priorities — answer here or by email, your choice.',
    order: 2,
    stage: 'story',
    channels: ['app', 'email'],
    completionCriteria:
      'We understand the candidate\'s career goals, target industries/roles, location or remote ' +
      'preference, current situation (actively looking / passive / timeline), and top priorities ' +
      '(e.g. compensation vs. growth vs. stability). Purely factual/preference elicitation — do not ' +
      'probe personality or deeper psychological motivation here, that happens later. Practical ' +
      'motivation for the search itself (what\'s prompting it) belongs here; why the candidate is ' +
      'wired the way they are does not.',
    infoAreas: logisticsInfoAreas,
    conversationStarters: [
      'What kind of role are you looking for right now, and what\'s prompting the search?',
      'Where do you want to work — specific cities, remote, or open to relocation?',
      'Are you actively job hunting, or more open to the right thing coming along?',
      'When you weigh an offer, what matters most: compensation, growth, stability, or something else?'
    ]
  },
  {
    id: 'deep_prompts',
    name: 'Your Stories',
    description: 'Live chat only — open-ended questions that surface how you actually work.',
    order: 3,
    stage: 'story',
    channels: ['app'],
    // As of Iteration 3 (docs/personality-engine-implementation-plan.md), this step's live
    // conversation no longer runs on this criteria string / starter list at all —
    // topic-conversation.service.ts drives it entirely from the personality-engine question
    // library (models/question-library.ts) and topic-elicitation.chain.ts's per-topic close
    // criteria (docs/personality-analysis-engine-spec.md §3). Both fields are kept here only
    // because FlowStep still requires them and the frontend's /api/flow/steps consumers read the
    // description/order fields generically — the text below documents the step's *intent* for
    // anyone skimming this file, it is not sent to any chain anymore.
    completionCriteria:
      'Superseded — see topic-conversation.service.ts. Placeholder until Iteration 5 wires real ' +
      'progression.tier gating (flow addendum §2): completes once the core question set (Q0, ' +
      'Q23-25) has been asked and closed.',
    conversationStarters: [
      'Tell me about a time you disagreed with a teammate or manager about how to approach something. What happened?',
      'Walk me through a project that didn\'t go the way you planned. What did you do when it started slipping?',
      'Describe a moment you had to make a call without all the information you wanted. How did you decide?',
      'Tell me about a time you had to learn something fast to keep a project moving.',
      'What\'s a piece of work you\'re quietly proud of that might not show up on a resume?'
    ]
  },
  {
    id: 'profile_review',
    name: 'Your Profile',
    description: 'Review the AI-generated profile and flag anything that doesn\'t sound like you.',
    order: 4,
    stage: 'interview',
    channels: ['app'],
    completionCriteria: 'The candidate has reviewed the generated profile and approved it.',
    conversationStarters: []
  },
  {
    id: 'sandbox',
    name: 'Practice Interview',
    description: 'Chat with your own profile the way a recruiter would, before anyone else sees it.',
    order: 5,
    stage: 'interview',
    // Reached via a CTA on the profile_review page, not its own rail tab — see flowStages.
    railVisible: false,
    channels: ['app'],
    completionCriteria: 'The candidate has tried the sandbox at least once.',
    conversationStarters: [
      'Why are you looking to leave your current role?',
      'What kind of team do you do your best work on?',
      'Tell me about a time you had to deal with conflict on a team.'
    ]
  },
  {
    id: 'share',
    name: 'Share',
    description: 'Generate a time-boxed link recruiters can use to have this same conversation.',
    order: 6,
    stage: 'interview',
    // Reached via a CTA once the profile is approved (see flowStages) — not its own rail tab.
    railVisible: false,
    channels: ['app'],
    completionCriteria: 'The candidate has generated at least one share link.',
    conversationStarters: []
  }
];

export function getStep(id: FlowStepId): FlowStep {
  const step = flowSteps.find((s) => s.id === id);
  if (!step) {
    throw new Error(`Unknown flow step: ${id}`);
  }
  return step;
}

export function nextStep(id: FlowStepId): FlowStep | null {
  const current = getStep(id);
  return flowSteps.find((s) => s.order === current.order + 1) ?? null;
}
