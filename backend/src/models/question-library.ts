import { DimensionKey } from '../types';

// Personality-engine question library (docs/personality-analysis-engine-spec.md §3's coverage
// matrix + "Three questions to close the gaps", tracked in
// docs/personality-engine-implementation-plan.md Iteration 2). Sibling to flow-steps.ts, which
// owns the onboarding step machine — this owns the deep_prompts question bank that Iteration 3's
// coverage-driven selection will read from. Not read by any chain/service/route yet.
//
// GAP — read before extending this file: Q0-Q22's coverage-matrix dimension loadings below are
// transcribed directly from the spec's §3 table (safe — that's the spec's own data). Their full
// verbatim prompt text is NOT anywhere in this repo, this repo's git history, or docs/ — checked
// all three. The spec doc says it "consolidates three prior workstreams" including "the interview
// question library"; that source material lives outside this repo and hasn't been supplied.
// `prompt: null` marks every question still in that state. Q23-Q25 have real text (spec §3 gives
// it verbatim) and are filled in below. Iteration 3 (coverage-driven selection) cannot actually
// serve Q0-Q22 to a candidate until real prompt text exists — flagged here rather than invented,
// since "questions must earn the answer" (spec §1 constraint 2) is a carefully-designed-copy
// requirement, not something to improvise.

export type DimensionLoad = 'P' | 's';

export interface LibraryQuestion {
  id: string;
  shortName: string;
  /** null: verbatim text not yet available in this repo — see the GAP note above. */
  prompt: string | null;
  dimensionLoads: Partial<Record<DimensionKey, DimensionLoad>>;
  /** Emotionally demanding — never queue two of these back to back (spec §3, selection logic
   *  point 3). These same four (Q5, Q6, Q19, Q20) are also the ones spec §8 keeps from ever
   *  surfacing to a recruiter verbatim; Iteration 8 reuses this flag or adds its own when it
   *  builds that enforcement. */
  heavy: boolean;
}

