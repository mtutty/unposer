import { TopicSelectionService } from './topic-selection.service';
import { questionLibrary } from '../models/question-library';

jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.whereIn = jest.fn(() => builder);
  builder.select = jest.fn();
  return builder;
}

const ALL_DIMENSIONS = [
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

describe('TopicSelectionService.selectNextQuestion', () => {
  let service: TopicSelectionService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    service = new TopicSelectionService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('asks Q0 first when nothing has been asked yet', async () => {
    builder.select.mockResolvedValueOnce([]); // topic_thread: none asked

    const result = await service.selectNextQuestion('user-1');

    expect(result.id).toBe('Q0');
    expect(mockDb).toHaveBeenCalledTimes(1); // core-set gap found — no coverage query needed
  });

  it('asks the next missing core-set question in order (Q0, Q23, Q24, Q25)', async () => {
    builder.select.mockResolvedValueOnce([{ id: 't1', question_id: 'Q0', opened_at: new Date('2026-01-01') }]);

    const result = await service.selectNextQuestion('user-1');

    expect(result.id).toBe('Q23');
  });

  it('once the core set is asked, picks by lowest-coverage dimension and never queues heavy after heavy', async () => {
    // Core set + Q5 (heavy), Q5 opened most recently (desc order → first element).
    const askedThreads = [
      { id: 't-q5', question_id: 'Q5', opened_at: new Date('2026-01-05') },
      { id: 't-q25', question_id: 'Q25', opened_at: new Date('2026-01-04') },
      { id: 't-q24', question_id: 'Q24', opened_at: new Date('2026-01-03') },
      { id: 't-q23', question_id: 'Q23', opened_at: new Date('2026-01-02') },
      { id: 't-q0', question_id: 'Q0', opened_at: new Date('2026-01-01') }
    ];
    const exchanges = askedThreads.map((t, i) => ({
      id: `ex-${i}`,
      thread_id: t.id,
      occasion_id: '2026-01-01',
      sent_at: new Date('2026-01-01')
    }));
    // Every dimension except emotional_stability and work_style gets evidence — those two stay at
    // zero, making them the tied lowest-coverage pair that drives selection.
    const coveredDims = ALL_DIMENSIONS.filter((d) => d !== 'emotional_stability' && d !== 'work_style');
    const evidenceRows = coveredDims.map((dimension, i) => ({ dimension, exchange_id: exchanges[i % exchanges.length].id }));

    builder.select
      .mockResolvedValueOnce(askedThreads) // topic_thread
      .mockResolvedValueOnce(exchanges) // exchange
      .mockResolvedValueOnce(evidenceRows); // dimension_evidence

    const result = await service.selectNextQuestion('user-1');

    // P-candidates on {emotional_stability, work_style} among unasked questions: Q3, Q4, Q6, Q8,
    // Q19, Q20 (library order). Q5 (heavy) was just asked, so heavy candidates (Q6/Q19/Q20) are
    // filtered out in favor of light ones (Q3, Q4, Q8) — Q3 comes first in library order and all
    // three tie on staleness (their ES/work_style dimension was never sampled).
    expect(result.id).toBe('Q3');
    expect(result.heavy).toBe(false);
  });

  it('falls back to the full library rather than dead-ending once every question has been asked', async () => {
    const askedThreads = questionLibrary.map((q, i) => ({
      id: `t-${i}`,
      question_id: q.id,
      opened_at: new Date(2026, 0, i + 1)
    }));

    builder.select
      .mockResolvedValueOnce(askedThreads) // topic_thread
      .mockResolvedValueOnce([]) // exchange
      .mockResolvedValueOnce([]); // dimension_evidence

    const result = await service.selectNextQuestion('user-1');

    expect(questionLibrary.map((q) => q.id)).toContain(result.id);
  });
});
