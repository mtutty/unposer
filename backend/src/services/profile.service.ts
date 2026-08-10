import { db } from '../db/connection';
import { AppError, CandidateProfile, ProfileInsight } from '../types';
import { generateCandidateProfile } from '../ai/profile-generator.chain';
import { generateReaskQuestion } from '../ai/reask.chain';
import { ConversationService } from './conversation.service';

export class ProfileService {
  private conversation = new ConversationService();

  async getProfile(userId: string): Promise<CandidateProfile | null> {
    return (await db('candidate_profiles').where({ user_id: userId }).first()) || null;
  }

  async generateProfile(userId: string): Promise<CandidateProfile> {
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
      }))
    });

    const existing = await this.getProfile(userId);

    const [profile] = await db('candidate_profiles')
      .insert({
        user_id: userId,
        status: 'pending_review',
        version: existing ? existing.version + 1 : 1,
        profile_data: profileData,
        correction_log: existing?.correction_log || []
      })
      .onConflict('user_id')
      .merge(['status', 'version', 'profile_data'])
      .returning('*');

    return profile;
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
