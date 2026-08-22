import { DimensionScoringService } from './dimension-scoring.service';

jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('../ai/dimension-scoring.chain', () => ({ scoreDimension: jest.fn() }));
import { scoreDimension } from '../ai/dimension-scoring.chain';

function makeBuilder() {
  const builder: any = {};
  builder.insert = jest.fn(() => builder);
  builder.returning = jest.fn();
  return builder;
}

describe('DimensionScoringService.extractAndPersist', () => {
  let service: DimensionScoringService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockScoreDimension = scoreDimension as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DimensionScoringService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('calls scoreDimension once per requested dimension and inserts each one\'s evidence', async () => {
    mockScoreDimension
      .mockResolvedValueOnce({
        dimension: 'work_style',
        evidence: [
          { span: 'a', direction: 'low', strength: 'strong', type: 'explicit_statement', facet: 'independence', note: 'n' }
        ],
        provisionalScore: 20,
        confidence: 'medium',
        reasoning: 'r'
      })
      .mockResolvedValueOnce({
        dimension: 'social_energy',
        evidence: [],
        provisionalScore: null,
        confidence: 'insufficient_signal',
        reasoning: 'r'
      });
    builder.returning.mockResolvedValueOnce([{ id: 'ev-1', dimension: 'work_style' }]);

    const result = await service.extractAndPersist('exchange-1', 'Q?', 'A.', ['work_style', 'social_energy']);

    expect(mockScoreDimension).toHaveBeenCalledTimes(2);
    expect(mockScoreDimension).toHaveBeenNthCalledWith(1, { dimension: 'work_style', questionText: 'Q?', answerText: 'A.' });
    expect(mockScoreDimension).toHaveBeenNthCalledWith(2, { dimension: 'social_energy', questionText: 'Q?', answerText: 'A.' });

    // Only work_style produced evidence — social_energy's empty result must not hit the DB.
    expect(mockDb).toHaveBeenCalledTimes(1);
    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ exchange_id: 'exchange-1', dimension: 'work_style', span: 'a' })
    ]);
    expect(result).toEqual([{ id: 'ev-1', dimension: 'work_style' }]);
  });

  it('returns an empty array and never touches the DB when no dimension produces evidence', async () => {
    mockScoreDimension.mockResolvedValue({
      dimension: 'openness',
      evidence: [],
      provisionalScore: null,
      confidence: 'insufficient_signal',
      reasoning: 'r'
    });

    const result = await service.extractAndPersist('exchange-1', 'Q?', 'A.', ['openness']);

    expect(result).toEqual([]);
    expect(mockDb).not.toHaveBeenCalled();
  });
});
