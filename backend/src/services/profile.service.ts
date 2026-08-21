import { db } from '../db/connection';
import { AppError, CandidateProfile, ProfileInsight } from '../types';
import { generateCandidateProfile, ProfileGenerationInput } from '../ai/profile-generator.chain';
import { generateReaskQuestion } from '../ai/reask.chain';
import { ConversationService } from './conversation.service';
import { EvidenceService } from './evidence.service';

export class ProfileService {
  private conversation = new ConversationService();
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
    const deepPromptMessages = await this.conversation.getHistory(userId, 'deep_prompts');

    if (deepPromptMessages.filter((m) => m.role === 'user').length < 2) {
      throw new AppError('INSUFFICIENT_DATA', 'Complete the deep-prompt conversation before generating a profile.', 400);
    }

    const profileData = await generateCandidateProfile({
      resume: resume.structured_data,
      isCareerChanger: resume.is_career_changer,
      logistics: logistics?.data || {},
      deepPromptTranscript: deepPromptMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
      corrections
    });

    const existing = await this.getProfile(userId);

    const [profile] = await db('candidate_profiles')
      .insert({
        user_id: userId,
        status,
        version: existing ? existing.version + 1 : 1,
        profile_data: profileData,
        correction_log: existing?.correction_log || [],
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
   * targeted re-ask to route into the Step 5 chat, per spec.
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
      ...profile.correction_log,
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
        correction_log: correctionLog,
        status: 'draft',
        updated_at: new Date()
      })
      .returning('*');

    // Re-open the deep-prompt thread with the re-ask as the next question, same table the
    // adaptive chat already reads from — no separate correction inbox.
    const thread = await this.conversation.getOrCreateThread(userId, 'deep_prompts', 'app');
    await db('conversation_threads').where({ id: thread.id }).update({ status: 'active', updated_at: new Date() });
    await db('messages').insert({
      thread_id: thread.id,
      user_id: userId,
      role: 'assistant',
      content: reaskQuestion,
      channel: 'app',
      step: 'deep_prompts',
      metadata: { reask: true, insightId }
    });

    return { profile: updated, reaskQuestion };
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
