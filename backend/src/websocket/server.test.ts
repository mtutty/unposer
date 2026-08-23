import { EventEmitter } from 'events';

// A minimal in-process stand-in for `ws`'s WebSocketServer/WebSocket — real network sockets buy
// nothing here (WSServer's own logic is what's under test, not the `ws` library), and this lets
// every test drive handleConnection/handleMessage directly and deterministically rather than
// racing real socket events.
class FakeWebSocketServer extends EventEmitter {
  clients = new Set<any>();
  constructor(public opts: any) {
    super();
  }
}
const wssInstances: FakeWebSocketServer[] = [];

jest.mock('ws', () => ({
  WebSocketServer: jest.fn().mockImplementation((opts: any) => {
    const inst = new FakeWebSocketServer(opts);
    wssInstances.push(inst);
    return inst;
  }),
  WebSocket: { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }
}));

jest.mock('../db/connection', () => ({ db: jest.fn() }));
jest.mock('../services/conversation.service');
jest.mock('../services/topic-conversation.service');
jest.mock('../services/flow.service');

import { db } from '../db/connection';
import { ConversationService } from '../services/conversation.service';
import { TopicConversationService } from '../services/topic-conversation.service';
import { FlowService } from '../services/flow.service';
import { WSServer } from './server';

const dbMock = db as unknown as jest.Mock;

function makeBuilder(resolvedValue: any) {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.first = jest.fn(() => Promise.resolve(resolvedValue));
  return builder;
}

// A live, non-expired session for user 'u1' by default — the common case every connection test
// starts from unless it's specifically testing session lookup itself.
let sessionRow: any = { user_id: 'u1' };

function wireDb() {
  dbMock.mockImplementation((table: string) => {
    if (table === 'sessions') return makeBuilder(sessionRow);
    throw new Error(`unexpected table in test: ${table}`);
  });
}

class FakeClient extends EventEmitter {
  userId?: string;
  step?: string;
  isAlive?: boolean;
  readyState = 1; // WebSocket.OPEN
  send = jest.fn();
  close = jest.fn();
  terminate = jest.fn();
  ping = jest.fn();
}

function fakeReq(cookie: string | undefined, step: string | undefined) {
  const qs = step !== undefined ? `?step=${step}` : '';
  return { url: `/ws${qs}`, headers: { host: 'localhost', cookie } };
}

let mockConversation: jest.Mocked<ConversationService>;
let mockTopicConversation: jest.Mocked<TopicConversationService>;
let mockFlow: jest.Mocked<FlowService>;
let wss: FakeWebSocketServer;

/** Invokes the server's real 'connection' handler directly (bypassing FakeWebSocketServer.emit,
 *  which wouldn't let us await an async listener) and returns the connected client. */
async function connect(cookie: string | undefined, step: string | undefined): Promise<FakeClient> {
  const client = new FakeClient();
  const listener = wss.listeners('connection')[0] as (ws: any, req: any) => Promise<void>;
  await listener(client, fakeReq(cookie, step));
  return client;
}

async function send(client: FakeClient, event: string, payload?: any) {
  const listener = client.listeners('message')[0] as (data: Buffer) => Promise<void>;
  await listener(Buffer.from(JSON.stringify({ event, payload })));
}

