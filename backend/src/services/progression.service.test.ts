jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';
import { ProgressionService } from './progression.service';
import { DimensionKey, DimensionScore } from '../types';

const ALL_DIMENSIONS: DimensionKey[] = [
  'emotional_stability',
  'social_energy',
  'dominance',
  'agreeableness',
  'conscientiousness',
  'openness',
  'change_orientation',
  'thinking_style',
  'detail_orientation',
  'motivation',
  'work_style'
];

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.select = jest.fn();
  builder.insert = jest.fn(() => builder);
  builder.onConflict = jest.fn(() => builder);
  builder.merge = jest.fn(() => builder);
  builder.returning = jest.fn();
  builder.update = jest.fn();
  builder.first = jest.fn();
  return builder;
}

function scoreRow(overrides: Partial<DimensionScore> = {}): DimensionScore {
  return {
    id: `ds-${overrides.dimension ?? 'x'}-${overrides.version ?? 1}`,
    user_id: 'user-1',
    dimension: 'work_style',
    version: 1,
    score: 50,
    confidence: 'medium',
    band: 'medium',
    tier: null,
    contributing_evidence_ids: [],
    distinct_questions: 2,
    distinct_occasions: 2,
    variance_pattern: null,
    computed_at: new Date(),
    ...overrides
  };
}

describe('ProgressionService.recomputeTier', () => {
  let service: ProgressionService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProgressionService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('assigns tier "none" when nothing has reached medium confidence', async () => {
    builder.select.mockResolvedValueOnce([scoreRow({ confidence: 'low' })]);
    builder.returning.mockResolvedValueOnce([{ tier: 'none', dimensions_at_confidence: [] }]);

    const result = await service.recomputeTier('user-1');

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ tier: 'none' }));
    expect(result.tier).toBe('none');
  });

  it('assigns "sketch" once at least one dimension reaches medium confidence, without requiring all 11', async () => {
    builder.select.mockResolvedValueOnce([scoreRow({ dimension: 'work_style', confidence: 'medium' })]);
    builder.returning.mockResolvedValueOnce([{ tier: 'sketch' }]);

    await service.recomputeTier('user-1');

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'sketch', dimensions_at_confidence: JSON.stringify(['work_style']) })
    );
  });

  it('assigns "core_persona" once all 11 dimensions reach medium confidence but the in-depth evidence bar is not met', async () => {
    const rows = ALL_DIMENSIONS.map((d) => scoreRow({ dimension: d, confidence: 'medium', distinct_questions: 1, distinct_occasions: 1 }));
    builder.select.mockResolvedValueOnce(rows);
    builder.returning.mockResolvedValueOnce([{ tier: 'core_persona' }]);

    await service.recomputeTier('user-1');

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ tier: 'core_persona' }));
  });

  it('assigns "in_depth" once every dimension also has ≥2 questions on ≥2 distinct occasions (its own tier bar)', async () => {
    const rows = ALL_DIMENSIONS.map((d) => scoreRow({ dimension: d, confidence: 'medium', distinct_questions: 2, distinct_occasions: 2 }));
    builder.select.mockResolvedValueOnce(rows);
    builder.returning.mockResolvedValueOnce([{ tier: 'in_depth' }]);

    await service.recomputeTier('user-1');

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ tier: 'in_depth' }));
  });

  it('uses only the latest version per dimension, ignoring stale lower-version rows', async () => {
    builder.select.mockResolvedValueOnce([
      scoreRow({ dimension: 'work_style', version: 1, confidence: 'medium' }),
      scoreRow({ dimension: 'work_style', version: 2, confidence: 'low' }) // supersedes v1 — should NOT count toward sketch
    ]);
    builder.returning.mockResolvedValueOnce([{ tier: 'none' }]);

    await service.recomputeTier('user-1');

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ tier: 'none' }));
  });

  it('stamps the computed tier onto each contributing dimension_score row in place', async () => {
    builder.select.mockResolvedValueOnce([scoreRow({ id: 'ds-1', dimension: 'work_style', confidence: 'medium' })]);
    builder.returning.mockResolvedValueOnce([{ tier: 'sketch' }]);

    await service.recomputeTier('user-1');

    expect(builder.where).toHaveBeenCalledWith({ id: 'ds-1' });
    expect(builder.update).toHaveBeenCalledWith({ tier: 'sketch' });
  });
});

describe('ProgressionService.getTier', () => {
  let service: ProgressionService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProgressionService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('returns the stored tier', async () => {
    builder.first.mockResolvedValueOnce({ tier: 'core_persona' });
    expect(await service.getTier('user-1')).toBe('core_persona');
  });

  it('returns "none" when the user has no progression row yet', async () => {
    builder.first.mockResolvedValueOnce(undefined);
    expect(await service.getTier('user-1')).toBe('none');
  });
});

describe('ProgressionService.getTemporalDepthSummary', () => {
  let service: ProgressionService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProgressionService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('flags medium+ dimensions whose evidence all came from a single occasion', async () => {
    builder.select.mockResolvedValueOnce([
      scoreRow({ dimension: 'work_style', confidence: 'medium', distinct_occasions: 1 }),
      scoreRow({ dimension: 'openness', confidence: 'medium-high', distinct_occasions: 3 }),
      scoreRow({ dimension: 'motivation', confidence: 'low', distinct_occasions: 1 }) // below medium — excluded entirely
    ]);

    const result = await service.getTemporalDepthSummary('user-1');

    expect(result.dimensionsAtConfidence.sort()).toEqual(['openness', 'work_style']);
    expect(result.singleSessionDimensions).toEqual(['work_style']);
  });
});
