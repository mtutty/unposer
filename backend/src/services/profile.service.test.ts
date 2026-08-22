jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('../ai/profile-generator.chain', () => ({ generateCandidateProfile: jest.fn() }));
import { generateCandidateProfile } from '../ai/profile-generator.chain';

jest.mock('../ai/reask.chain', () => ({ generateReaskQuestion: jest.fn() }));
import { generateReaskQuestion } from '../ai/reask.chain';

jest.mock('./topic-conversation.service');
import { TopicConversationService } from './topic-conversation.service';

jest.mock('./progression.service');
import { ProgressionService } from './progression.service';

jest.mock('./insight.service');
import { InsightService } from './insight.service';

jest.mock('./evidence.service');
import { EvidenceService } from './evidence.service';

import { ProfileService } from './profile.service';
import { CandidateProfile } from '../types';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.whereIn = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.distinct = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.onConflict = jest.fn(() => builder);
  builder.merge = jest.fn(() => builder);
  builder.update = jest.fn(() => builder);
  builder.returning = jest.fn();
  builder.first = jest.fn();
  return builder;
}

function profileFixture(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    status: 'pending_review',
    version: 1,
    profile_data: {
      headline: 'h',
      summary: 's',
      workHistory: [],
      insights: [{ id: 'slug-insight', category: 'strength', statement: 'stmt', evidence: 'ev', status: 'active' }],
      workStyle: { preferredEnvironment: '', teamDynamics: '', communicationStyle: '' },
      goals: { shortTerm: '', longTerm: '', idealNextRole: '' },
      preferences: { remote: '', companySize: '', industry: [] },
      starStories: [],
      openQuestions: []
    },
    correction_log: [],
    approved_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

describe('ProfileService.generateProfile', () => {
  let service: ProfileService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockGetTier = ProgressionService.prototype.getTier as jest.Mock;
  const mockGetFullTranscript = TopicConversationService.prototype.getFullTranscript as jest.Mock;
  const mockRegenerateInsights = InsightService.prototype.regenerate as jest.Mock;
  const mockGenerateCandidateProfile = generateCandidateProfile as jest.Mock;
  const mockIndexDistilledProfile = EvidenceService.prototype.indexDistilledProfile as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProfileService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    mockIndexDistilledProfile.mockResolvedValue(undefined);
  });

  it('throws INSUFFICIENT_DATA when progression.tier is still "none", without ever calling the chain', async () => {
    builder.first.mockResolvedValueOnce({ confirmed: true, structured_data: {}, is_career_changer: false }); // resumes
    builder.first.mockResolvedValueOnce({}); // logistics_responses
    mockGetTier.mockResolvedValueOnce('none');

    await expect(service.generateProfile('user-1')).rejects.toMatchObject({ code: 'INSUFFICIENT_DATA' });
    expect(mockGenerateCandidateProfile).not.toHaveBeenCalled();
  });

  it('sources the transcript from TopicConversationService, not the old messages table, and appends personality insights with their real ids', async () => {
    builder.first
      .mockResolvedValueOnce({ confirmed: true, structured_data: {}, is_career_changer: false }) // resumes
      .mockResolvedValueOnce({ data: {} }); // logistics_responses
    mockGetTier.mockResolvedValueOnce('sketch');
    mockGetFullTranscript.mockResolvedValueOnce([
      { id: 'ex-1', role: 'assistant', content: 'Q?', thread_id: 't', user_id: 'user-1', channel: 'app', step: 'deep_prompts', metadata: {}, created_at: new Date() },
      { id: 'ex-2', role: 'user', content: 'A.', thread_id: 't', user_id: 'user-1', channel: 'app', step: 'deep_prompts', metadata: {}, created_at: new Date() }
    ]);
    mockRegenerateInsights.mockResolvedValueOnce([
      {
        id: 'pi-uuid-1',
        user_id: 'user-1',
        type: 'own_words',
        text: 'A vivid quote.',
        supporting_evidence_ids: ['ev-1'],
        surfaced_to_user: true,
        surfaced_to_recruiter: false,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
    mockGenerateCandidateProfile.mockResolvedValueOnce({
      headline: 'h',
      summary: 's',
      workHistory: [],
      insights: [{ id: 'llm-slug', category: 'strength', statement: 'from resume', evidence: 'ev', status: 'active' }],
      workStyle: { preferredEnvironment: '', teamDynamics: '', communicationStyle: '' },
      goals: { shortTerm: '', longTerm: '', idealNextRole: '' },
      preferences: { remote: '', companySize: '', industry: [] },
      starStories: [],
      openQuestions: []
    });
    builder.first.mockResolvedValueOnce({ span: 'the exact quoted span' }); // dimension_evidence lookup for the appended insight
    builder.first.mockResolvedValueOnce(undefined); // getProfile (no existing profile)
    const inserted = profileFixture();
    builder.returning.mockResolvedValueOnce([inserted]); // candidate_profiles insert

    const result = await service.generateProfile('user-1');

    expect(mockGetFullTranscript).toHaveBeenCalledWith('user-1');
    expect(mockGenerateCandidateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        deepPromptTranscript: [
          { role: 'assistant', content: 'Q?' },
          { role: 'user', content: 'A.' }
        ],
        personalityInsights: [{ type: 'own_words', text: 'A vivid quote.' }]
      })
    );
    const insertedRow = builder.insert.mock.calls[0][0];
    expect(insertedRow.profile_data.insights).toEqual([
      { id: 'llm-slug', category: 'strength', statement: 'from resume', evidence: 'ev', status: 'active' },
      { id: 'pi-uuid-1', category: 'own_words', statement: 'A vivid quote.', evidence: 'the exact quoted span', status: 'active' }
    ]);
    // `pg` sends a bare JS array parameter as a Postgres array literal, not JSON — this jsonb
    // column write must be an explicit JSON string, not the raw array (see the plan doc's
    // Iteration 5 notes for the live bug this guards against regressing).
    expect(typeof insertedRow.correction_log).toBe('string');
    expect(JSON.parse(insertedRow.correction_log)).toEqual([]);
    expect(result).toEqual(inserted);
  });
});

