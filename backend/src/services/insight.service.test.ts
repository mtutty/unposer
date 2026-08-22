jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('../ai/insight-generator.chain', () => ({ generateInsights: jest.fn() }));
import { generateInsights } from '../ai/insight-generator.chain';

import { InsightService } from './insight.service';
import { DimensionScore, DimensionEvidence } from '../types';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.whereIn = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.select = jest.fn();
  builder.delete = jest.fn();
  builder.insert = jest.fn(() => builder);
  builder.returning = jest.fn();
  return builder;
}

function scoreRow(overrides: Partial<DimensionScore> = {}): DimensionScore {
  return {
    id: 'ds-1',
    user_id: 'user-1',
    dimension: 'openness',
    version: 1,
    score: 70,
    confidence: 'medium',
    band: 'medium',
    tier: null,
    contributing_evidence_ids: ['ev1'],
    distinct_questions: 2,
    distinct_occasions: 2,
    variance_pattern: null,
    computed_at: new Date(),
    ...overrides
  };
}

function evidenceRow(overrides: Partial<DimensionEvidence> = {}): DimensionEvidence {
  return {
    id: 'ev1',
    exchange_id: 'ex-1',
    dimension: 'openness',
    span: 'I love learning new things',
    direction: 'high',
    strength: 'strong',
    type: 'explicit_statement',
    facet: 'ideas',
    note: 'direct statement',
    created_at: new Date(),
    ...overrides
  };
}

describe('InsightService.regenerate', () => {
  let service: InsightService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockGenerateInsights = generateInsights as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InsightService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('excludes dimensions below medium confidence from the eligible set', async () => {
    builder.select
      .mockResolvedValueOnce([scoreRow({ dimension: 'openness', confidence: 'medium' }), scoreRow({ dimension: 'dominance', confidence: 'low', id: 'ds-2' })])
      .mockResolvedValueOnce([evidenceRow()]);
    mockGenerateInsights.mockResolvedValueOnce([]);
    builder.delete.mockResolvedValueOnce(undefined);

    await service.regenerate('user-1');

    const [call] = mockGenerateInsights.mock.calls;
    expect(call[0].dimensions).toHaveLength(1);
    expect(call[0].dimensions[0].dimension).toBe('openness');
  });

  it('uses only the latest version per dimension when checking eligibility', async () => {
    builder.select.mockResolvedValueOnce([
      scoreRow({ dimension: 'openness', version: 1, confidence: 'medium' }),
      scoreRow({ dimension: 'openness', version: 2, confidence: 'low' }) // supersedes v1 — no longer eligible
    ]);
    builder.delete.mockResolvedValueOnce(undefined);

    const result = await service.regenerate('user-1');

    expect(mockGenerateInsights).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('marks contextDependenceEligible only for a topic_linked variance pattern', async () => {
    builder.select
      .mockResolvedValueOnce([scoreRow({ dimension: 'dominance', confidence: 'medium', variance_pattern: 'topic_linked', contributing_evidence_ids: [] })])
      .mockResolvedValueOnce([]);
    mockGenerateInsights.mockResolvedValueOnce([]);
    builder.delete.mockResolvedValueOnce(undefined);

    await service.regenerate('user-1');

    const [call] = mockGenerateInsights.mock.calls;
    expect(call[0].dimensions[0].contextDependenceEligible).toBe(true);
  });

  it('wholesale-replaces prior insights and persists the generated ones', async () => {
    builder.select
      .mockResolvedValueOnce([scoreRow()])
      .mockResolvedValueOnce([evidenceRow()]);
    mockGenerateInsights.mockResolvedValueOnce([
      { type: 'own_words', text: 'A vivid quote.', supportingDimensions: ['openness'], supportingEvidenceIds: ['ev1'] }
    ]);
    builder.delete.mockResolvedValueOnce(undefined);
    builder.returning.mockResolvedValueOnce([{ id: 'in-1', type: 'own_words', text: 'A vivid quote.' }]);

    const result = await service.regenerate('user-1');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: 'user-1', type: 'own_words', surfaced_to_user: true, surfaced_to_recruiter: false })
    ]);
    expect(result).toEqual([{ id: 'in-1', type: 'own_words', text: 'A vivid quote.' }]);
  });

  it('skips the generator call entirely (and still clears prior insights) when nothing is eligible', async () => {
    builder.select.mockResolvedValueOnce([]); // no dimension_score rows at all
    builder.delete.mockResolvedValueOnce(undefined);

    const result = await service.regenerate('user-1');

    expect(mockGenerateInsights).not.toHaveBeenCalled();
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.insert).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('picks the highest-ranked evidence (explicit_statement/strong first) and caps at 4 spans', async () => {
    const evidenceIds = ['e1', 'e2', 'e3', 'e4', 'e5'];
    builder.select
      .mockResolvedValueOnce([scoreRow({ contributing_evidence_ids: evidenceIds })])
      .mockResolvedValueOnce([
        evidenceRow({ id: 'e1', type: 'linguistic_marker', strength: 'weak' }),
        evidenceRow({ id: 'e2', type: 'explicit_statement', strength: 'strong' }),
        evidenceRow({ id: 'e3', type: 'behavioral_report', strength: 'moderate' }),
        evidenceRow({ id: 'e4', type: 'attribution_pattern', strength: 'weak' }),
        evidenceRow({ id: 'e5', type: 'explicit_statement', strength: 'moderate' })
      ]);
    mockGenerateInsights.mockResolvedValueOnce([]);
    builder.delete.mockResolvedValueOnce(undefined);

    await service.regenerate('user-1');

    const [call] = mockGenerateInsights.mock.calls;
    const passedIds = call[0].dimensions[0].evidence.map((e: any) => e.id);
    expect(passedIds).toHaveLength(4);
    expect(passedIds[0]).toBe('e2'); // explicit_statement + strong ranks highest
    expect(passedIds).not.toContain('e1'); // weakest (linguistic_marker + weak) dropped to stay under the cap
  });
});
