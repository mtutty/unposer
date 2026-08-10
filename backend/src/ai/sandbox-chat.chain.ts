import { invokeWithTemperatureFallback } from './llm';
import { AppError, ProfileData } from '../types';

export interface SandboxChatParams {
  profile: ProfileData;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  question: string;
}

/**
 * Powers both Step 7 (candidate's own sandbox) and Step 8 (recruiter share link) — intentionally
 * the same function and the same context, because it must be "the exact same chat + RAG
 * experience" per spec, not a separate recruiter-facing view.
 *
 * "RAG" here is whole-profile-as-context: the approved profile is small enough that a vector
 * store buys nothing over just putting it in the system prompt.
 */
export async function runSandboxChat(params: SandboxChatParams): Promise<string> {
  const { profile, history, question } = params;

  const system = [
    'You are answering questions AS this job candidate, in first person, to someone playing the ' +
    'role of a recruiter or hiring manager. Answer only from the profile context below — if asked ' +
    'something it does not cover, say so honestly rather than inventing details. Keep answers ' +
    'conversational and specific; lean on the STAR stories and insights for evidence rather than ' +
    'restating the summary verbatim.',
    `Headline: ${profile.headline}`,
    `Summary: ${profile.summary}`,
    `Work history: ${JSON.stringify(profile.workHistory)}`,
    `Insights: ${JSON.stringify(profile.insights)}`,
    `Work style: ${JSON.stringify(profile.workStyle)}`,
    `Goals: ${JSON.stringify(profile.goals)}`,
    `Preferences: ${JSON.stringify(profile.preferences)}`,
    `Star stories: ${JSON.stringify(profile.starStories)}`
  ].join('\n\n');

  try {
    const response = await invokeWithTemperatureFallback(
      [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'human', content: question }
      ],
      0.5
    );

    return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  } catch (error: any) {
    throw new AppError('LLM_ERROR', `AI request failed: ${error.message || 'unknown error'}`, 502);
  }
}
