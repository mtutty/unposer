import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { EvidenceService } from '../services/evidence.service';

const evidenceService = new EvidenceService();

const searchSchema = z.object({
  query: z.string().describe("A specific question or topic to search for, in the candidate's own domain language"),
  k: z.number().int().min(1).max(10).optional().describe('Number of results to return, default 5, max 10')
});

/**
 * Gives the sandbox/share-link chat (and, per CLAUDE.md's Step 6.5 note, eventually
 * career-debrief.chain.ts) an on-demand way to reach beyond the compact profile digest already
 * in its system prompt — evidence.service.ts's two-phase search over profile_evidence
 * (distilled, current, authoritative) and conversation_evidence (raw substrate, supplementary).
 *
 * `userId` and `audience` are both closed over per-request rather than model-controlled
 * arguments — scoping/trust-boundary decisions, same idea as sandbox-chat.chain.ts's
 * describeProfile(profile) taking profile as a parameter, not global state. `audience`
 * specifically (spec §8, Iteration 8) is never something the model could talk its way out of by
 * asking nicely — see evidence.service.ts's search() for why the filter lives at the SQL layer.
 */
export function buildEvidenceSearchTool(userId: string, audience: 'candidate' | 'recruiter') {
  return tool(
    async ({ query, k }: z.infer<typeof searchSchema>) => {
      const hits = await evidenceService.search(userId, query, k ?? 5, audience);
      if (hits.length === 0) return 'No matching evidence found.';

      return hits
        .map((h, i) => `[${i + 1}] [${h.tier === 'profile' ? 'profile' : 'conversation'}] (similarity ${h.similarity.toFixed(2)}) ${h.content}`)
        .join('\n\n');
    },
    {
      name: 'search_candidate_evidence',
      description:
        "Searches this candidate's full underlying evidence (resume detail, logistics, the deep-" +
        'prompt interview transcript, and profile insights/stories) beyond what is already ' +
        'summarized in the system prompt. Use only when the profile digest does not contain ' +
        'enough specific detail to answer the question confidently. Results are tagged ' +
        "[profile] (the candidate's current, confirmed profile — authoritative) or " +
        '[conversation] (raw supporting detail from the original conversation — background only). ' +
        'If a [conversation] result seems to conflict with a [profile] result, trust [profile]: ' +
        'it may reflect a correction made after that conversation happened.',
      schema: searchSchema
    }
  );
}
