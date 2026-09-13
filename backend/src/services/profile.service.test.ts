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

jest.mock('./culture-signal.service');
import { CultureSignalService } from './culture-signal.service';

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
    discoverable: false,
    search_role: null,
    search_location: null,
    search_remote: null,
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
  const mockRegenerateCultureSignal = CultureSignalService.prototype.regenerate as jest.Mock;
  const mockGenerateCandidateProfile = generateCandidateProfile as jest.Mock;
  const mockIndexDistilledProfile = EvidenceService.prototype.indexDistilledProfile as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProfileService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    mockIndexDistilledProfile.mockResolvedValue(undefined);
    mockRegenerateCultureSignal.mockResolvedValue([]);
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
          { role: 'assistant', content: 'Q?', heavy: false },
          { role: 'user', content: 'A.', heavy: false }
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
    expect(mockRegenerateCultureSignal).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(inserted);
  });

  it('looks up each transcript message\'s heavy flag from the question library via metadata.question_id', async () => {
    builder.first
      .mockResolvedValueOnce({ confirmed: true, structured_data: {}, is_career_changer: false }) // resumes
      .mockResolvedValueOnce({ data: {} }); // logistics_responses
    mockGetTier.mockResolvedValueOnce('sketch');
    mockGetFullTranscript.mockResolvedValueOnce([
      { id: 'ex-1', role: 'assistant', content: 'heavy question', thread_id: 't', user_id: 'user-1', channel: 'app', step: 'deep_prompts', metadata: { question_id: 'Q5' }, created_at: new Date() },
      { id: 'ex-2', role: 'user', content: 'heavy answer', thread_id: 't', user_id: 'user-1', channel: 'app', step: 'deep_prompts', metadata: { question_id: 'Q5' }, created_at: new Date() },
      { id: 'ex-3', role: 'assistant', content: 'light question', thread_id: 't2', user_id: 'user-1', channel: 'app', step: 'deep_prompts', metadata: { question_id: 'Q0' }, created_at: new Date() },
      { id: 'ex-4', role: 'assistant', content: 'ad hoc re-ask', thread_id: 't3', user_id: 'user-1', channel: 'app', step: 'deep_prompts', metadata: { question_id: 'reask-abc' }, created_at: new Date() }
    ]);
    mockRegenerateInsights.mockResolvedValueOnce([]);
    mockGenerateCandidateProfile.mockResolvedValueOnce({
      headline: 'h',
      summary: 's',
      workHistory: [],
      insights: [],
      workStyle: { preferredEnvironment: '', teamDynamics: '', communicationStyle: '' },
      goals: { shortTerm: '', longTerm: '', idealNextRole: '' },
      preferences: { remote: '', companySize: '', industry: [] },
      starStories: [],
      openQuestions: []
    });
    builder.first.mockResolvedValueOnce(undefined); // getProfile (no existing profile)
    builder.returning.mockResolvedValueOnce([profileFixture()]);

    await service.generateProfile('user-1');

    expect(mockGenerateCandidateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        deepPromptTranscript: [
          { role: 'assistant', content: 'heavy question', heavy: true },
          { role: 'user', content: 'heavy answer', heavy: true },
          { role: 'assistant', content: 'light question', heavy: false },
          { role: 'assistant', content: 'ad hoc re-ask', heavy: false } // question_id not in the library -> not heavy
        ]
      })
    );
  });

  it('never uses a heavy dimension_evidence span verbatim as a personality insight\'s evidence field, falling back to its own narrative text', async () => {
    builder.first
      .mockResolvedValueOnce({ confirmed: true, structured_data: {}, is_career_changer: false }) // resumes
      .mockResolvedValueOnce({ data: {} }); // logistics_responses
    mockGetTier.mockResolvedValueOnce('sketch');
    mockGetFullTranscript.mockResolvedValueOnce([]);
    mockRegenerateInsights.mockResolvedValueOnce([
      {
        id: 'pi-uuid-2',
        user_id: 'user-1',
        type: 'tension',
        text: 'A narrative read, never a verbatim quote.',
        supporting_evidence_ids: ['ev-heavy'],
        surfaced_to_user: true,
        surfaced_to_recruiter: false,
        heavy: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
    mockGenerateCandidateProfile.mockResolvedValueOnce({
      headline: 'h',
      summary: 's',
      workHistory: [],
      insights: [],
      workStyle: { preferredEnvironment: '', teamDynamics: '', communicationStyle: '' },
      goals: { shortTerm: '', longTerm: '', idealNextRole: '' },
      preferences: { remote: '', companySize: '', industry: [] },
      starStories: [],
      openQuestions: []
    });
    // The looked-up dimension_evidence row is itself heavy — this is the raw verbatim span that
    // must never end up in ProfileInsight.evidence.
    builder.first.mockResolvedValueOnce({ span: 'the raw heavy verbatim span', heavy: true });
    builder.first.mockResolvedValueOnce(undefined); // getProfile (no existing profile)
    builder.returning.mockResolvedValueOnce([profileFixture()]);

    await service.generateProfile('user-1');

    const insertedRow = builder.insert.mock.calls[0][0];
    expect(insertedRow.profile_data.insights).toEqual([
      {
        id: 'pi-uuid-2',
        category: 'tension',
        statement: 'A narrative read, never a verbatim quote.',
        evidence: 'A narrative read, never a verbatim quote.',
        status: 'active',
        heavy: true
      }
    ]);
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
