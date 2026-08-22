import { DimensionKey } from '../types';

// Personality-engine question library (docs/personality-analysis-engine-spec.md §3's coverage
// matrix + Appendix A's full question text, tracked in
// docs/personality-engine-implementation-plan.md Iteration 2). Sibling to flow-steps.ts, which
// owns the onboarding step machine — this owns the deep_prompts question bank that Iteration 3's
// coverage-driven selection will read from. Not read by any chain/service/route yet.
//
// Q0-Q22's prompt text was originally missing from this repo (see the plan doc's Iteration 2
// notes for how that gap was found and flagged) and was supplied later via Appendix A of the
// spec doc. `prompt` below is Appendix A's "recommended default" wording for every question;
// Q0 alone has genuine alternates (see `altPrompt`) rather than one canonical text.

export type DimensionLoad = 'P' | 's';

/** One row of spec §3's "Adaptive follow-up probes" trigger/probe/target table. `targets` is
 *  kept as prose (not a DimensionKey[]) — the spec's own table names constructs (Modesty,
 *  self-efficacy, Trust, cynicism, Anger, coping style) that aren't 1:1 with the 11 scoring
 *  dimensions; it's context for whoever's tuning the prompt, not a machine-read field. */
export interface ProbeRule {
  trigger: string;
  probe: string;
  targets: string;
}

export interface LibraryQuestion {
  id: string;
  shortName: string;
  prompt: string;
  /** Q0 only: Appendix A's "Version B (more directed) — for terse respondents" phrasing, an
   *  alternate to `prompt`'s "Version A (more open)" default. Not read anywhere yet — channel/
   *  respondent-adaptive phrasing selection is Iteration 3+ territory. */
  altPrompt?: string;
  /** Spec §3's per-question trigger/probe/target table (topic-elicitation.chain.ts, Iteration 3).
   *  Only Q0 has one — it's the spec's own reference pattern ("the seed question's rules, as the
   *  pattern to replicate"), and the spec doesn't supply this table for the other 25 questions.
   *  Rather than invent 25 questions' worth of trigger/probe content unattested by the spec, this
   *  iteration leaves them to topic-elicitation.chain.ts's generic close-criteria block, whose own
   *  fallback follow-up rule ("go after what is missing: the incident/outcome/role") already
   *  covers the general case. Extending real per-question tables to more questions is future
   *  editorial work, not an engineering gap. */
  probeRules?: ProbeRule[];
  dimensionLoads: Partial<Record<DimensionKey, DimensionLoad>>;
  /** Emotionally demanding — never queue two of these back to back (spec §3, selection logic
   *  point 3). These same four (Q5, Q6, Q19, Q20) are also the ones spec §8 keeps from ever
   *  surfacing to a recruiter verbatim; Iteration 8 reuses this flag or adds its own when it
   *  builds that enforcement. */
  heavy: boolean;
  /** Appendix A's theme grouping ("useful for pacing (§3, rule 3), not for scoring"). Q0 stands
   *  alone as the seed; Q23-Q25 are grouped under Appendix A's own "Gap-Closing Additions"
   *  heading rather than one of the original eight themes. */
  theme: string;
  /** Freeform editorial note carried over from the spec where it materially affects how a
   *  question should be used — currently only Q8's "weaker than its replacement" call-out. */
  note?: string;
}

