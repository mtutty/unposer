import { EvidenceService } from './evidence.service';
import { ProfileData } from '../types';

jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('../ai/embeddings', () => ({
  embedText: jest.fn(),
  embedTexts: jest.fn()
}));
import { embedText, embedTexts } from '../ai/embeddings';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.delete = jest.fn().mockResolvedValue(undefined);
  builder.insert = jest.fn().mockResolvedValue(undefined);
  builder.orderBy = jest.fn(() => builder);
  builder.limit = jest.fn();
  return builder;
}

function profileFixture(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    headline: 'Engineer',
    summary: 'Summary',
    workHistory: [],
    insights: [
      { id: 'insight-1', category: 'strength', statement: 'Great collaborator', status: 'active', evidence: 'Led a project' }
    ],
    workStyle: { preferredEnvironment: '', teamDynamics: '', communicationStyle: '' },
    goals: { shortTerm: '', longTerm: '', idealNextRole: '' },
    preferences: { remote: '', companySize: '', industry: [] },
    starStories: [{ situation: 'S', task: 'T', action: 'A', result: 'R' }],
    openQuestions: [],
    ...overrides
  };
}

describe('EvidenceService.indexDistilledProfile', () => {
  let service: EvidenceService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockEmbedTexts = embedTexts as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EvidenceService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    mockEmbedTexts.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('deletes this user\'s existing profile_evidence rows before inserting fresh ones', async () => {
    const callOrder: string[] = [];
    builder.delete.mockImplementation(() => {
      callOrder.push('delete');
      return Promise.resolve();
    });
    builder.insert.mockImplementation(() => {
      callOrder.push('insert');
      return Promise.resolve();
    });

    await service.indexDistilledProfile('user-1', profileFixture());

    expect(callOrder).toEqual(['delete', 'insert']);
    expect(builder.where).toHaveBeenCalledWith({ user_id: 'user-1' });
  });

  it('produces one chunk per insight and one per STAR story, correctly tagged', async () => {
    await service.indexDistilledProfile('user-1', profileFixture());

    const [rows] = builder.insert.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.kind === 'insight')).toMatchObject({
      source_ref: 'insight-1',
      user_id: 'user-1'
    });
    expect(rows.find((r: any) => r.kind === 'star_story')).toMatchObject({
      source_ref: 'star-0',
      user_id: 'user-1'
    });
    // Embedding content is a vector literal string, e.g. "[0.1,0.2]" — not a raw array.
    expect(rows[0].embedding).toMatch(/^\[[\d.,]+\]$/);
  });

  it('skips the insert (but still clears stale rows) when the profile has no insights or stories', async () => {
    await service.indexDistilledProfile('user-1', profileFixture({ insights: [], starStories: [] }));

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.insert).not.toHaveBeenCalled();
    expect(mockEmbedTexts).not.toHaveBeenCalled();
  });
});

describe('EvidenceService.search', () => {
  let service: EvidenceService;
  const mockEmbedText = embedText as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EvidenceService();
    mockEmbedText.mockResolvedValue([0.5, 0.5]);
    (db as any).raw = jest.fn();
  });

  it('returns distilled-tier results alone when they are sufficient, without querying raw substrate', async () => {
    const dbRaw = (db as any).raw as jest.Mock;
    dbRaw.mockResolvedValueOnce({
      rows: Array.from({ length: 5 }, (_, i) => ({
        id: `p${i}`,
        content: `profile chunk ${i}`,
        metadata: {},
        similarity: 0.9
      }))
    });

    const hits = await service.search('user-1', 'a question', 5);

    expect(dbRaw).toHaveBeenCalledTimes(1); // only the profile_evidence query ran
    expect(hits).toHaveLength(5);
    expect(hits.every((h) => h.tier === 'profile')).toBe(true);
  });

  it('falls back to conversation-tier results, ranked after distilled ones, when distilled is thin', async () => {
    const dbRaw = (db as any).raw as jest.Mock;
    dbRaw
      .mockResolvedValueOnce({ rows: [{ id: 'p1', content: 'profile chunk', metadata: {}, similarity: 0.2 }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'c1', content: 'raw chunk 1', metadata: {}, similarity: 0.95 },
          { id: 'c2', content: 'raw chunk 2', metadata: {}, similarity: 0.9 }
        ]
      });

    const hits = await service.search('user-1', 'a question', 3);

    expect(dbRaw).toHaveBeenCalledTimes(2);
    // Distilled hit stays first even though the raw hits score higher on raw similarity.
    expect(hits[0]).toMatchObject({ id: 'p1', tier: 'profile' });
    expect(hits.slice(1).every((h) => h.tier === 'conversation')).toBe(true);
  });
});