describe('WSServer', () => {
  beforeEach(() => {
    // Every `new WSServer()` below starts a real 30s heartbeat setInterval that's never cleared
    // (there's no dispose/stop method) — on real timers that leaves a dangling handle per test
    // that keeps the process alive after the file finishes. Fake timers everywhere sidesteps it;
    // jest.clearAllTimers() in afterEach discards whatever's still scheduled between tests.
    jest.useFakeTimers();
    jest.clearAllMocks();
    wssInstances.length = 0;
    sessionRow = { user_id: 'u1' };
    wireDb();

    new WSServer({} as any);
    wss = wssInstances[0];

    mockConversation = (ConversationService as jest.MockedClass<typeof ConversationService>).mock
      .instances[0] as jest.Mocked<ConversationService>;
    mockTopicConversation = (TopicConversationService as jest.MockedClass<typeof TopicConversationService>).mock
      .instances[0] as jest.Mocked<TopicConversationService>;
    mockFlow = (FlowService as jest.MockedClass<typeof FlowService>).mock.instances[0] as jest.Mocked<FlowService>;
    mockFlow.getProgress.mockResolvedValue({} as any); // no logistics_channel set — app is allowed
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('connection handshake', () => {
    it('closes 1008 with no session_token cookie', async () => {
      const client = await connect(undefined, 'logistics');
      expect(client.close).toHaveBeenCalledWith(1008, expect.any(String));
      expect(dbMock).not.toHaveBeenCalled();
    });

    it('closes 1008 with no ?step', async () => {
      const client = await connect('session_token=tok-1', undefined);
      expect(client.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    it('closes 1008 for a step outside logistics/deep_prompts (e.g. sandbox has no live chat)', async () => {
      const client = await connect('session_token=tok-1', 'sandbox');
      expect(client.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    it('closes 1008 when the token matches no live session', async () => {
      sessionRow = undefined;
      wireDb();

      const client = await connect('session_token=tok-1', 'logistics');

      expect(client.close).toHaveBeenCalledWith(1008, 'Invalid token');
    });

    it('parses session_token out of a multi-cookie header', async () => {
      const client = await connect('other=1; session_token=tok-1; another=2', 'logistics');

      expect(client.close).not.toHaveBeenCalled();
      expect(client.userId).toBe('u1');
    });

    it('closes 1008 for logistics when the candidate already picked the email channel', async () => {
      mockFlow.getProgress.mockResolvedValue({ logistics_channel: 'email' } as any);

      const client = await connect('session_token=tok-1', 'logistics');

      expect(client.close).toHaveBeenCalledWith(1008, expect.stringMatching(/email/i));
    });

    it('allows logistics when the channel is unset or explicitly app', async () => {
      mockFlow.getProgress.mockResolvedValue({ logistics_channel: 'app' } as any);
      const client = await connect('session_token=tok-1', 'logistics');
      expect(client.close).not.toHaveBeenCalled();
    });

    it('does not check the channel at all for deep_prompts (always app)', async () => {
      const client = await connect('session_token=tok-1', 'deep_prompts');
      expect(mockFlow.getProgress).not.toHaveBeenCalled();
      expect(client.close).not.toHaveBeenCalled();
    });

    it('sets userId/step/isAlive on a successful connection', async () => {
      const client = await connect('session_token=tok-1', 'logistics');
      expect(client.userId).toBe('u1');
      expect(client.step).toBe('logistics');
      expect(client.isAlive).toBe(true);
    });

    it('marks isAlive true again on a pong after the heartbeat cleared it', async () => {
      const client = await connect('session_token=tok-1', 'logistics');
      client.isAlive = false;
      client.emit('pong');
      expect(client.isAlive).toBe(true);
    });
  });

  describe('chat:message', () => {
    it('routes deep_prompts through TopicConversationService and logistics through ConversationService', async () => {
      const dpClient = await connect('session_token=tok-1', 'deep_prompts');
      mockTopicConversation.postUserMessage.mockResolvedValue({ assistantMessage: { content: 'ok' } as any, complete: false });
      await send(dpClient, 'chat:message', { content: 'hi' });
      expect(mockTopicConversation.postUserMessage).toHaveBeenCalledWith('u1', 'app', 'hi');
      expect(mockConversation.postUserMessage).not.toHaveBeenCalled();

      jest.clearAllMocks();
      const logClient = await connect('session_token=tok-1', 'logistics');
      mockConversation.postUserMessage.mockResolvedValue({ assistantMessage: { content: 'ok' } as any, complete: false, thread: {} as any });
      await send(logClient, 'chat:message', { content: 'hi' });
      expect(mockConversation.postUserMessage).toHaveBeenCalledWith('u1', 'logistics', 'app', 'hi');
      expect(mockTopicConversation.postUserMessage).not.toHaveBeenCalled();
    });

    it('sends the assistant reply and, when not complete, nothing else', async () => {
      const client = await connect('session_token=tok-1', 'logistics');
      mockConversation.postUserMessage.mockResolvedValue({
        assistantMessage: { content: 'Tell me more' } as any,
        complete: false,
        thread: {} as any
      });

      await send(client, 'chat:message', { content: 'hi' });

      expect(client.send).toHaveBeenCalledTimes(1);
      const [sent] = client.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      expect(sent).toEqual({ event: 'chat:message', payload: { content: 'Tell me more' } });
      expect(mockFlow.completeStep).not.toHaveBeenCalled();
    });

    it('completes the step and emits step:complete + progress:update when the turn finishes', async () => {
      const client = await connect('session_token=tok-1', 'logistics');
      mockConversation.postUserMessage.mockResolvedValue({
        assistantMessage: { content: 'All set!' } as any,
        complete: true,
        thread: {} as any
      });
      mockFlow.completeStep.mockResolvedValue({ currentStep: 'deep_prompts' } as any);

      await send(client, 'chat:message', { content: 'done' });

      expect(mockFlow.completeStep).toHaveBeenCalledWith('u1', 'logistics');
      const events = client.send.mock.calls.map((c: any[]) => JSON.parse(c[0]).event);
      expect(events).toEqual(['chat:message', 'step:complete', 'progress:update']);
    });

    it('sends an error event with the failure code/message instead of throwing when the service rejects', async () => {
      const client = await connect('session_token=tok-1', 'logistics');
      mockConversation.postUserMessage.mockRejectedValue({ code: 'THREAD_CAP_REACHED', message: 'No more turns left' });

      await send(client, 'chat:message', { content: 'hi' });

      const [sent] = client.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      expect(sent).toEqual({
        event: 'error',
        payload: { code: 'THREAD_CAP_REACHED', message: 'No more turns left', retryable: false }
      });
    });

    it('marks an unrecognized error code as retryable', async () => {
      const client = await connect('session_token=tok-1', 'logistics');
      mockConversation.postUserMessage.mockRejectedValue(new Error('db blip'));

      await send(client, 'chat:message', { content: 'hi' });

      const [sent] = client.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      expect(sent.payload.code).toBe('INTERNAL_ERROR');
      expect(sent.payload.retryable).toBe(true);
    });
  });

  it('chat:typing is a deliberate no-op — no relay for a single-participant thread', async () => {
    const client = await connect('session_token=tok-1', 'logistics');
    await send(client, 'chat:typing', {});
    expect(client.send).not.toHaveBeenCalled();
  });

  describe('chat:resume', () => {
    it('sends progress:update, then one chat:message per opening message, via the right service for the step', async () => {
      const client = await connect('session_token=tok-1', 'deep_prompts');
      mockFlow.getProgress.mockResolvedValue({ currentStep: 'deep_prompts' } as any);
      mockTopicConversation.ensureOpeningExchanges.mockResolvedValue([{ content: 'Welcome!' } as any]);

      await send(client, 'chat:resume');

      expect(mockTopicConversation.ensureOpeningExchanges).toHaveBeenCalledWith('u1', 'app');
      expect(mockConversation.ensureOpeningMessage).not.toHaveBeenCalled();
      const events = client.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      expect(events[0]).toEqual({ event: 'progress:update', payload: { currentStep: 'deep_prompts' } });
      expect(events[1]).toEqual({ event: 'chat:message', payload: { content: 'Welcome!' } });
    });

    it('uses ConversationService.ensureOpeningMessage for logistics', async () => {
      const client = await connect('session_token=tok-1', 'logistics');
      mockConversation.ensureOpeningMessage.mockResolvedValue([{ content: 'hi' } as any]);

      await send(client, 'chat:resume');

      expect(mockConversation.ensureOpeningMessage).toHaveBeenCalledWith('u1', 'logistics', 'app');
      expect(mockTopicConversation.ensureOpeningExchanges).not.toHaveBeenCalled();
    });
  });

  it('sends INVALID_EVENT for an unrecognized event name', async () => {
    const client = await connect('session_token=tok-1', 'logistics');
    await send(client, 'chat:nonsense');
    const [sent] = client.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    expect(sent).toEqual({ event: 'error', payload: { code: 'INVALID_EVENT', message: 'Unknown event type', retryable: true } });
  });

  it('sends INTERNAL_ERROR instead of crashing on malformed JSON', async () => {
    const client = await connect('session_token=tok-1', 'logistics');
    const listener = client.listeners('message')[0] as (data: Buffer) => Promise<void>;

    await listener(Buffer.from('not valid json{'));

    const [sent] = client.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    expect(sent).toEqual({ event: 'error', payload: { code: 'INTERNAL_ERROR', message: 'Failed to process message', retryable: true } });
  });

  it('never calls send() when the socket is not open', async () => {
    const client = await connect('session_token=tok-1', 'logistics');
    client.readyState = 3; // WebSocket.CLOSED
    mockConversation.postUserMessage.mockResolvedValue({ assistantMessage: {} as any, complete: false, thread: {} as any });

    await send(client, 'chat:message', { content: 'hi' });

    expect(client.send).not.toHaveBeenCalled();
  });

  describe('heartbeat', () => {
    it('pings a live client without terminating it, then terminates it if no pong arrived before the next tick', async () => {
      new WSServer({} as any); // fresh instance whose own heartbeat interval we can attach a client to
      const heartbeatWss = wssInstances[wssInstances.length - 1];
      const client = new FakeClient();
      client.isAlive = true;
      heartbeatWss.clients.add(client);

      jest.advanceTimersByTime(30000);
      expect(client.ping).toHaveBeenCalledTimes(1);
      expect(client.terminate).not.toHaveBeenCalled();
      expect(client.isAlive).toBe(false); // flipped false pending a pong before the next tick

      jest.advanceTimersByTime(30000); // no pong arrived in between
      expect(client.terminate).toHaveBeenCalledTimes(1);
    });
  });
});