export const questionLibrary: LibraryQuestion[] = [
  {
    id: 'Q0',
    shortName: 'The Stars on Your Team',
    prompt:
      'Think about your current or most recent team. Who really stood out — the people who got ' +
      'recognition, got promoted, or whose work people talked about? What made them successful? ' +
      'Was it technical skills, relationship-building, innovation, execution, something else?',
    altPrompt:
      "Every workplace has its stars — people who get noticed and rewarded. In your last team, " +
      "who were those people? And what was their secret sauce? Were they technically brilliant? " +
      "Great at navigating politics? Innovative thinkers? Something else?",
    dimensionLoads: {
      agreeableness: 'P',
      emotional_stability: 's',
      social_energy: 's',
      dominance: 's',
      openness: 's',
      motivation: 's'
    },
    heavy: false,
    theme: 'Seed',
    note: 'Also the primary culture-capture question — what gets rewarded maps to CVF quadrant (§7).',
    probeRules: [
      {
        trigger: 'Mentions themselves among the stars',
        probe: "What would your colleagues say your biggest contribution was?",
        targets: 'Modesty, self-efficacy'
      },
      {
        trigger: "Doesn't mention themselves at all",
        probe: 'And where did your own work fit into that picture? What were you known for?',
        targets: 'Self-efficacy vs. genuine modesty'
      },
      {
        trigger: 'Emphasizes politics',
        probe: 'Do you think the right people generally got recognized, or was it more about who you knew?',
        targets: 'Trust, cynicism'
      },
      {
        trigger: 'Shows resentment',
        probe: 'Sounds like that was frustrating — how did you handle that dynamic?',
        targets: 'Anger, coping style'
      }
    ]
  },
  {
    id: 'Q1',
    shortName: 'The Unofficial Curriculum',
    prompt:
      "Think about what you've actually learned in your career versus what was in any job " +
      "description or training program. What's something important you had to figure out on " +
      'your own that nobody explicitly taught you?',
    dimensionLoads: { openness: 'P', emotional_stability: 's', change_orientation: 's', motivation: 's' },
    heavy: false,
    theme: 'Career Narrative & Achievement'
  },
  {
    id: 'Q2',
    shortName: 'Highlight Reel vs. Cutting Room Floor',
    prompt:
      "If you were making a documentary about your career, what's the scene that definitely " +
      "makes the final cut — something you're proud of? And what's a scene that was important to " +
      'you at the time but probably hits the cutting room floor because nobody else would find ' +
      'it interesting?',
    dimensionLoads: { motivation: 'P', emotional_stability: 's', dominance: 's', agreeableness: 's' },
    heavy: false,
    theme: 'Career Narrative & Achievement'
  },
  {
    id: 'Q3',
    shortName: 'The Parallel Universe Question',
    prompt:
      'Imagine a version of you that made one different major career decision — took a different ' +
      'job, stayed somewhere longer, pursued a different field. What do you think that version of ' +
      'you is doing now? And honestly, do you ever wonder if they made the better call?',
    dimensionLoads: { emotional_stability: 'P', change_orientation: 'P', openness: 's', motivation: 's' },
    heavy: false,
    theme: 'Career Narrative & Achievement'
  },
  {
    id: 'Q4',
    shortName: 'The Obstacle That Stayed',
    prompt:
      'Tell me about a professional challenge or obstacle that you never fully solved — ' +
      'something you eventually had to work around, accept, or just move on from rather than ' +
      'conquering it.',
    dimensionLoads: { emotional_stability: 'P', agreeableness: 's', conscientiousness: 's' },
    heavy: false,
    theme: 'Challenge & Adversity'
  },
  {
    id: 'Q5',
    shortName: 'The Breaking Point',
    prompt:
      "What's the closest you've come to walking out on a job or project? You don't have to have " +
      'actually quit — just that moment where you seriously considered it. What was happening, ' +
      'and what made you stay or go?',
    dimensionLoads: { emotional_stability: 'P', agreeableness: 's', conscientiousness: 's' },
    heavy: true,
    theme: 'Challenge & Adversity'
  },
  {
    id: 'Q6',
    shortName: "The Pattern You Can't Break",
    prompt:
      'Is there a mistake or misstep you keep making in your career? Something where you know ' +
      'better, but you keep finding yourself in the same pattern?',
    dimensionLoads: { emotional_stability: 'P', conscientiousness: 'P', thinking_style: 's' },
    heavy: true,
    theme: 'Challenge & Adversity'
  },
  {
    id: 'Q7',
    shortName: 'The Time Audit',
    prompt:
      'Think about last week or a typical recent week. What did you spend the most time on? ' +
      "What do you wish you'd spent more time on? And what's the thing you spent time on that, " +
      "honestly, probably wasn't worth it?",
    dimensionLoads: { social_energy: 's', conscientiousness: 'P', detail_orientation: 's', motivation: 's' },
    heavy: false,
    theme: 'Work Style & Process'
  },
  {
    id: 'Q8',
    shortName: 'The Collaboration Spectrum',
    prompt:
      'Here\'s a spectrum: On one end, a project where every major decision goes through the ' +
      'whole team, everyone weighs in, consensus matters. On the other end, clear ownership, ' +
      'people in their lanes, coordinated but independent. Where do you do your best work, and ' +
      'can you give me an example of when that setup really clicked for you?',
    dimensionLoads: { social_energy: 's', dominance: 's', agreeableness: 's', work_style: 'P' },
    heavy: false,
    theme: 'Work Style & Process',
    note:
      'Weakest question in the library by the library\'s own standard — it states the dimension ' +
      "it's measuring. Q25 is the intended replacement; keep Q8 only as a fallback for " +
      "respondents who struggle with Q25's failure-mode framing."
  },
  {
    id: 'Q9',
    shortName: 'The Deliverable Dilemma',
    prompt:
      "You're working on something important with a hard deadline. You're at 85% — it's good, it " +
      'works, it meets the requirements. You could ship it now, or you could push the deadline ' +
      'and get it to 95%. What factors into that decision for you? And be honest — which way do ' +
      'you usually lean?',
    dimensionLoads: { emotional_stability: 's', conscientiousness: 'P', change_orientation: 's', detail_orientation: 'P' },
    heavy: false,
    theme: 'Work Style & Process'
  },
  {
    id: 'Q10',
    shortName: 'The Advice Network',
    prompt:
      "When you're stuck on something — could be a work problem, a career decision, anything " +
      "professional — who do you actually reach out to? Not who you're supposed to ask, but who " +
      "you really call. And what makes those people your go-to's?",
    dimensionLoads: { social_energy: 's', agreeableness: 'P', work_style: 's' },
    heavy: false,
    theme: 'Social Dynamics & Relationships'
  },
  {
    id: 'Q11',
    shortName: 'The Energy Equation',
    prompt:
      'Think about the people you work with — or have worked with. Who energizes you? Like, ' +
      'after talking to them, you feel more creative, more motivated, more capable. And ' +
      'conversely, who drains you — even if they\'re perfectly nice, they just leave you ' +
      "exhausted. What's the difference?",
    dimensionLoads: { emotional_stability: 's', social_energy: 'P', agreeableness: 's', work_style: 's' },
    heavy: false,
    theme: 'Social Dynamics & Relationships'
  },
  {
    id: 'Q12',
    shortName: 'The Influence Approach',
    prompt:
      'When you need to convince someone of something — could be a colleague, a boss, a client — ' +
      "what's your natural approach? Do you build the logical case? Find allies first? Lead with " +
      'enthusiasm? Something else? And has that approach ever really backfired on you?',
    dimensionLoads: { social_energy: 's', dominance: 'P', agreeableness: 's', thinking_style: 's' },
    heavy: false,
    theme: 'Social Dynamics & Relationships'
  },
  {
    id: 'Q13',
    shortName: 'The Trade-Off Triangle',
    prompt:
      "In an ideal role, you'd have interesting work, great people, and solid " +
      'compensation/security. But most jobs make you compromise on at least one of those. Which ' +
      'one can you most easily compromise on, and which is non-negotiable? Has that changed over ' +
      'time?',
    dimensionLoads: { emotional_stability: 's', social_energy: 's', change_orientation: 's', motivation: 'P' },
    heavy: false,
    theme: 'Values & Meaning'
  },
  {
    id: 'Q14',
    shortName: 'The Unsung Win',
    prompt:
      "Tell me about something you're really proud of that nobody else noticed or cared about. " +
      'Could be an elegant solution, a crisis you quietly prevented, a skill you developed — just ' +
      "something where you know you did great work but it didn't get the recognition.",
    dimensionLoads: { agreeableness: 's', detail_orientation: 's', motivation: 'P' },
    heavy: false,
    theme: 'Values & Meaning'
  },
  {
    id: 'Q15',
    shortName: 'The Deal-Breaker',
    prompt:
      "What's something you've seen in a workplace or on a team that made you think \"I can't " +
      'work here\" or \"I can\'t work with these people\"? Doesn\'t have to be dramatic — just ' +
      'something that crossed a line for you.',
    dimensionLoads: { emotional_stability: 's', agreeableness: 'P', openness: 's' },
    heavy: false,
    theme: 'Values & Meaning'
  },
  {
    id: 'Q16',
    shortName: 'The Mind-Change Moment',
    prompt:
      "What's something you used to believe about work, or your field, or how things should be " +
      "done — and you've completely changed your mind? What shifted your thinking?",
    dimensionLoads: { agreeableness: 's', openness: 'P', change_orientation: 'P', thinking_style: 's' },
    heavy: false,
    theme: 'Learning & Adaptation'
  },
  {
    id: 'Q17',
    shortName: "The Skill That Won't Stick",
    prompt:
      'Is there a skill — technical, interpersonal, whatever — that you\'ve tried to develop but ' +
      "just can't seem to get the hang of? Or that you've gotten better at but it still doesn't " +
      'feel natural?',
    dimensionLoads: { emotional_stability: 's', conscientiousness: 's', openness: 's', motivation: 's' },
    heavy: false,
    theme: 'Learning & Adaptation'
  },
  {
    id: 'Q18',
    shortName: 'The Curiosity Catalog',
    prompt:
      'What are you genuinely curious about right now — professionally or otherwise? What rabbit ' +
      "holes have you gone down lately? What are you reading, watching, learning about just " +
      "because it's interesting?",
    dimensionLoads: { openness: 'P', thinking_style: 's' },
    heavy: false,
    theme: 'Learning & Adaptation'
  },
  {
    id: 'Q19',
    shortName: 'The Pressure Gauge',
    prompt:
      "How do you know when you're getting overwhelmed or close to burnout? What are your early " +
      'warning signs? And what actually helps you recover — not what you\'re "supposed" to do, ' +
      'but what actually works for you?',
    dimensionLoads: { emotional_stability: 'P', social_energy: 's', conscientiousness: 's' },
    heavy: true,
    theme: 'Stress & Recovery'
  },
  {
    id: 'Q20',
    shortName: 'The Mistake Autopsy',
    prompt:
      'Walk me through a significant mistake you made. Not what happened, but your internal ' +
      'experience — when did you realize it was a mistake? How did you feel? How long did you ' +
      'beat yourself up about it? What did you actually learn?',
    dimensionLoads: { emotional_stability: 'P', agreeableness: 's', conscientiousness: 's', thinking_style: 's' },
    heavy: true,
    theme: 'Stress & Recovery'
  },
  {
    id: 'Q21',
    shortName: 'The Job Description Gap',
    prompt:
      'If you were writing a completely honest job description for your current or most recent ' +
      'role — not the official one, but the real one — what would you add to the "Requirements" ' +
      "section that wasn't there? And what was listed that turned out not to matter?",
    dimensionLoads: { agreeableness: 's', thinking_style: 'P', detail_orientation: 's' },
    heavy: false,
    theme: 'Wildcard / Meta'
  },
  {
    id: 'Q22',
    shortName: 'The Future Self Interview',
    prompt:
      "Imagine it's five years from now, and five-years-from-now you is looking back at " +
      'present-day you. What advice do they wish they could give you? What do you hope they\'re ' +
      "grateful you did? What do you worry they're frustrated you didn't do?",
    dimensionLoads: { emotional_stability: 's', conscientiousness: 's', change_orientation: 's', motivation: 'P' },
    heavy: false,
    theme: 'Wildcard / Meta'
  },
  {
    id: 'Q23',
    shortName: 'The Gut Call',
    prompt:
      'Tell me about a call you made where the data pointed one way and your instinct pointed the ' +
      'other. Which did you follow? And knowing how it turned out — do you trust yourself more or ' +
      'less on that kind of call now?',
    dimensionLoads: { thinking_style: 'P', change_orientation: 's', emotional_stability: 's' },
    heavy: false,
    theme: 'Gap-Closing Additions'
  },
  {
    id: 'Q24',
    shortName: "The Thing You'd Catch",
    prompt:
      "When you're reviewing someone else's work — a doc, a design, a pull request — what do you " +
      "notice first? And what's the thing you know you consistently miss that someone else on the " +
      'team always catches?',
    dimensionLoads: { detail_orientation: 'P', agreeableness: 's', conscientiousness: 's' },
    heavy: false,
    theme: 'Gap-Closing Additions'
  },
  {
    id: 'Q25',
    shortName: 'The Balance You Got Wrong',
    prompt:
      'In an ideal week, how much of your time is you alone with a problem versus you in a room ' +
      'with other people? Now tell me about a stretch of work where that balance was badly wrong ' +
      '— in either direction — and what it did to you.',
    dimensionLoads: { work_style: 'P', social_energy: 's', dominance: 's' },
    heavy: false,
    theme: 'Gap-Closing Additions'
  }
];

export function getQuestion(id: string): LibraryQuestion | undefined {
  return questionLibrary.find((q) => q.id === id);
}
