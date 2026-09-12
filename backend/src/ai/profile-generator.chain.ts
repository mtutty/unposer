import { z } from 'zod';
import { structuredCall } from './llm';
import { LogisticsData, ProfileData, ResumeStructuredData } from '../types';

const insightSchema = z.object({
  id: z.string().describe('short kebab-case slug, unique within this profile'),
  category: z.enum(['strength', 'collaboration', 'stress_response', 'growth_area', 'other']),
  statement: z.string().describe('One sentence, narrative, never a numeric score or trait label alone'),
  evidence: z.string().describe('The specific story or detail this was inferred from')
});

const profileSchema = z.object({
  headline: z.string().describe('One line, e.g. "Product-minded backend engineer who thrives in ambiguity"'),
  summary: z.string().describe('3-5 sentence narrative synthesis'),
  workHistory: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      description: z.string(),
      highlights: z.array(z.string())
    })
  ),
  // No .min() here — Anthropic's strict tool-use schema validation rejects arrays with a minItems
  // other than 0 or 1 (this is the one array in the whole file that had an explicit bound, and it
  // 400'd every generate call once structuredCall started requesting strict:true — see llm.ts).
  // The "at least 3" requirement now lives only in the prompt below; nothing here enforces it.
  insights: z.array(insightSchema).describe('At least 3 distinct insights, inferred from stories, never from self-rating'),
  workStyle: z.object({
    preferredEnvironment: z.string(),
    teamDynamics: z.string(),
    communicationStyle: z.string()
  }),
  goals: z.object({
    shortTerm: z.string(),
    longTerm: z.string(),
    idealNextRole: z.string()
  }),
  preferences: z.object({
    remote: z.string(),
    companySize: z.string(),
    industry: z.array(z.string())
  }),
  starStories: z.array(
    z.object({
      situation: z.string(),
      task: z.string(),
      action: z.string(),
      result: z.string()
    })
  )
});

// Below this, a substring match against a heavy answer is too likely to be coincidental short
// phrasing rather than an actual verbatim lift — long enough that a real quote is what's left.
const MIN_QUOTE_CHECK_LENGTH = 25;

export interface ProfileGenerationInput {
  resume: ResumeStructuredData | null;
  isCareerChanger: boolean;
  logistics: LogisticsData;
  // heavy: whether this exchange came from a Q5/Q6/Q19/Q20 question (spec §8's never-verbatim-
  // to-recruiter set) — see profile.service.ts, which looks it up from the question library via
  // the message's own metadata.question_id. Closes a gap the personality-engine's own heavy
  // guardrails (insight-generator.chain.ts, evidence.service.ts) never covered: this chain's own
  // five-category insights read the *raw* transcript directly, with an `evidence` field asking
  // for "the specific story or detail" behind each one — nothing stopped that detail from being
  // a heavy answer quoted verbatim before this field existed. See the RESTRICTED marking and
  // post-generation redaction below for the two-layer guardrail this enables.
  deepPromptTranscript: Array<{ role: 'user' | 'assistant'; content: string; heavy: boolean }>;
  // Step 7 -> Step 6 feedback loop: corrections the candidate made after seeing their own profile
  // tested in the practice interview. Present only when regenerating off flagged sandbox gaps
  // (see ProfileService.applyGapCorrections) — treated as authoritative, not just more raw
  // material to weigh evenly against the rest.
  corrections?: Array<{ question: string; wrongAnswer: string; correction: string }>;
  // Personality engine (Iteration 5, flow addendum §6): InsightService's own generated insights
  // (spec §6's six evidence-cited types), when the candidate has reached at least Sketch tier —
  // see profile.service.ts. Informational only, so this chain's own synthesis doesn't restate the
  // same finding a second way — profile.service.ts appends the real PersonalityInsight rows to
  // profile_data.insights *in code* after this call returns (their real `insight.id`, exact text,
  // and a real cited evidence span), rather than trusting the model to reproduce them verbatim
  // through structured output, which risks paraphrasing/dropping/mangling "verbatim" text and
  // breaks the id traceability back to the source row.
  personalityInsights?: Array<{ type: string; text: string }>;
}

/**
 * Synthesizes the Step 6 profile from everything gathered in Steps 2, 3, and 5. Insights must
 * read as narrative inferences with cited evidence — never a bare trait/score, per the
 * "no self-scoring, ever" design principle (it applies to the AI's output too: show your work).
 */
