import { InfoArea } from './logistics-areas';

// Employer-side onboarding, Phase 2 (docs/employer-onboarding-spec.md §4). Not part of
// flow-steps.ts — flowStages/FlowStep are candidate-only (see CLAUDE.md) — but the same
// shape/purpose as a FlowStep's completionCriteria/conversationStarters/infoAreas: fed straight
// into the shared runElicitationTurn engine (ai/elicitation.chain.ts), same one Step 3 logistics
// uses. A generic, fixed-step call — no tier/topic concept, no per-dimension confidence model,
// per the spec's own recommendation that this is structurally closer to logistics than to
// deep_prompts.

export const REQUISITION_QA_STEP_NAME = 'Requisition Q&A';

export const REQUISITION_QA_COMPLETION_CRITERIA =
  'Complete once you have a clear, specific picture of all three areas below — team size/' +
  'structure and how this role fits into near-term goals; a concrete recent challenge or ' +
  'project this role would touch and what success in the first 90 days looks like; and the ' +
  "team's pace/formality, decision-making style, and what kind of person has struggled here " +
  'before. This is a single 5-20 minute sitting, not an open-ended conversation — once all ' +
  "three areas have specific, usable answers, wrap up rather than digging for more detail.";

export const REQUISITION_QA_CONVERSATION_STARTERS = [
  'Tell me about the team this person would be joining — size, structure, who they report to.',
  'Walk me through a recent challenge or project this role would have been involved in.',
  'What does success look like in the first 90 days?',
  'How would you describe the pace and decision-making style on this team?',
  "What kind of person has struggled in this role, or on this team, before?"
];

// Drives the extraction-key guidance given to runElicitationTurn, same role logisticsInfoAreas
// plays for Step 3 — see that file's own comment. No 'resume'-sourced area here (nothing
// analogous to Step 2 feeds this step), so every area defaults to 'chat'.
export const requisitionQaInfoAreas: InfoArea[] = [
  {
    id: 'organizational',
    label: 'Organizational',
    description: 'Team size/structure, reporting line, and how this role fits into near-term goals.'
  },
  {
    id: 'situational',
    label: 'Situational',
    description: 'A concrete recent challenge or project this role would have touched, and what success in the first 90 days looks like.'
  },
  {
    id: 'cultural',
    label: 'Cultural',
    description: "Pace/formality, decision-making style, and what kind of person has struggled here before."
  }
];
