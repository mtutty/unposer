import { SandboxService } from './sandbox.service';
import { SandboxMessage } from '../types';

jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.limit = jest.fn();
  return builder;
}

function messageFixture(overrides: Partial<SandboxMessage> = {}): SandboxMessage {
  return {
    id: 'msg-1',
    user_id: 'user-1',
    role: 'user',
    content: 'hello',
    citations: null,
    flagged_gap: false,
    gap_note: null,
    created_at: new Date(),
    ...overrides
  } as SandboxMessage;
}

describe('SandboxService.getRecentHistory', () => {
  let service: SandboxService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    service = new SandboxService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('queries most-recent-first with the given limit, then returns chronological order', async () => {
    const rows = [messageFixture({ id: '3' }), messageFixture({ id: '2' }), messageFixture({ id: '1' })];
    builder.limit.mockResolvedValue(rows);

    const result = await service.getRecentHistory('user-1', 20);

    expect(mockDb).toHaveBeenCalledWith('sandbox_messages');
    expect(builder.where).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(builder.orderBy).toHaveBeenCalledWith('created_at', 'desc');
    expect(builder.limit).toHaveBeenCalledWith(20);
    expect(result.map((m) => m.id)).toEqual(['1', '2', '3']);
  });
});