export async function generateCandidateProfile(input: ProfileGenerationInput): Promise<ProfileData> {
  const system =
    'You synthesize a candidate career/personality profile from three sources: their resume, ' +
    'their stated logistics/goals, and a transcript of open-ended "tell me about a time..." ' +
    'conversation. Identify at least 3 distinct insights, each a narrative statement backed by ' +
    'cited evidence from the transcript or resume — never a bare number, letter grade, or scale ' +
    'position. Extract STAR (situation/task/action/result) stories directly from stories the ' +
    'candidate told. Some candidate turns in the transcript below are marked [RESTRICTED] — you ' +
    'may still use them to inform your holistic understanding of the candidate, but an insight\'s ' +
    '`evidence` field must never quote a [RESTRICTED] turn\'s text directly or near-verbatim; ' +
    'describe the narrative substance in your own words instead, or cite a different, ' +
    'non-restricted moment. ' +
    (input.isCareerChanger
      ? 'This candidate is changing industries/roles — frame goals and work style around where ' +
        'they are headed, not just where they have been.'
      : '') +
    (input.corrections?.length
      ? ' The candidate also tested an earlier version of this profile in a practice interview ' +
        'and flagged specific answers that did not reflect them, with a correction for each. ' +
        'Treat those corrections as authoritative ground truth — reconcile the summary, insights, ' +
        'and stories around them rather than weighing them as just one more data point.'
      : '') +
    (input.personalityInsights?.length
      ? ' A separate scoring pipeline has already produced the personality-dimension insights ' +
        'listed below for this candidate — they will be added to the profile automatically, ' +
        'do not restate or re-derive any of them yourself. Your own `insights` (category ' +
        'strength/collaboration/stress_response/growth_area/other) should cover only what those ' +
        "don't already: resume/career narrative, goals, and transcript material outside what's " +
        'already covered there.'
      : '');

  const human = [
    `Resume (structured): ${JSON.stringify(input.resume)}`,
    `Logistics/goals: ${JSON.stringify(input.logistics)}`,
    'Deep-prompt transcript:',
    input.deepPromptTranscript
      .map((m) => `${m.role === 'user' ? 'Candidate' : 'Interviewer'}${m.heavy ? ' [RESTRICTED]' : ''}: ${m.content}`)
      .join('\n'),
    ...(input.corrections?.length
      ? [
          'Candidate corrections from the practice interview (authoritative):',
          input.corrections
            .map(
              (c, i) =>
                `${i + 1}. Asked: "${c.question}"\n   Profile answered: "${c.wrongAnswer}"\n   Candidate says it should reflect: "${c.correction}"`
            )
            .join('\n')
        ]
      : []),
    ...(input.personalityInsights?.length
      ? [
          'Already-covered personality insights (for context only — do not restate, see system instructions):',
          input.personalityInsights.map((pi, i) => `${i + 1}. [${pi.type}] ${pi.text}`).join('\n')
        ]
      : [])
  ].join('\n\n');

  const result = await structuredCall(profileSchema, system, human, 0.4);

  // Belt-and-suspenders on the [RESTRICTED] prompt instruction above, same posture as
  // insight-generator.chain.ts's own_words filter: this chain has no per-span id to check a
  // citation against (its `evidence` field is freeform text, not a citation of a known list), so
  // the structural check available here is substring matching against the actual heavy candidate
  // answers rather than id membership. Redacts only the `evidence` field (the one asked to quote
  // "the specific story or detail") — `statement` is a narrative sentence about the candidate,
  // not a quote of them, and isn't checked.
  const heavyAnswers = input.deepPromptTranscript
    .filter((m) => m.role === 'user' && m.heavy)
    .map((m) => m.content.toLowerCase())
    .filter((c) => c.length >= MIN_QUOTE_CHECK_LENGTH);

  return {
    ...result,
    insights: result.insights.map((i) => {
      const evidenceLower = i.evidence.toLowerCase();
      const quotesHeavyAnswer =
        evidenceLower.length >= MIN_QUOTE_CHECK_LENGTH &&
        heavyAnswers.some((answer) => answer.includes(evidenceLower) || evidenceLower.includes(answer));
      return { ...i, evidence: quotesHeavyAnswer ? i.statement : i.evidence, status: 'active' as const };
    }),
    openQuestions: []
  };
}
