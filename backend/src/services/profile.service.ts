import { db } from '../db/connection';
import { AppError, CandidateProfile, DimensionKey, PersonalityInsight, ProfileInsight } from '../types';
import { generateCandidateProfile, ProfileGenerationInput } from '../ai/profile-generator.chain';
import { generateReaskQuestion } from '../ai/reask.chain';
import { TopicConversationService } from './topic-conversation.service';
import { ProgressionService } from './progression.service';
import { InsightService } from './insight.service';
import { EvidenceService } from './evidence.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ProfileService {
  // Personality engine (Iteration 5): swapped from ConversationService — deep_prompts has run on
  // topic_thread/exchange, not conversation_threads/messages, since Iteration 3. See
  // TopicConversationService.getFullTranscript()'s comment for the bug this fixes.
  private topicConversation = new TopicConversationService();
  private progression = new ProgressionService();
  private insights = new InsightService();
  private evidence = new EvidenceService();

  async getProfile(userId: string): Promise<CandidateProfile | null> {
    return (await db('candidate_profiles').where({ user_id: userId }).first()) || null;
  }

  /**
   * Loads resume/logistics/deep-prompt transcript and runs the profile-generator chain — the one
   * "synthesize the profile" code path shared by an initial `generateProfile` (status stays
   * `pending_review`, needs a first approval) and `applyGapCorrections` below, which passes
   * `status: 'approved'` — a correction is the candidate's own stated text, already "signed off"
   * by the act of typing it, so re-approving a regeneration of it would be a redundant gate. See
   * `applyGapCorrections`'s comment for why that path is irrevocable-by-design.
   */
  private async synthesizeProfile(
    userId: string,
    corrections?: ProfileGenerationInput['corrections'],
    status: 'pending_review' | 'approved' = 'pending_review'
  ): Promise<CandidateProfile> {
    const resume = await db('resumes').where({ user_id: userId }).first();
    if (!resume || !resume.confirmed) {
      throw new AppError('RESUME_NOT_CONFIRMED', 'Confirm your resume details before generating a profile.', 400);
    }

    const logistics = await db('logistics_responses').where({ user_id: userId }).first();

    // Personality engine (flow addendum §6): gated on tier, not a raw message count — the old
    // check counted rows in `messages`, which has been permanently empty for deep_prompts since
    // Iteration 3 moved that step onto topic_thread/exchange (found while wiring this iteration;
    // see the plan doc's Iteration 5 notes). Any tier past 'none' means at least one dimension
    // has real evidence.
    const tier = await this.progression.getTier(userId);
    if (tier === 'none') {
      throw new AppError('INSUFFICIENT_DATA', 'Complete the deep-prompt conversation before generating a profile.', 400);
    }

    const deepPromptTranscript = await this.topicConversation.getFullTranscript(userId);

    // Regenerates the personality engine's own insights first (spec §6's source of record) so
    // this chain can weave them in instead of independently re-deriving the same findings from
    // raw transcript text (flow addendum §6). Sketch-tier profiles get whatever's eligible so
    // far (possibly nothing, if the single dimension that reached medium confidence didn't
    // produce a strong-enough insight) — narrative-only either way, since ProfileInsight has no
    // numeric field to render regardless of tier.
    const personalityInsights = await this.insights.regenerate(userId);

    const profileData = await generateCandidateProfile({
      resume: resume.structured_data,
      isCareerChanger: resume.is_career_changer,
      logistics: logistics?.data || {},
      deepPromptTranscript: deepPromptTranscript.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
      corrections,
      personalityInsights: personalityInsights.map((pi) => ({ type: pi.type, text: pi.text }))
    });

    // Appended in code, not asked of the LLM (see profile-generator.chain.ts's comment) — uses
    // the real `insight.id` so a later flagInsight() can trace a flagged entry back to the
    // dimension(s) it came from.
    profileData.insights = [...profileData.insights, ...(await this.toProfileInsights(personalityInsights))];

    const existing = await this.getProfile(userId);

    const [profile] = await db('candidate_profiles')
      .insert({
        user_id: userId,
        status,
        version: existing ? existing.version + 1 : 1,
        profile_data: profileData,
        // Found via Iteration 5's live verification, root-caused via flagInsight's own crash
        // below: `pg` sends a plain JS *array* parameter as a Postgres native array literal
        // (`{...}`), not JSON — fine for an empty array (`{}` also happens to parse as valid,
        // if wrong-shaped, jsonb: an empty *object*, which is exactly the stale bad value this
        // guard defends against below), but produces malformed JSON for anything with real
        // content (see flagInsight's correctionLog write). Plain *objects* (profile_data) don't
        // hit this ambiguity — only arrays need the explicit JSON.stringify, matching every other
        // array-typed jsonb write in this codebase (e.g. scoring-aggregation.service.ts's
        // contributing_evidence_ids). Array.isArray guards existing rows still holding that
        // pre-fix `{}` value.
        correction_log: JSON.stringify(Array.isArray(existing?.correction_log) ? existing.correction_log : []),
        approved_at: status === 'approved' ? new Date() : null
      })
      .onConflict('user_id')
      .merge(['status', 'version', 'profile_data', 'approved_at'])
      .returning('*');

    // Re-indexes the distilled evidence tier for semantic retrieval in sandbox/share chat (see
    // evidence.service.ts) — wholesale replace, so a since-corrected insight can never outrank
    // the current one. Never gates profile generation on this.
    this.evidence.indexDistilledProfile(userId, profileData).catch((error) => {
      console.warn(`[profile.service] evidence indexing failed for user ${userId}:`, error.message || error);
    });

    return profile;
  }

  private async toProfileInsights(personalityInsights: PersonalityInsight[]): Promise<ProfileInsight[]> {
    const result: ProfileInsight[] = [];
    for (const pi of personalityInsights) {
      const firstEvidenceId = pi.supporting_evidence_ids[0];
      const evidenceRow = firstEvidenceId ? await db('dimension_evidence').where({ id: firstEvidenceId }).first() : undefined;
      result.push({
        id: pi.id,
        category: pi.type,
        statement: pi.text,
        evidence: evidenceRow?.span ?? pi.text,
        status: 'active'
      });
    }
    return result;
  }

  async generateProfile(userId: string): Promise<CandidateProfile> {
    return this.synthesizeProfile(userId);
  }

  /**
   * Step 7 -> Step 6 feedback loop: regenerates the profile from every currently-flagged sandbox
   * gap at once, treating the candidate's correction notes as authoritative evidence rather than
   * appending them anywhere for later review. No audit trail — once incorporated, a correction is
   * discarded (the flag is cleared) rather than kept as history, so re-running this with nothing
   * newly flagged is a no-op and a later session's new flags are picked up on the next apply.
   *
   * Unlike `flagInsight` (an AI-generated re-ask the candidate hasn't seen the answer to yet),
   * this regenerates from text the candidate themselves wrote — there's nothing left to review, so
   * it goes straight back to `approved` rather than `pending_review`. Deliberately irrevocable:
   * going back to an earlier version isn't supported, only forward via more corrections.
   */
  async applyGapCorrections(userId: string): Promise<{ profile: CandidateProfile; appliedCount: number }> {
    const pending = await db('sandbox_messages')
      .where({ user_id: userId, flagged_gap: true })
      .orderBy('created_at', 'asc');

    if (pending.length === 0) {
      throw new AppError('NO_PENDING_CORRECTIONS', 'No new corrections to apply.', 400);
    }

    const allMessages = await db('sandbox_messages').where({ user_id: userId }).orderBy('created_at', 'asc');

    const corrections = pending.map((flagged) => {
      const index = allMessages.findIndex((m) => m.id === flagged.id);
      const question = [...allMessages.slice(0, index)].reverse().find((m) => m.role === 'user');
      return {
        question: question?.content || '',
        wrongAnswer: flagged.content,
        correction: flagged.gap_note as string
      };
    });

    const profile = await this.synthesizeProfile(userId, corrections, 'approved');

    await db('sandbox_messages')
      .whereIn(
        'id',
        pending.map((m) => m.id)
      )
      .update({ flagged_gap: false, gap_note: null });

    return { profile, appliedCount: pending.length };
  }

  /**
   * Step 6 correction path. Never edits the insight directly — flags it and hands back one
   * targeted re-ask to route into the Step 5 chat, per spec. Flow addendum §6: the re-ask is
   * modeled as an ad hoc topic_thread, not a special case — see reaskDimensionsFor below for how
   * it finds which dimension(s) to target.
   */
  async flagInsight(userId: string, insightId: string): Promise<{ profile: CandidateProfile; reaskQuestion: string }> {
    const profile = await this.getProfile(userId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Profile not found', 404);
    }

    const insight = profile.profile_data.insights.find((i) => i.id === insightId);
    if (!insight) {
      throw new AppError('NOT_FOUND', 'Insight not found', 404);
    }

    const reaskQuestion = await generateReaskQuestion(insight.statement, insight.evidence);

    const updatedInsights: ProfileInsight[] = profile.profile_data.insights.map((i) =>
      i.id === insightId ? { ...i, status: 'flagged' as const } : i
    );

    const correctionLog = [
      ...(Array.isArray(profile.correction_log) ? profile.correction_log : []),
      {
        insightId,
        originalStatement: insight.statement,
        flaggedAt: new Date(),
        reaskQuestion,
        resolvedAt: null
      }
    ];

    const [updated] = await db('candidate_profiles')
      .where({ user_id: userId })
      .update({
        profile_data: { ...profile.profile_data, insights: updatedInsights },
        // See synthesizeProfile's insert above for why array-typed jsonb writes need explicit
        // JSON.stringify (this is the exact write that first surfaced the bug).
        correction_log: JSON.stringify(correctionLog),
        status: 'draft',
        updated_at: new Date()
      })
      .returning('*');

    const dimensions = await this.reaskDimensionsFor(insightId);
    await this.topicConversation.openAdHocTopic(userId, `reask-${insightId}`, reaskQuestion, dimensions, 'app');

    return { profile: updated, reaskQuestion };
  }

  /** A flagged insight sourced from the personality engine has `id === insight.id` (see
   *  toProfileInsights above) — this looks that row up and returns the dimension(s) its
   *  supporting evidence actually came from, so the re-ask's answer feeds dimension_evidence for
   *  the right dimension(s). Returns [] for an older/non-personality-engine insight (the original
   *  five categories predate this table entirely, and its `id` is an LLM-generated slug, not a
   *  real row id) — its re-ask still gets asked and indexed as raw substrate, just without
   *  dimension-scoring extraction, since there's nothing to target. */
  private async reaskDimensionsFor(insightId: string): Promise<DimensionKey[]> {
    if (!UUID_RE.test(insightId)) return [];

    const insightRow: PersonalityInsight | undefined = await db('insight').where({ id: insightId }).first();
    if (!insightRow || insightRow.supporting_evidence_ids.length === 0) return [];

    const rows: { dimension: DimensionKey }[] = await db('dimension_evidence')
      .whereIn('id', insightRow.supporting_evidence_ids)
      .distinct('dimension');
    return rows.map((r) => r.dimension);
  }

  async approveProfile(userId: string): Promise<CandidateProfile> {
    const [profile] = await db('candidate_profiles')
      .where({ user_id: userId })
      .update({ status: 'approved', approved_at: new Date() })
      .returning('*');

    if (!profile) {
      throw new AppError('NOT_FOUND', 'Profile not found', 404);
    }

    return profile;
  }

  /** Step 7 -> Step 6 feedback loop: a sandbox-surfaced gap becomes an open question on the profile. */
  async addOpenQuestion(userId: string, note: string): Promise<CandidateProfile> {
    const profile = await this.getProfile(userId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Profile not found', 404);
    }

    const openQuestions = [
      ...profile.profile_data.openQuestions,
      { id: crypto.randomUUID(), note, createdAt: new Date().toISOString(), resolved: false }
    ];

    const [updated] = await db('candidate_profiles')
      .where({ user_id: userId })
      .update({ profile_data: { ...profile.profile_data, openQuestions }, updated_at: new Date() })
      .returning('*');

    return updated;
  }
}
