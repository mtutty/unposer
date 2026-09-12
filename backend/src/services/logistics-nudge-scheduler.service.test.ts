jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('./inbox.service', () => {
  const actual = jest.requireActual('./inbox.service');
  return { ...actual, InboxService: jest.fn() };
});
import { InboxService } from './inbox.service';

import { LogisticsNudgeSchedulerService } from './logistics-nudge-scheduler.service';
import { ConversationThread } from '../types';
import { config } from '../config';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.select = jest.fn();
  return builder;
}

function threadFixture(overrides: Partial<ConversationThread> = {}): ConversationThread {
  return {
    id: 'thread-1',
    user_id: 'user-1',
    step: 'logistics',
    channel: 'email',
    status: 'awaiting_reply',
    message_count: 2,
    thread_cap: 40,
    last_message_at: new Date(Date.now() - (config.flow.emailSilenceHours + 1) * 60 * 60 * 1000),
    last_nudge_at: null,
    inbound_token: 'tok',
    last_inbound_message_id: null,
    last_outbound_message_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

describe('LogisticsNudgeSchedulerService.runCheck', () => {
  let service: LogisticsNudgeSchedulerService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  let mockSendNudge: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendNudge = jest.fn().mockResolvedValue({});
    (InboxService as jest.Mock).mockImplementation(() => ({ sendNudge: mockSendNudge }));
    service = new LogisticsNudgeSchedulerService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('queries only awaiting_reply email logistics threads, then nudges the ones actually due', async () => {
    const due = threadFixture({ user_id: 'user-due' });
    const notYetSilentEnough = threadFixture({ user_id: 'user-fresh', last_message_at: new Date() });
    builder.select.mockResolvedValueOnce([due, notYetSilentEnough]);

    const result = await service.runCheck();

    expect(mockDb).toHaveBeenCalledWith('conversation_threads');
    expect(builder.where).toHaveBeenCalledWith({ step: 'logistics', channel: 'email', status: 'awaiting_reply' });
    expect(mockSendNudge).toHaveBeenCalledTimes(1);
    expect(mockSendNudge).toHaveBeenCalledWith('user-due');
    expect(result).toEqual({ processed: 1, nudged: 1 });
  });

  it('is a no-op when nothing is due', async () => {
    builder.select.mockResolvedValueOnce([threadFixture({ last_message_at: new Date() })]);

    const result = await service.runCheck();

    expect(mockSendNudge).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, nudged: 0 });
  });

  it('keeps processing the rest of the batch when one nudge send fails', async () => {
    const first = threadFixture({ user_id: 'user-1' });
    const second = threadFixture({ user_id: 'user-2' });
    builder.select.mockResolvedValueOnce([first, second]);
    mockSendNudge.mockRejectedValueOnce(new Error('email provider down')).mockResolvedValueOnce({});

    const result = await service.runCheck();

    expect(mockSendNudge).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ processed: 2, nudged: 1 });
  });
});