describe('ProfileService.flagInsight', () => {
  let service: ProfileService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockGenerateReaskQuestion = generateReaskQuestion as jest.Mock;
  const mockOpenAdHocTopic = TopicConversationService.prototype.openAdHocTopic as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProfileService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    mockOpenAdHocTopic.mockResolvedValue({});
  });

  it('opens the re-ask targeting the flagged insight\'s real dimension(s) when it is personality-engine-sourced', async () => {
    const insightId = '11111111-2222-3333-4444-555555555555';
    builder.first.mockResolvedValueOnce(profileFixture({ profile_data: { ...profileFixture().profile_data, insights: [
      { id: insightId, category: 'own_words', statement: 'stmt', evidence: 'ev', status: 'active' }
    ] } })); // getProfile
    mockGenerateReaskQuestion.mockResolvedValueOnce('Tell me more about that.');
    builder.returning.mockResolvedValueOnce([profileFixture()]); // candidate_profiles update
    builder.first.mockResolvedValueOnce({ id: insightId, supporting_evidence_ids: ['ev-1', 'ev-2'] }); // insight row lookup
    builder.distinct.mockResolvedValueOnce([{ dimension: 'openness' }, { dimension: 'motivation' }]); // dimension_evidence distinct

    await service.flagInsight('user-1', insightId);

    expect(mockOpenAdHocTopic).toHaveBeenCalledWith('user-1', `reask-${insightId}`, 'Tell me more about that.', ['openness', 'motivation'], 'app');
    const updatedRow = builder.update.mock.calls[0][0];
    expect(typeof updatedRow.correction_log).toBe('string');
    expect(JSON.parse(updatedRow.correction_log)).toHaveLength(1);
  });

  it('opens the re-ask with no target dimensions for a pre-Iteration-5 (non-UUID) insight id, without querying the insight table', async () => {
    const insightId = 'communication-skills-strength';
    builder.first.mockResolvedValueOnce(profileFixture({ profile_data: { ...profileFixture().profile_data, insights: [
      { id: insightId, category: 'strength', statement: 'stmt', evidence: 'ev', status: 'active' }
    ] } }));
    mockGenerateReaskQuestion.mockResolvedValueOnce('Tell me more.');
    builder.returning.mockResolvedValueOnce([profileFixture()]);

    await service.flagInsight('user-1', insightId);

    expect(mockOpenAdHocTopic).toHaveBeenCalledWith('user-1', `reask-${insightId}`, 'Tell me more.', [], 'app');
  });

  it('throws NOT_FOUND when the insight id does not exist on the profile', async () => {
    builder.first.mockResolvedValueOnce(profileFixture());

    await expect(service.flagInsight('user-1', 'does-not-exist')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
