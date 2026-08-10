import { z } from 'zod';
import { structuredCall } from './llm';
import { ResumeStructuredData } from '../types';

const workHistoryItem = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string().describe('e.g. "2021-03" or "Mar 2021"'),
  endDate: z.string().describe('"Present" if current'),
  description: z.string(),
  highlights: z.array(z.string())
});

const resumeSchema = z.object({
  contact: z.object({
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    linkedin: z.string()
  }),
  workHistory: z.array(workHistoryItem),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string(),
      field: z.string(),
      graduationYear: z.string()
    })
  ),
  skills: z.array(z.string()),
  certifications: z.array(z.string()),
  summary: z.string().describe('2-3 sentence neutral summary of the candidate\'s background'),
  transferableSkills: z
    .array(z.string())
    .optional()
    .describe('Only if career-changer: skills that carry into the new direction'),
  changeMotivation: z.string().optional().describe('Only if career-changer: why they are changing'),
  movingToward: z.string().optional().describe('Only if career-changer: what they are moving toward')
});

/**
 * Extracts structured fields from raw resume text. Output is treated as a draft — the caller
 * must run it through the Step 2 confirmation screen before it becomes ground truth.
 */
export async function parseResume(
  rawText: string,
  isCareerChanger: boolean
): Promise<ResumeStructuredData> {
  const system = isCareerChanger
    ? 'You extract structured data from resumes for a candidate who has told us they are ' +
      'changing industries or roles. In addition to standard fields, identify transferable ' +
      'skills, their stated or inferable motivation for changing, and what they seem to be ' +
      'moving toward — frame their work history factually, not as a deficiency.'
    : 'You extract structured data from resumes. Be faithful to the source text; do not invent ' +
      'dates, employers, or achievements that are not present or clearly implied.';

  const result = await structuredCall(
    resumeSchema,
    system,
    `Resume text:\n\n${rawText}`,
    0.1
  );

  return result as ResumeStructuredData;
}
