jest.mock('../db/connection', () => ({ db: jest.fn() }));

// See share.routes.test.ts for why requireAuth is stubbed rather than exercised here.
jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.header('x-test-user');
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session token provided' } });
      return;
    }
    req.userId = userId;
    next();
  }
}));

jest.mock('../services/topic-conversation.service');
jest.mock('../services/flow.service');

import express from 'express';
import request from 'supertest';
import { TopicConversationService } from '../services/topic-conversation.service';
import { FlowService } from '../services/flow.service';
import { errorHandler } from '../middleware/error-handler';
import { AppError } from '../types';
import deepPromptsRoutes from './deep-prompts.routes';

const mockTopicConversation = (TopicConversationService as jest.MockedClass<typeof TopicConversationService>).mock
  .instances[0] as jest.Mocked<TopicConversationService>;
const mockFlowService = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', deepPromptsRoutes);
  app.use(errorHandler);
  return app;
}

// Parses `event: <type>\ndata: <json>\n\n` frames back into {type, ...data} objects — see
// utils/sse.ts and sandbox.routes.test.ts's identical helper.
function parseSSE(text: string) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const [eventLine, dataLine] = frame.split('\n');
      return { type: eventLine.replace('event: ', ''), ...JSON.parse(dataLine.replace('data: ', '')) };
    });
}

describe('deep-prompts.routes POST /switch-to-email', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('401s with no authenticated user', async () => {
    const res = await request(app).post('/switch-to-email');
    expect(res.status).toBe(401);
    expect(mockTopicConversation.switchActiveTopicToEmail).not.toHaveBeenCalled();
  });

  it("switches the caller's active topic thread to email and returns the resulting message", async () => {
    mockTopicConversation.switchActiveTopicToEmail.mockResolvedValue({ content: 'Continuing by email — check your inbox.' } as any);

    const res = await request(app).post('/switch-to-email').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockTopicConversation.switchActiveTopicToEmail).toHaveBeenCalledWith('u1');
    expect(res.body.message.content).toMatch(/email/);
  });

  it('propagates a service AppError as its own status/code (e.g. no active topic thread)', async () => {
    mockTopicConversation.switchActiveTopicToEmail.mockRejectedValue(
      new AppError('NO_ACTIVE_TOPIC', 'No active deep-prompt thread to switch', 400)
    );

    const res = await request(app).post('/switch-to-email').set('x-test-user', 'u1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_ACTIVE_TOPIC');
  });
});

describe('deep-prompts.routes POST /channel', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('401s with no authenticated user', async () => {
    const res = await request(app).post('/channel').send({ channel: 'app' });
    expect(res.status).toBe(401);
    expect(mockFlowService.setChannel).not.toHaveBeenCalled();
  });

  it('rejects an invalid channel', async () => {
    const res = await request(app).post('/channel').set('x-test-user', 'u1').send({ channel: 'carrier-pigeon' });
    expect(res.status).toBe(400);
    expect(mockFlowService.setChannel).not.toHaveBeenCalled();
  });

  it('persists the channel on flow_progress and returns the resulting messages', async () => {
    mockTopicConversation.chooseChannel.mockResolvedValue([{ content: 'hello' } as any]);

    const res = await request(app).post('/channel').set('x-test-user', 'u1').send({ channel: 'email' });

    expect(res.status).toBe(200);
    expect(mockFlowService.setChannel).toHaveBeenCalledWith('u1', 'deep_prompts', 'email');
    expect(mockTopicConversation.chooseChannel).toHaveBeenCalledWith('u1', 'email');
    expect(res.body).toEqual({ channel: 'email', messages: [{ content: 'hello' }] });
  });
});

describe('deep-prompts.routes GET /thread', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('401s with no authenticated user', async () => {
    const res = await request(app).get('/thread');
    expect(res.status).toBe(401);
  });

  it("returns the caller's active thread view", async () => {
    const view = { channel: 'email', messages: [], threadStatus: 'open' };
    mockTopicConversation.getActiveThreadView.mockResolvedValue(view as any);

    const res = await request(app).get('/thread').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockTopicConversation.getActiveThreadView).toHaveBeenCalledWith('u1');
    expect(res.body).toEqual(view);
  });
});

