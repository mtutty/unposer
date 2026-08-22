import { z } from 'zod';
import { resolveToolCall, streamWithTemperatureFallback, structuredCall } from './llm';
import { buildEvidenceSearchTool } from './evidence-search.tool';
import { AppError, ProfileData, SandboxCitation } from '../types';

export interface SandboxChatParams {
  profile: ProfileData;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  question: string;
  userId: string;
  // 'candidate' (Step 7, the candidate's own practice interview) or 'recruiter' (Step 8, the
  // public share link) — spec §8's guardrails apply only to the latter. Defaults to 'candidate'
  // so every existing call site (and every test) keeps working unchanged; share.service.ts is the
  // one caller that opts into 'recruiter'. See evidence-search.tool.ts/evidence.service.ts for
  // where this actually gets enforced (at the retrieval SQL boundary, not just this prompt).
  audience?: 'candidate' | 'recruiter';
}

/** Just the profile data, no framing — shared between the "answer as the candidate" system prompt
 *  below and the citations follow-up call, which needs the same context but under a different
 *  instruction (identify sources, don't answer as anyone). */
function describeProfile(profile: ProfileData): string {
  return [
    `Headline: ${profile.headline}`,
    `Summary: ${profile.summary}`,
    `Work history: ${JSON.stringify(profile.workHistory)}`,
    `Insights: ${JSON.stringify(profile.insights)}`,
    `Work style: ${JSON.stringify(profile.workStyle)}`,
    `Goals: ${JSON.stringify(profile.goals)}`,
    `Preferences: ${JSON.stringify(profile.preferences)}`,
    `Star stories: ${JSON.stringify(profile.starStories)}`
  ].join('\n\n');
}

function buildSandboxSystemPrompt(profile: ProfileData, audience: 'candidate' | 'recruiter'): string {
  return [
    'You are answering questions AS this job candidate, in first person, to someone playing the ' +
    'role of a recruiter or hiring manager. Answer only from the profile context below — if asked ' +
    'something it does not cover, say so honestly rather than inventing details. Keep answers ' +
    'conversational and specific; lean on the STAR stories and insights for evidence rather than ' +
    'restating the summary verbatim. Aim for about 100 words by default; only go up toward 200 if ' +
    'the human explicitly asks you to elaborate, go deeper, or say more. Break anything past a ' +
    "couple of sentences into short paragraphs — a blank line between them — rather than one dense " +
    'block; this is read on a screen, not delivered out loud.',
    // spec §8 — the retrieval-side filter (evidence-search.tool.ts/evidence.service.ts) is the
    // real enforcement; this is a second layer, not the only one, for the parts §8 states as
    // framing rather than a hard verbatim-content rule (raw scores, unsupported inference).
    audience === 'recruiter'
      ? 'You are talking to an actual recruiter or hiring manager, not the candidate themselves — ' +
        'never state a raw numeric score or trait label for any personality dimension (this ' +
        "candidate's profile has none to state anyway). Every claim about how this candidate " +
        'works must trace to specific job-relevant behavior in the evidence, never a vibe or a ' +
        'general impression.'
      : '',
    describeProfile(profile)
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Powers both Step 7 (candidate's own sandbox) and Step 8 (recruiter share link) — intentionally
 * the same function and the same context, because it must be "the exact same chat + RAG
 * experience" per spec, not a separate recruiter-facing view.
 *
 * The profile digest (describeProfile above) is always the default context — it's small enough
 * that most questions never need more. When it isn't enough, search_candidate_evidence (see
 * evidence-search.tool.ts) gives the model an on-demand path to the fuller evidence store
 * (profile_evidence + conversation_evidence) instead of that store being stuffed into every
 * turn's context. Checking for that need costs one extra non-streaming round trip on *every*
 * turn, even the common one where it turns out not to be needed — a real cost, not "free," and
 * worth revisiting (e.g. binding tools directly to the streaming call and inspecting the
 * accumulated response) if it proves too costly in practice; kept as the straightforward,
 * safe-to-reason-about version for now, matching identifySandboxCitations' existing precedent of
 * a separate call rather than mixing structured/tool resolution into one stream.
 *
 * Streams the *final* reply chunk by chunk rather than resolving with the full string — this is
 * the one chat in the app where the candidate/recruiter holds the conversational initiative and
 * the AI's reply is what most of a turn is spent waiting on, so perceived latency actually
 * matters here (contrast with elicitation/reask, where the human is mid-thought as often as
 * not). See sandbox.routes.ts, which forwards each chunk to the client as it arrives.
 */
export async function* streamSandboxChat(params: SandboxChatParams): AsyncGenerator<string> {
  const { profile, history, question, userId, audience = 'candidate' } = params;
  const system = buildSandboxSystemPrompt(profile, audience);
  const baseMessages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'human', content: question }
  ];

  try {
    const evidenceTool = buildEvidenceSearchTool(userId, audience);
    const toolCheck = await resolveToolCall(baseMessages, [evidenceTool], 0.5);

    let messages = baseMessages;
    if (toolCheck.tool_calls && toolCheck.tool_calls.length > 0) {
      const results = await Promise.all(toolCheck.tool_calls.map((call: any) => evidenceTool.invoke(call)));
      const evidenceContext = results.map((r: any) => (typeof r === 'string' ? r : r.content)).join('\n\n');

      // Folded in as extra context ahead of the question, not replayed as a literal
      // assistant-tool-call/tool-result exchange — the model doesn't need to see its own prior
      // tool invocation, just the evidence it asked for.
      messages = [
        ...baseMessages.slice(0, -1),
        { role: 'system', content: `Additional candidate evidence retrieved for this question:\n\n${evidenceContext}` },
        baseMessages[baseMessages.length - 1]
      ];
    }

    yield* streamWithTemperatureFallback(messages, 0.5);
  } catch (error: any) {
    throw new AppError('LLM_ERROR', `AI request failed: ${error.message || 'unknown error'}`, 502);
  }
}

