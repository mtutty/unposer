jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('./conversation.service');
import { ConversationService } from './conversation.service';

jest.mock('./email.service');
import { EmailService } from './email.service';

import { InboxService, threadNeedsNudge } from './inbox.service';
import { ConversationThread } from '../types';
import { config } from '../config';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.first = jest.fn();
  builder.update = jest.fn().mockResolvedValue(undefined);
  builder.insert = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.returning = jest.fn();
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

describe('threadNeedsNudge', () => {
  it('is true for an email, awaiting_reply thread silent past the threshold with no later nudge', () => {
    expect(threadNeedsNudge(threadFixture())).toBe(true);
  });

  it('is false for an app-channel thread', () => {
    expect(threadNeedsNudge(threadFixture({ channel: 'app' }))).toBe(false);
  });

  it('is false when status is not awaiting_reply', () => {
    expect(threadNeedsNudge(threadFixture({ status: 'active' }))).toBe(false);
  });

  it('is false when no message has been sent yet', () => {
    expect(threadNeedsNudge(threadFixture({ last_message_at: null }))).toBe(false);
  });

  it('is false when the silence threshold has not been reached yet', () => {
    expect(threadNeedsNudge(threadFixture({ last_message_at: new Date(Date.now() - 1 * 60 * 60 * 1000) }))).toBe(false);
  });

  it('is false when already nudged more recently than the last message (no re-nudge spam)', () => {
    const lastMessageAt = new Date(Date.now() - (config.flow.emailSilenceHours + 5) * 60 * 60 * 1000);
    const lastNudgeAt = new Date(Date.now() - 1 * 60 * 60 * 1000); // nudged after that message
    expect(threadNeedsNudge(threadFixture({ last_message_at: lastMessageAt, last_nudge_at: lastNudgeAt }))).toBe(false);
  });

  it('is true when the last nudge predates the last message (candidate replied, then went silent again)', () => {
    const lastNudgeAt = new Date(Date.now() - (config.flow.emailSilenceHours + 10) * 60 * 60 * 1000);
    const lastMessageAt = new Date(Date.now() - (config.flow.emailSilenceHours + 1) * 60 * 60 * 1000); // after the old nudge
    expect(threadNeedsNudge(threadFixture({ last_message_at: lastMessageAt, last_nudge_at: lastNudgeAt }))).toBe(true);
  });
});

describe('InboxService.getInbox', () => {
  let service: InboxService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockGetHistory = ConversationService.prototype.getHistory as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InboxService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('returns an empty/no-thread view when there is no thread or it is not email-channel', async () => {
    builder.first.mockResolvedValueOnce(undefined);
    expect(await service.getInbox('user-1')).toEqual({ thread: null, messages: [], needsNudge: false, hoursSinceLastMessage: null });

    builder.first.mockResolvedValueOnce(threadFixture({ channel: 'app' }));
    expect(await service.getInbox('user-1')).toEqual({ thread: null, messages: [], needsNudge: false, hoursSinceLastMessage: null });
  });

  it('reports needsNudge consistently with threadNeedsNudge for a stalled thread', async () => {
    const thread = threadFixture();
    builder.first.mockResolvedValueOnce(thread);
    mockGetHistory.mockResolvedValueOnce([]);

    const view = await service.getInbox('user-1');

    expect(view.needsNudge).toBe(true);
    expect(view.hoursSinceLastMessage).toBeGreaterThanOrEqual(config.flow.emailSilenceHours);
  });
});

describe('InboxService.sendNudge', () => {
  let service: InboxService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockDeliver = EmailService.prototype.deliver as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InboxService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('composes a nudge quoting the last assistant question, persists it, stamps last_nudge_at, and really emails it', async () => {
    const thread = threadFixture();
    builder.first
      .mockResolvedValueOnce(thread) // conversation_threads lookup
      .mockResolvedValueOnce({ content: 'What are your target roles?' }); // last assistant message
    builder.returning.mockResolvedValueOnce([{ id: 'msg-1', content: expect.any(String) }]);

    await service.sendNudge('user-1');

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('What are your target roles?'), metadata: { nudge: true } })
    );
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ last_nudge_at: expect.any(Date) }));
    expect(mockDeliver).toHaveBeenCalledWith(thread, expect.anything());
  });

  it('throws NOT_FOUND when there is no email thread for this user', async () => {
    builder.first.mockResolvedValueOnce(undefined);

    await expect(service.sendNudge('user-1')).rejects.toThrow('No email thread found');
  });
});
