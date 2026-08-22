jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

const mockSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } }))
}));

jest.mock('../config', () => ({
  config: {
    email: {
      resendApiKey: 'test-key',
      webhookSecret: 'test-secret',
      inboundDomain: 'reply.example.com',
      fromAddress: 'Unposer <onboarding@example.com>',
      enabled: true
    }
  }
}));

import { EmailService } from './email.service';
import { TopicThread } from '../types';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.update = jest.fn();
  builder.first = jest.fn();
  return builder;
}

function topicThreadFixture(overrides: Partial<TopicThread> = {}): TopicThread {
  return {
    id: 'thread-1',
    user_id: 'user-1',
    question_id: 'Q1',
    opened_at: new Date(),
    closed_at: null,
    closed_by: null,
    status: 'open',
    ad_hoc_dimensions: null,
    inbound_token: 'tok-123',
    last_inbound_message_id: null,
    last_outbound_message_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

describe('EmailService.deliverForTopic', () => {
  let service: EmailService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmailService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    builder.first.mockResolvedValue({ id: 'user-1', email: 'candidate@example.com' });
    mockSend.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
  });

  it('subjects the email with the library question\'s short name, addressed via the topic\'s own inbound_token', async () => {
    await service.deliverForTopic(topicThreadFixture({ question_id: 'Q1' }), 'Tell me more about that.');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'candidate@example.com',
        replyTo: 'reply+tok-123@reply.example.com',
        subject: 'The Unofficial Curriculum — Unposer',
        text: 'Tell me more about that.'
      })
    );
  });

  it('falls back to "Your Stories" for an ad hoc (non-library) thread', async () => {
    await service.deliverForTopic(topicThreadFixture({ question_id: 'reask-abc' }), 'Say more.');

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Your Stories — Unposer' }));
  });

  it('threads with In-Reply-To/References when the topic has a prior inbound message', async () => {
    await service.deliverForTopic(topicThreadFixture({ last_inbound_message_id: 'msg-prev' }), 'Reply body.');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Re: '),
        headers: { 'In-Reply-To': 'msg-prev', References: 'msg-prev' }
      })
    );
  });

  it('updates topic_thread.last_outbound_message_id (not conversation_threads) on success', async () => {
    await service.deliverForTopic(topicThreadFixture(), 'body');

    expect(mockDb).toHaveBeenCalledWith('topic_thread');
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ last_outbound_message_id: 'resend-msg-1' }));
  });

  it('does not throw and does not attempt a send when the addressed user cannot be found', async () => {
    builder.first.mockResolvedValueOnce(undefined);

    await expect(service.deliverForTopic(topicThreadFixture(), 'body')).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