export const questionLibrary: LibraryQuestion[] = [
  {
    id: 'Q0',
    shortName: 'The Stars on Your Team',
    prompt: null,
    dimensionLoads: {
      agreeableness: 'P',
      emotional_stability: 's',
      social_energy: 's',
      dominance: 's',
      openness: 's',
      motivation: 's'
    },
    heavy: false
  },
  {
    id: 'Q1',
    shortName: 'The Unofficial Curriculum',
    prompt: null,
    dimensionLoads: { openness: 'P', emotional_stability: 's', change_orientation: 's', motivation: 's' },
    heavy: false
  },
  {
    id: 'Q2',
    shortName: 'Highlight Reel vs. Cutting Room Floor',
    prompt: null,
    dimensionLoads: { motivation: 'P', emotional_stability: 's', dominance: 's', agreeableness: 's' },
    heavy: false
  },
  {
    id: 'Q3',
    shortName: 'The Parallel Universe Question',
    prompt: null,
    dimensionLoads: { emotional_stability: 'P', change_orientation: 'P', openness: 's', motivation: 's' },
    heavy: false
  },
  {
    id: 'Q4',
    shortName: 'The Obstacle That Stayed',
    prompt: null,
    dimensionLoads: { emotional_stability: 'P', agreeableness: 's', conscientiousness: 's' },
    heavy: false
  },
  {
    id: 'Q5',
    shortName: 'The Breaking Point',
    prompt: null,
    dimensionLoads: { emotional_stability: 'P', agreeableness: 's', conscientiousness: 's' },
    heavy: true
  },
  {
    id: 'Q6',
    shortName: "The Pattern You Can't Break",
    prompt: null,
    dimensionLoads: { emotional_stability: 'P', conscientiousness: 'P', thinking_style: 's' },
    heavy: true
  },
  {
    id: 'Q7',
    shortName: 'The Time Audit',
    prompt: null,
    dimensionLoads: { social_energy: 's', conscientiousness: 'P', detail_orientation: 's', motivation: 's' },
    heavy: false
  },
  {
    id: 'Q8',
    shortName: 'The Collaboration Spectrum',
    prompt: null,
    dimensionLoads: { social_energy: 's', dominance: 's', agreeableness: 's', work_style: 'P' },
    heavy: false
  },
  {
    id: 'Q9',
    shortName: 'The Deliverable Dilemma',
    prompt: null,
    dimensionLoads: { emotional_stability: 's', conscientiousness: 'P', change_orientation: 's', detail_orientation: 'P' },
    heavy: false
  },
  {
    id: 'Q10',
    shortName: 'The Advice Network',
    prompt: null,
    dimensionLoads: { social_energy: 's', agreeableness: 'P', work_style: 's' },
    heavy: false
  },
  {
    id: 'Q11',
    shortName: 'The Energy Equation',
    prompt: null,
    dimensionLoads: { emotional_stability: 's', social_energy: 'P', agreeableness: 's', work_style: 's' },
    heavy: false
  },
  {
    id: 'Q12',
    shortName: 'The Influence Approach',
    prompt: null,
    dimensionLoads: { social_energy: 's', dominance: 'P', agreeableness: 's', thinking_style: 's' },
    heavy: false
  },
  {
    id: 'Q13',
    shortName: 'The Trade-Off Triangle',
    prompt: null,
    dimensionLoads: { emotional_stability: 's', social_energy: 's', change_orientation: 's', motivation: 'P' },
    heavy: false
  },
  {
    id: 'Q14',
    shortName: 'The Unsung Win',
    prompt: null,
    dimensionLoads: { agreeableness: 's', detail_orientation: 's', motivation: 'P' },
    heavy: false
  },
  {
    id: 'Q15',
    shortName: 'The Deal-Breaker',
    prompt: null,
    dimensionLoads: { emotional_stability: 's', agreeableness: 'P', openness: 's' },
    heavy: false
  },
  {
    id: 'Q16',
    shortName: 'The Mind-Change Moment',
    prompt: null,
    dimensionLoads: { agreeableness: 's', openness: 'P', change_orientation: 'P', thinking_style: 's' },
    heavy: false
  },
  {
    id: 'Q17',
    shortName: "The Skill That Won't Stick",
    prompt: null,
    dimensionLoads: { emotional_stability: 's', conscientiousness: 's', openness: 's', motivation: 's' },
    heavy: false
  },
  {
    id: 'Q18',
    shortName: 'The Curiosity Catalog',
    prompt: null,
    dimensionLoads: { openness: 'P', thinking_style: 's' },
    heavy: false
  },
  {
    id: 'Q19',
    shortName: 'The Pressure Gauge',
    prompt: null,
    dimensionLoads: { emotional_stability: 'P', social_energy: 's', conscientiousness: 's' },
    heavy: true
  },
  {
    id: 'Q20',
    shortName: 'The Mistake Autopsy',
    prompt: null,
    dimensionLoads: { emotional_stability: 'P', agreeableness: 's', conscientiousness: 's', thinking_style: 's' },
    heavy: true
  },
  {
    id: 'Q21',
    shortName: 'The Job Description Gap',
    prompt: null,
    dimensionLoads: { agreeableness: 's', thinking_style: 'P', detail_orientation: 's' },
    heavy: false
  },
  {
    id: 'Q22',
    shortName: 'The Future Self Interview',
    prompt: null,
    dimensionLoads: { emotional_stability: 's', conscientiousness: 's', change_orientation: 's', motivation: 'P' },
    heavy: false
  },
  {
    id: 'Q23',
    shortName: 'The Gut Call',
    prompt:
      'Tell me about a call you made where the data pointed one way and your instinct pointed the ' +
      'other. Which did you follow? And knowing how it turned out — do you trust yourself more or ' +
      'less on that kind of call now?',
    dimensionLoads: { thinking_style: 'P', change_orientation: 's', emotional_stability: 's' },
    heavy: false
  },
  {
    id: 'Q24',
    shortName: "The Thing You'd Catch",
    prompt:
      "When you're reviewing someone else's work — a doc, a design, a pull request — what do you " +
      "notice first? And what's the thing you know you consistently miss that someone else on the " +
      'team always catches?',
    dimensionLoads: { detail_orientation: 'P', agreeableness: 's', conscientiousness: 's' },
    heavy: false
  },
  {
    id: 'Q25',
    shortName: 'The Balance You Got Wrong',
    prompt:
      'In an ideal week, how much of your time is you alone with a problem versus you in a room ' +
      'with other people? Now tell me about a stretch of work where that balance was badly wrong ' +
      '— in either direction — and what it did to you.',
    dimensionLoads: { work_style: 'P', social_energy: 's', dominance: 's' },
    heavy: false
  }
];

export function getQuestion(id: string): LibraryQuestion | undefined {
  return questionLibrary.find((q) => q.id === id);
}
