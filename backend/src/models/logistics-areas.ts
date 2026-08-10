export interface InfoArea {
  id: string;
  /** Short label for the glyph's tooltip heading. */
  label: string;
  /** One-line tooltip body, in second person (you/your) — it's shown directly to the candidate. */
  description: string;
  /**
   * Where this area's fill-state comes from. 'chat' (the default when omitted) means the
   * elicitation prompt should treat it as an extraction target — see ConversationService, which
   * filters to just these when building extractionAreas. 'resume' areas are sourced from the
   * candidate's resume record instead (see LogisticsStepComponent) and must be excluded from that
   * guidance — the logistics chat has no business trying to extract resume data mid-conversation.
   */
  source?: 'chat' | 'resume';
}

// The canonical set of information areas Step 3 (logistics) is trying to cover, plus one 'resume'
// area carried over from Step 2 so the tracker reflects the whole intake, not just what this
// step's chat extracts. Single source of truth for: (1) the extraction-key guidance given to the
// elicitation chain (chat-sourced areas only — see runElicitationTurn's extractionAreas), so the
// AI populates predictable keys in `logistics_responses.data` instead of drifting field names
// turn to turn; (2) the glyph tracker the frontend renders (via FlowStep.infoAreas on the
// 'logistics' step — server-driven per CLAUDE.md, not hardcoded in the UI); (3) LogisticsData's
// field names in types/index.ts, kept in sync with these ids by hand since one is a runtime list
// and the other a compile-time type.
export const logisticsInfoAreas: InfoArea[] = [
  {
    id: 'resumeBackground',
    label: 'Background',
    description: "Your résumé or work history — whether you uploaded one or entered it by hand.",
    source: 'resume'
  },
  { id: 'motivation', label: 'Motivation', description: "What's driving your job search right now." },
  {
    id: 'targetRolesIndustries',
    label: 'Target Role & Industry',
    description: "The kind of role and industry you're aiming for."
  },
  { id: 'jobLevel', label: 'Level', description: "The seniority or level you're targeting." },
  {
    id: 'locationPreference',
    label: 'Location',
    description: 'Where you want to work, including your remote preference.'
  },
  { id: 'timeframe', label: 'Timeframe', description: "How soon, and how actively you're looking." },
  { id: 'salaryRange', label: 'Compensation', description: 'Your salary or compensation expectations.' },
  {
    id: 'priorities',
    label: 'Priorities',
    description: 'What matters most to you when weighing an offer — comp, growth, stability, and the like.'
  }
];