describe('deep-prompts.routes GET /open', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('opens/resumes the active topic and returns its exchanges', async () => {
    mockTopicConversation.ensureOpeningExchanges.mockResolvedValue([{ content: 'Tell me about a time...' } as any]);

    const res = await request(app).get('/open').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockTopicConversation.ensureOpeningExchanges).toHaveBeenCalledWith('u1', 'app');
    expect(res.body).toEqual({ messages: [{ content: 'Tell me about a time...' }] });
  });
});

describe('deep-prompts.routes POST /message', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('rejects empty content before calling the service', async () => {
    const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: '' });

    expect(res.status).toBe(400);
    expect(mockTopicConversation.postUserMessage).not.toHaveBeenCalled();
  });

  it('streams one delta frame with the full reply, then done, without completing the step when the turn is not finished', async () => {
    mockTopicConversation.postUserMessage.mockResolvedValue({
      assistantMessage: { id: 'm1', content: 'And what happened next?' } as any,
      complete: false,
      topicClosed: false
    });

    const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'I noticed the deploy was failing.' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/event-stream/);
    expect(mockTopicConversation.postUserMessage).toHaveBeenCalledWith('u1', 'app', 'I noticed the deploy was failing.');
    const frames = parseSSE(res.text);
    expect(frames).toEqual([
      { type: 'delta', text: 'And what happened next?' },
      { type: 'done', message: { id: 'm1', content: 'And what happened next?' }, complete: false, topicClosed: false }
    ]);
    expect(mockFlowService.completeStep).not.toHaveBeenCalled();
  });

  it('surfaces topicClosed in "done" when a topic closes without completing the step (e.g. a bonus/optional question long after the step first completed)', async () => {
    mockTopicConversation.postUserMessage.mockResolvedValue({
      assistantMessage: { id: 'm1b', content: "I've got what I need on this topic." } as any,
      complete: false,
      topicClosed: true
    });

    const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'that covers it' });

    const frames = parseSSE(res.text);
    expect(frames[1]).toEqual({
      type: 'done',
      message: { id: 'm1b', content: "I've got what I need on this topic." },
      complete: false,
      topicClosed: true
    });
    expect(mockFlowService.completeStep).not.toHaveBeenCalled();
  });

  // TopicConversationService now owns the decision of whether/how to update flow_progress (it's
  // the one place with both the thread's type and the turn's outcome in scope — see its own
  // postUserMessage comment) and returns the refreshed row as `progress`; this route's only job
  // is to forward whatever it gets, verbatim, rather than deciding for itself whether to call
  // flowService.completeStep — see the sibling test below for the ad hoc "restore" case, which
  // also needs `progress` forwarded despite complete staying false.
  it('forwards the resulting progress in "done" when the turn completes the step', async () => {
    mockTopicConversation.postUserMessage.mockResolvedValue({
      assistantMessage: { id: 'm2', content: 'Thanks — that closes this one out.' } as any,
      complete: true,
      topicClosed: true,
      progress: { current_step: 'profile_review' } as any
    });

    const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'done' });

    expect(mockFlowService.completeStep).not.toHaveBeenCalled(); // the service already did this, not the route
    const frames = parseSSE(res.text);
    expect(frames[1]).toEqual({
      type: 'done',
      message: { id: 'm2', content: 'Thanks — that closes this one out.' },
      complete: true,
      topicClosed: true,
      progress: { current_step: 'profile_review' }
    });
  });

  it('forwards progress on an ad hoc correction thread closing too, even though complete stays false', async () => {
    mockTopicConversation.postUserMessage.mockResolvedValue({
      assistantMessage: { id: 'm3', content: 'Got it, thanks.' } as any,
      complete: false,
      topicClosed: true,
      progress: { current_step: 'profile_review' } as any
    });

    const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'that answers it' });

    const frames = parseSSE(res.text);
    expect(frames[1]).toEqual({
      type: 'done',
      message: { id: 'm3', content: 'Got it, thanks.' },
      complete: false,
      topicClosed: true,
      progress: { current_step: 'profile_review' }
    });
  });

  it('falls back to a normal JSON error response when the service fails before any bytes are written', async () => {
    mockTopicConversation.postUserMessage.mockRejectedValue(new AppError('NO_ACTIVE_TOPIC', 'No open topic to reply to — resume the session first.', 400));

    const res = await request(app).post('/message').set('x-test-user', 'u1').send({ content: 'hi' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_ACTIVE_TOPIC');
  });
});
