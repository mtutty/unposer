jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

const mockSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } }))
}));

jest.mock('fs');
import fs from 'fs';

const mockConfig = {
  email: {
    resendApiKey: 'test-key',
    webhookSecret: 'test-secret',
    inboundDomain: 'reply.example.com',
    fromAddress: 'Unposer <onboarding@example.com>',
    enabled: true,
    spoolDir: '/tmp/email-outbox-test'
  }
};
jest.mock('../config', () => ({ config: mockConfig }));

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

describe('EmailService — spooling instead of sending (config.email.enabled === false)', () => {
  let service: EmailService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockMkdir = fs.mkdirSync as jest.Mock;
  const mockWrite = fs.writeFileSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.email.enabled = false;
    service = new EmailService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    builder.first.mockResolvedValue({ id: 'user-1', email: 'candidate@example.com' });
  });

  afterEach(() => {
    mockConfig.email.enabled = true;
  });

  it('deliverForTopic writes the full message to a file under spoolDir instead of calling Resend', async () => {
    await service.deliverForTopic(topicThreadFixture({ question_id: 'Q1' }), 'Tell me more about that.');

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMkdir).toHaveBeenCalledWith('/tmp/email-outbox-test', { recursive: true });

    const [filePath, content] = mockWrite.mock.calls[0];
    expect(filePath).toContain('/tmp/email-outbox-test/');
    expect(filePath).toContain('candidate@example.com');
    expect(content).toContain('To: candidate@example.com');
    expect(content).toContain('Reply-To: reply+tok-123@reply.example.com');
    expect(content).toContain('Subject: The Unofficial Curriculum — Unposer');
    expect(content).toContain('Tell me more about that.');
  });

  it('sendInvite writes the full invite body to a file instead of calling Resend', async () => {
    await service.sendInvite('someone@example.com', 'Come check this out.');

    expect(mockSend).not.toHaveBeenCalled();
    const [filePath, content] = mockWrite.mock.calls[0];
    expect(filePath).toContain('someone@example.com');
    expect(content).toContain('To: someone@example.com');
    expect(content).toContain("Subject: You're invited to Unposer");
    expect(content).toContain('Come check this out.');
  });

  it('does not throw if the spool directory cannot be created', async () => {
    mockMkdir.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });

    await expect(service.deliverForTopic(topicThreadFixture(), 'body')).resolves.toBeUndefined();
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