/** Non-streaming convenience wrapper around streamSandboxChat — used by the public share link
 *  (Step 8), which today returns one JSON response rather than a progressive stream. Same chain,
 *  same context as the candidate's own sandbox; only the transport to the client differs. */
export async function runSandboxChat(params: SandboxChatParams): Promise<string> {
  let full = '';
  for await (const chunk of streamSandboxChat(params)) {
    full += chunk;
  }
  return full;
}

const citationsSchema = z.object({
  citations: z.array(
    z.object({
      source: z.enum(['work_history', 'insight', 'star_story', 'goals', 'preferences', 'work_style']),
      label: z.string().describe('Short human-readable label, e.g. a job title/company, or an insight\'s category'),
      detail: z.string().describe('One sentence: specifically what from this source grounded the answer')
    })
  )
});

/**
 * A deliberately separate follow-up call, run only after the visible reply has already fully
 * streamed to the client (see sandbox.routes.ts) — not folded into streamSandboxChat itself,
 * because a streamed prose reply and a schema-constrained structured one don't mix well over the
 * same token stream, and the citation list isn't needed until the candidate actually opens the
 * disclosure. Given the same context plus the answer just given, identifies which specific pieces
 * of profile evidence it actually drew on — Step 7's "why did it say that" affordance.
 */
export async function identifySandboxCitations(params: SandboxChatParams & { answer: string }): Promise<SandboxCitation[]> {
  const { profile, question, answer } = params;

  const system =
    'Given a candidate profile and a question-and-answer exchange, identify which specific pieces ' +
    'of the profile actually grounded the answer — not everything that could be relevant, only ' +
    "what the answer visibly draws on. Return an empty list if the answer didn't use the profile " +
    "(e.g. it said the profile doesn't cover this).";

  const human = [describeProfile(profile), `Question asked: ${question}`, `Answer given: ${answer}`].join('\n\n');

  const result = await structuredCall(citationsSchema, system, human, 0.2);
  return result.citations;
}
