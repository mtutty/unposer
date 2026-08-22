jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('../utils/variance-classification', () => ({ classifyVariance: jest.fn() }));
import { classifyVariance } from '../utils/variance-classification';

import { ScoringAggregationService } from './scoring-aggregation.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.whereIn = jest.fn(() => builder);
  builder.max = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.select = jest.fn();
  builder.first = jest.fn();
  builder.returning = jest.fn();
  return builder;
}

describe('ScoringAggregationService.recomputeDimension', () => {
  let service: ScoringAggregationService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockClassify = classifyVariance as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScoringAggregationService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  function mockEvidenceLoad(threads: any[], exchanges: any[], evidenceRows: any[]) {
    builder.select.mockResolvedValueOnce(threads).mockResolvedValueOnce(exchanges).mockResolvedValueOnce(evidenceRows);
  }

  it('suppresses the score with insufficient_signal when there is no evidence at all', async () => {
    builder.select.mockResolvedValueOnce([]); // topic_thread: no threads for this user
    builder.first.mockResolvedValueOnce(undefined); // version lookup
    builder.returning.mockResolvedValueOnce([{ confidence: 'insufficient_signal', score: null }]);

    const result = await service.recomputeDimension('user-1', 'work_style');

    expect(result.confidence).toBe('insufficient_signal');
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('suppresses the score when evidence exists but falls short of §9.3’s minimum threshold', async () => {
    const threads = [{ id: 't1', question_id: 'Q1' }];
    const exchanges = [{ id: 'ex1', thread_id: 't1', occasion_id: '2026-01-01', sent_at: new Date('2026-01-01') }];
    const evidenceRows = [{ id: 'de1', exchange_id: 'ex1', direction: 'high', strength: 'weak', type: 'linguistic_marker' }];
    mockEvidenceLoad(threads, exchanges, evidenceRows);
    builder.first.mockResolvedValueOnce(undefined);
    builder.returning.mockResolvedValueOnce([{ confidence: 'insufficient_signal', score: null }]);

    const result = await service.recomputeDimension('user-1', 'work_style');

    expect(result.confidence).toBe('insufficient_signal');
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ score: null, confidence: 'insufficient_signal', band: null }));
  });

  it('computes the weighted-mean score anchored at 50, using type_weight and strength_weight', async () => {
    const threads = [
      { id: 't1', question_id: 'Q1' },
      { id: 't2', question_id: 'Q2' }
    ];
    const exchanges = [
      { id: 'ex1', thread_id: 't1', occasion_id: '2026-01-01', sent_at: new Date('2026-01-01') },
      { id: 'ex2', thread_id: 't2', occasion_id: '2026-01-02', sent_at: new Date('2026-01-02') }
    ];
    const evidenceRows = [
      { id: 'de1', exchange_id: 'ex1', direction: 'high', strength: 'strong', type: 'explicit_statement' }, // score 100, weight 1.0*1.0
      { id: 'de2', exchange_id: 'ex2', direction: 'low', strength: 'moderate', type: 'behavioral_report' } // score 0, weight 0.8*0.6
    ];
    mockEvidenceLoad(threads, exchanges, evidenceRows);
    mockClassify.mockReturnValueOnce(null); // only 2 points — real classifier would say null too
    builder.first.mockResolvedValueOnce(undefined);
    builder.returning.mockResolvedValueOnce([{}]);

    await service.recomputeDimension('user-1', 'work_style');

    // (0.6*50 + 100*1.0 + 0*0.48) / (0.6 + 1.0 + 0.48) = 130 / 2.08 = 62.5 → rounds to 63.
    // richness at 2 evidence / 2 questions / 2 occasions = 0.415 → 'low' → band 'suppressed'.
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ score: 63, confidence: 'low', band: 'suppressed', distinct_occasions: 2 })
    );
  });

  it('demotes confidence one level and writes a variance_flag row for an ambiguous classification', async () => {
    const threads = [
      { id: 't1', question_id: 'Q1' },
      { id: 't2', question_id: 'Q2' },
      { id: 't3', question_id: 'Q3' }
    ];
    const exchanges = threads.map((t, i) => ({
      id: `ex${i}`,
      thread_id: t.id,
      occasion_id: `2026-01-0${i + 1}`,
      sent_at: new Date(2026, 0, i + 1)
    }));
    const evidenceRows = exchanges.map((e, i) => ({
      id: `de${i}`,
      exchange_id: e.id,
      direction: i % 2 === 0 ? 'high' : 'low',
      strength: 'strong',
      type: 'explicit_statement'
    }));
    mockEvidenceLoad(threads, exchanges, evidenceRows);
    mockClassify.mockReturnValueOnce({
      flagType: 'ambiguous',
      magnitude: 40.4,
      contributingEvidenceIds: ['de0', 'de1', 'de2'],
      topicSpread: ['Q1', 'Q2', 'Q3'],
      occasionSpread: ['2026-01-01', '2026-01-02', '2026-01-03'],
      reasoning: { read: 'ambiguous' }
    });
    builder.first.mockResolvedValueOnce(undefined);
    builder.returning.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]);

    await service.recomputeDimension('user-1', 'work_style');

    const tableCalls = mockDb.mock.calls.map((c) => c[0]);
    expect(tableCalls).toContain('variance_flag');
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ flag_type: 'ambiguous', magnitude: 40.4 }));
    // 3 evidence / 3 questions / 3 occasions would normally land at 'medium' richness — demoted
    // one level to 'low' (band 'suppressed') because the variance read is ambiguous (spec §9.9).
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'low', band: 'suppressed' }));
  });

  it('does not write a variance_flag row, and does not demote confidence, for topic_linked or occasion_linked', async () => {
    const threads = [
      { id: 't1', question_id: 'Q1' },
      { id: 't2', question_id: 'Q2' },
      { id: 't3', question_id: 'Q3' }
    ];
    const exchanges = threads.map((t, i) => ({
      id: `ex${i}`,
      thread_id: t.id,
      occasion_id: `2026-01-0${i + 1}`,
      sent_at: new Date(2026, 0, i + 1)
    }));
    const evidenceRows = exchanges.map((e, i) => ({
      id: `de${i}`,
      exchange_id: e.id,
      direction: 'high',
      strength: 'strong',
      type: 'explicit_statement'
    }));
    mockEvidenceLoad(threads, exchanges, evidenceRows);
    mockClassify.mockReturnValueOnce({
      flagType: 'topic_linked',
      magnitude: 30,
      contributingEvidenceIds: [],
      topicSpread: [],
      occasionSpread: [],
      reasoning: {}
    });
    builder.first.mockResolvedValueOnce(undefined);
    builder.returning.mockResolvedValueOnce([{}]);

    await service.recomputeDimension('user-1', 'work_style');

    const tableCalls = mockDb.mock.calls.map((c) => c[0]);
    expect(tableCalls).not.toContain('variance_flag');
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'medium' }));
  });

  it('increments dimension_score.version from the prior max rather than overwriting', async () => {
    const threads = [
      { id: 't1', question_id: 'Q1' },
      { id: 't2', question_id: 'Q2' }
    ];
    const exchanges = threads.map((t, i) => ({
      id: `ex${i}`,
      thread_id: t.id,
      occasion_id: `2026-01-0${i + 1}`,
      sent_at: new Date(2026, 0, i + 1)
    }));
    const evidenceRows = exchanges.map((e, i) => ({
      id: `de${i}`,
      exchange_id: e.id,
      direction: 'high',
      strength: 'strong',
      type: 'explicit_statement'
    }));
    mockEvidenceLoad(threads, exchanges, evidenceRows);
    mockClassify.mockReturnValueOnce(null);
    builder.first.mockResolvedValueOnce({ v: 3 });
    builder.returning.mockResolvedValueOnce([{ version: 4 }]);

    await service.recomputeDimension('user-1', 'work_style');

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ version: 4 }));
  });
});
