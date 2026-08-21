import { ConversationService } from './conversation.service';
import { Message } from '../types';

jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.limit = jest.fn();
  return builder;
}

function messageFixture(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    thread_id: 'thread-1',
    user_id: 'user-1',
    role: 'user',
    content: 'hello',
    channel: 'app',
    step: 'deep_prompts',
    metadata: {},
    created_at: new Date(),
    ...overrides
  };
}

describe('ConversationService.getRecentHistory', () => {
  let service: ConversationService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    service = new ConversationService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('queries most-recent-first with the given limit, then returns chronological order', async () => {
    // desc order as stored in the DB — the newest message first.
    const rows = [messageFixture({ id: '3' }), messageFixture({ id: '2' }), messageFixture({ id: '1' })];
    builder.limit.mockResolvedValue(rows);

    const result = await service.getRecentHistory('user-1', 'deep_prompts', 20);

    expect(mockDb).toHaveBeenCalledWith('messages');
    expect(builder.where).toHaveBeenCalledWith({ user_id: 'user-1', step: 'deep_prompts' });
    expect(builder.orderBy).toHaveBeenCalledWith('created_at', 'desc');
    expect(builder.limit).toHaveBeenCalledWith(20);
    // Reversed back to ascending (chronological) order for the caller.
    expect(result.map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('returns an empty array when there is no history yet', async () => {
    builder.limit.mockResolvedValue([]);

    const result = await service.getRecentHistory('user-1', 'logistics', 20);

    expect(result).toEqual([]);
  });
});
