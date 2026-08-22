jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('../ai/culture-signal.chain', () => ({ inferCultureSignals: jest.fn() }));
import { inferCultureSignals } from '../ai/culture-signal.chain';

import { CultureSignalService } from './culture-signal.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.whereIn = jest.fn(() => builder);
  builder.select = jest.fn();
  builder.delete = jest.fn();
  builder.insert = jest.fn(() => builder);
  builder.returning = jest.fn();
  return builder;
}

describe('CultureSignalService.regenerate', () => {
  let service: CultureSignalService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockInfer = inferCultureSignals as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CultureSignalService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('passes only user-role exchanges from Q0/Q15/Q21 threads to the chain', async () => {
    builder.select
      .mockResolvedValueOnce([
        { id: 't1', question_id: 'Q0' },
        { id: 't2', question_id: 'Q15' }
      ])
      .mockResolvedValueOnce([
        { id: 'ex-1', thread_id: 't1', text: 'Q0 answer' },
        { id: 'ex-2', thread_id: 't2', text: 'Q15 answer' }
      ]);
    mockInfer.mockResolvedValueOnce([]);
    builder.delete.mockResolvedValueOnce(undefined);

    await service.regenerate('user-1');

    expect(builder.whereIn).toHaveBeenCalledWith('question_id', ['Q0', 'Q15', 'Q21']);
    expect(mockInfer).toHaveBeenCalledWith([
      { exchangeId: 'ex-1', questionId: 'Q0', text: 'Q0 answer' },
      { exchangeId: 'ex-2', questionId: 'Q15', text: 'Q15 answer' }
    ]);
  });

  it('skips the chain call entirely (and still clears prior signals) when none of Q0/Q15/Q21 has been asked yet', async () => {
    builder.select.mockResolvedValueOnce([]);
    builder.delete.mockResolvedValueOnce(undefined);

    const result = await service.regenerate('user-1');

    expect(mockInfer).not.toHaveBeenCalled();
    expect(builder.delete).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('wholesale-replaces prior signals with the freshly inferred ones', async () => {
    builder.select.mockResolvedValueOnce([{ id: 't1', question_id: 'Q0' }]).mockResolvedValueOnce([{ id: 'ex-1', thread_id: 't1', text: 't' }]);
    mockInfer.mockResolvedValueOnce([{ quadrant: 'clan', reasoning: 'r', sourceExchangeIds: ['ex-1'] }]);
    builder.delete.mockResolvedValueOnce(undefined);
    builder.returning.mockResolvedValueOnce([{ id: 'cs-1', cvf_quadrant: 'clan' }]);

    const result = await service.regenerate('user-1');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: 'user-1', cvf_quadrant: 'clan', source_evidence_ids: JSON.stringify(['ex-1']) })
    ]);
    expect(result).toEqual([{ id: 'cs-1', cvf_quadrant: 'clan' }]);
  });
});
