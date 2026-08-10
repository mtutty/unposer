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
  insights: z.array(insightSchema).min(3).describe('Inferred from stories, never from self-rating'),
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

export interface ProfileGenerationInput {
  resume: ResumeStructuredData | null;
  isCareerChanger: boolean;
  logistics: LogisticsData;
  deepPromptTranscript: Array<{ role: 'user' | 'assistant'; content: string }>;
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
    'conversation. Every insight must be a narrative statement backed by cited evidence from the ' +
    'transcript or resume — never a bare number, letter grade, or scale position. Extract STAR ' +
    '(situation/task/action/result) stories directly from stories the candidate told. ' +
    (input.isCareerChanger
      ? 'This candidate is changing industries/roles — frame goals and work style around where ' +
        'they are headed, not just where they have been.'
      : '');

  const human = [
    `Resume (structured): ${JSON.stringify(input.resume)}`,
    `Logistics/goals: ${JSON.stringify(input.logistics)}`,
    'Deep-prompt transcript:',
    input.deepPromptTranscript.map((m) => `${m.role === 'user' ? 'Candidate' : 'Interviewer'}: ${m.content}`).join('\n')
  ].join('\n\n');

  const result = await structuredCall(profileSchema, system, human, 0.4);

  return {
    ...result,
    insights: result.insights.map((i) => ({ ...i, status: 'active' as const })),
    openQuestions: []
  };
}
