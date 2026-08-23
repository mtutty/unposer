// webhooks.routes.ts pulls in db/connection.ts at import time (directly, and transitively via
// every *.service.ts it imports) — stub it before anything else, same pattern as
// email.service.test.ts / auth.routes.test.ts.
jest.mock('../db/connection', () => ({ db: jest.fn() }));

const mockConfig: any = {
  nodeEnv: 'test',
  email: {
    resendApiKey: 'test-resend-key',
    webhookSecret: 'test-webhook-secret',
    inboundDomain: 'reply.example.com',
    fromAddress: 'Unposer <onboarding@example.com>',
    enabled: true
  }
};
jest.mock('../config', () => ({ config: mockConfig }));

const mockVerify = jest.fn();
jest.mock('svix', () => ({
  Webhook: jest.fn().mockImplementation(() => ({ verify: mockVerify }))
}));

const mockReceivingGet = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { receiving: { get: mockReceivingGet } } }))
}));

jest.mock('../services/conversation.service');
jest.mock('../services/topic-conversation.service');
jest.mock('../services/email.service');
jest.mock('../services/flow.service');

import express from 'express';
import request from 'supertest';
import { db } from '../db/connection';
import { ConversationService } from '../services/conversation.service';
import { TopicConversationService } from '../services/topic-conversation.service';
import { EmailService } from '../services/email.service';
import { FlowService } from '../services/flow.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import webhookRoutes from './webhooks.routes';

const mockConversationService = (ConversationService as jest.MockedClass<typeof ConversationService>).mock
  .instances[0] as jest.Mocked<ConversationService>;
const mockTopicConversation = (TopicConversationService as jest.MockedClass<typeof TopicConversationService>).mock
  .instances[0] as jest.Mocked<TopicConversationService>;
const mockEmailService = (EmailService as jest.MockedClass<typeof EmailService>).mock.instances[0] as jest.Mocked<EmailService>;
const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;

const dbMock = db as unknown as jest.Mock;

const TOKEN = '11111111-1111-1111-1111-111111111111';

