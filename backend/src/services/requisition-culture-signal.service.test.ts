jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('../ai/requisition-culture-signal.chain', () => ({ inferRequisitionCultureSignals: jest.fn() }));
import { inferRequisitionCultureSignals } from '../ai/requisition-culture-signal.chain';

import { RequisitionCultureSignalService } from './requisition-culture-signal.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.select = jest.fn();
  builder.delete = jest.fn();
  builder.insert = jest.fn(() => builder);
  builder.returning = jest.fn();
  return builder;
}

describe('RequisitionCultureSignalService.regenerate', () => {
  let service: RequisitionCultureSignalService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockInfer = inferRequisitionCultureSignals as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RequisitionCultureSignalService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('passes every user-role (employer) message in the thread to the chain', async () => {
    builder.select.mockResolvedValueOnce([
      { id: 'msg-1', content: 'We reward shipping fast.' },
      { id: 'msg-2', content: 'Decisions happen in the room, not by committee.' }
    ]);
    mockInfer.mockResolvedValueOnce([]);
    builder.delete.mockResolvedValueOnce(undefined);

    await service.regenerate('req-1');

    expect(builder.where).toHaveBeenCalledWith({ requisition_id: 'req-1', role: 'user' });
    expect(mockInfer).toHaveBeenCalledWith([
      { messageId: 'msg-1', text: 'We reward shipping fast.' },
      { messageId: 'msg-2', text: 'Decisions happen in the room, not by committee.' }
    ]);
  });

  it('skips the chain call entirely (and still clears prior signals) when there are no messages yet', async () => {
    builder.select.mockResolvedValueOnce([]);
    builder.delete.mockResolvedValueOnce(undefined);

    const result = await service.regenerate('req-1');

    expect(mockInfer).not.toHaveBeenCalled();
    expect(builder.delete).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('wholesale-replaces prior signals with the freshly inferred ones', async () => {
    builder.select.mockResolvedValueOnce([{ id: 'msg-1', content: 'We ship fast and iterate.' }]);
    mockInfer.mockResolvedValueOnce([{ quadrant: 'adhocracy', reasoning: 'r', sourceMessageIds: ['msg-1'] }]);
    builder.delete.mockResolvedValueOnce(undefined);
    builder.returning.mockResolvedValueOnce([{ id: 'rcs-1', cvf_quadrant: 'adhocracy' }]);

    const result = await service.regenerate('req-1');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ requisition_id: 'req-1', cvf_quadrant: 'adhocracy', source_message_ids: JSON.stringify(['msg-1']) })
    ]);
    expect(result).toEqual([{ id: 'rcs-1', cvf_quadrant: 'adhocracy' }]);
  });
});