function makeBuilder(resolvedValue: any = undefined) {
  const builder: any = {};
  for (const m of ['where', 'insert', 'onConflict', 'ignore', 'update', 'delete']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.first = jest.fn(() => Promise.resolve(resolvedValue));
  builder.returning = jest.fn(() => Promise.resolve(resolvedValue));
  // Lets `await db(...).where().update(...)` resolve without an explicit terminal call.
  builder.then = (resolve: any, reject: any) => Promise.resolve(resolvedValue).then(resolve, reject);
  return builder;
}

let processedBuilder: any;
let conversationThreadsBuilder: any;
let topicThreadBuilder: any;

function wireDb() {
  dbMock.mockImplementation((table: string) => {
    if (table === 'processed_webhook_events') return processedBuilder;
    if (table === 'conversation_threads') return conversationThreadsBuilder;
    if (table === 'topic_thread') return topicThreadBuilder;
    throw new Error(`unexpected table in test: ${table}`);
  });
}

function buildApp() {
  const app = express();
  app.use('/', webhookRoutes);
  app.use(errorHandler);
  return app;
}

function emailReceivedEvent(overrides: Partial<Record<string, any>> = {}) {
  return {
    type: 'email.received',
    data: {
      email_id: 'email-1',
      from: 'candidate@gmail.com',
      to: [`reply+${TOKEN}@reply.example.com`],
      message_id: 'msg-1',
      subject: 'Re: your question',
      text: 'Here is my answer.',
      ...overrides
    }
  };
}

describe('webhooks.routes POST /inbound-email', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.nodeEnv = 'test';
    mockConfig.email.enabled = true;
    processedBuilder = makeBuilder(['claim-id']); // dedupe insert succeeded — not a duplicate
    conversationThreadsBuilder = makeBuilder(undefined);
    topicThreadBuilder = makeBuilder(undefined);
    wireDb();
    app = buildApp();
  });

  it('no-ops with 200 when the email gateway is not configured, without touching svix', async () => {
    mockConfig.email.enabled = false;

    const res = await request(app).post('/inbound-email').send({ any: 'payload' });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatch(/not configured/);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('400s with INVALID_SIGNATURE when svix verification throws', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('bad signature');
    });

    const res = await request(app)
      .post('/inbound-email')
      .set('svix-id', 'id-1')
      .set('svix-timestamp', '123')
      .set('svix-signature', 'v1,bogus')
      .send(emailReceivedEvent());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('200s and skips non-email.received event types without touching the db', async () => {
    mockVerify.mockReturnValue({ type: 'email.bounced', data: {} });

    const res = await request(app).post('/inbound-email').send({ x: 1 });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatch(/ignored event type/);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('200s as a duplicate when the dedupe insert finds an existing event id, without calling any service', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent());
    processedBuilder = makeBuilder([]); // onConflict().ignore() -> nothing returned -> already claimed
    wireDb();

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(mockConversationService.postUserMessage).not.toHaveBeenCalled();
  });

  it('200s and skips when no recipient address carries a recognized thread token', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent({ to: ['someone-else@unrelated.com'] }));

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatch(/no matching thread token/);
  });

  it('200s and skips when the token matches neither a conversation_threads nor a topic_thread row', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent());
    // both builders already resolve to `undefined` from beforeEach

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatch(/no thread for token/);
  });

  it('200s and skips when the body is empty after stripping the quoted reply', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent({ text: '' }));
    conversationThreadsBuilder = makeBuilder({ id: 'thread-1', user_id: 'user-1', step: 'logistics' });
    wireDb();

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatch(/empty body/);
    expect(mockConversationService.postUserMessage).not.toHaveBeenCalled();
  });

  it('routes a matched conversation_threads (Step 3) reply through ConversationService and re-delivers by email', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent());
    const thread = { id: 'thread-1', user_id: 'user-1', step: 'logistics' };
    conversationThreadsBuilder = makeBuilder(thread);
    wireDb();
    mockConversationService.postUserMessage.mockResolvedValue({
      assistantMessage: { content: 'Thanks, got it.' } as any,
      complete: false,
      thread: { ...thread, id: 'thread-1' } as any
    });

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(mockConversationService.postUserMessage).toHaveBeenCalledWith('user-1', 'logistics', 'email', 'Here is my answer.');
    expect(mockFlowService.completeStep).not.toHaveBeenCalled();
    expect(mockEmailService.deliver).toHaveBeenCalledTimes(1);
  });

  it('completes the flow step when ConversationService reports the turn as complete', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent());
    const thread = { id: 'thread-1', user_id: 'user-1', step: 'logistics' };
    conversationThreadsBuilder = makeBuilder(thread);
    wireDb();
    mockConversationService.postUserMessage.mockResolvedValue({
      assistantMessage: { content: 'All set.' } as any,
      complete: true,
      thread: thread as any
    });

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(mockFlowService.completeStep).toHaveBeenCalledWith('user-1', 'logistics');
  });

  it('routes a matched topic_thread (Step 5 deep_prompts) reply through TopicConversationService', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent());
    const topicThread = { id: 'topic-1', user_id: 'user-2', question_id: 'Q1' };
    topicThreadBuilder = makeBuilder(topicThread);
    wireDb();
    mockTopicConversation.postUserMessage.mockResolvedValue({
      assistantMessage: { content: 'Great story, tell me more.' } as any,
      complete: false
    });

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(mockTopicConversation.postUserMessage).toHaveBeenCalledWith('user-2', 'email', 'Here is my answer.');
    expect(mockEmailService.deliverForTopic).toHaveBeenCalledTimes(1);
    expect(mockFlowService.completeStep).not.toHaveBeenCalled();
  });

  it('returns 200 (no retry) and does not release the dedupe claim when the service rejects with an AppError', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent());
    const thread = { id: 'thread-1', user_id: 'user-1', step: 'profile_review' };
    conversationThreadsBuilder = makeBuilder(thread);
    wireDb();
    mockConversationService.postUserMessage.mockRejectedValue(
      new AppError('CHANNEL_NOT_SUPPORTED', "this step doesn't support the email channel", 400)
    );

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatch(/email channel/);
    expect(processedBuilder.delete).not.toHaveBeenCalled();
  });

  it('releases the dedupe claim and 500s (so Resend retries) on an unexpected error', async () => {
    mockVerify.mockReturnValue(emailReceivedEvent());
    const thread = { id: 'thread-1', user_id: 'user-1', step: 'logistics' };
    conversationThreadsBuilder = makeBuilder(thread);
    wireDb();
    mockConversationService.postUserMessage.mockRejectedValue(new Error('db exploded'));

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(processedBuilder.where).toHaveBeenCalledWith({ source: 'resend', external_id: 'email-1' });
    expect(processedBuilder.delete).toHaveBeenCalledTimes(1);
  });

  it('fetches the full email body from Resend instead of the simulator field when running in production', async () => {
    mockConfig.nodeEnv = 'production';
    mockVerify.mockReturnValue(emailReceivedEvent({ text: undefined }));
    const thread = { id: 'thread-1', user_id: 'user-1', step: 'logistics' };
    conversationThreadsBuilder = makeBuilder(thread);
    wireDb();
    mockReceivingGet.mockResolvedValue({ data: { text: 'Real fetched body.' }, error: null });
    mockConversationService.postUserMessage.mockResolvedValue({
      assistantMessage: { content: 'ok' } as any,
      complete: false,
      thread: thread as any
    });

    const res = await request(app).post('/inbound-email').send({});

    expect(res.status).toBe(200);
    expect(mockReceivingGet).toHaveBeenCalledWith('email-1');
    expect(mockConversationService.postUserMessage).toHaveBeenCalledWith('user-1', 'logistics', 'email', 'Real fetched body.');
  });
});
