import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { db } from '../db/connection';
import { ConversationService } from '../services/conversation.service';
import { FlowService } from '../services/flow.service';
import { ThreadStep } from '../types';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  step?: ThreadStep;
  isAlive?: boolean;
}

const CHAT_STEPS: ThreadStep[] = ['logistics', 'deep_prompts'];

/**
 * Live-chat transport for the two steps the spec requires real-time back-and-forth: Step 3
 * logistics (when the candidate picked the app channel) and Step 5 deep prompts (app only,
 * always). Sandbox and share-link chat are plain REST — no adaptive real-time need there.
 */
export class WSServer {
  private wss: WebSocketServer;
  private conversation: ConversationService;
  private flow: FlowService;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.conversation = new ConversationService();
    this.flow = new FlowService();

    this.wss.on('connection', this.handleConnection.bind(this));
    this.startHeartbeat();
  }

  private async handleConnection(ws: AuthenticatedWebSocket, req: any) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const step = url.searchParams.get('step') as ThreadStep | null;
    // session_token is an httpOnly cookie — frontend JS can't read it to put on the query
    // string, but the browser attaches it to the WS handshake automatically (same-origin
    // request), so we read it straight from the upgrade request's Cookie header.
    const token = this.readCookie(req.headers.cookie, 'session_token');

    if (!token || !step || !CHAT_STEPS.includes(step)) {
      ws.close(1008, 'Missing or invalid session/step');
      return;
    }

    const session = await db('sessions')
      .where({ token })
      .where('expires_at', '>', new Date())
      .first();

    if (!session) {
      ws.close(1008, 'Invalid token');
      return;
    }

    if (step === 'logistics') {
      const progress = await this.flow.getProgress(session.user_id);
      if (progress.logistics_channel && progress.logistics_channel !== 'app') {
        ws.close(1008, 'Logistics channel is set to email — use the inbox instead');
        return;
      }
    }

    ws.userId = session.user_id;
    ws.step = step;
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(ws, message);
      } catch (error) {
        console.error('WebSocket message error:', error);
        this.sendError(ws, 'INTERNAL_ERROR', 'Failed to process message');
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected:', ws.userId);
    });
  }

  private async handleMessage(ws: AuthenticatedWebSocket, message: any) {
    const { event, payload } = message;

    switch (event) {
      case 'chat:message':
        await this.handleChatMessage(ws, payload);
        break;

      case 'chat:typing':
        // No relay needed for a single-participant (candidate + AI) thread.
        break;

      case 'chat:resume':
        await this.handleResumeSession(ws);
        break;

      default:
        this.sendError(ws, 'INVALID_EVENT', 'Unknown event type');
    }
  }

  private async handleChatMessage(ws: AuthenticatedWebSocket, payload: any) {
    if (!ws.userId || !ws.step) return;

    try {
      const outcome = await this.conversation.postUserMessage(ws.userId, ws.step, 'app', payload.content);

      this.send(ws, { event: 'chat:message', payload: outcome.assistantMessage });

      if (outcome.complete) {
        const progress = await this.flow.completeStep(ws.userId, ws.step);
        this.send(ws, { event: 'step:complete', payload: { step: ws.step } });
        this.send(ws, { event: 'progress:update', payload: progress });
      }
    } catch (error: any) {
      this.sendError(ws, error.code || 'INTERNAL_ERROR', error.message || 'Failed to process message');
    }
  }

  private async handleResumeSession(ws: AuthenticatedWebSocket) {
    if (!ws.userId || !ws.step) return;

    const progress = await this.flow.getProgress(ws.userId);
    this.send(ws, { event: 'progress:update', payload: progress });

    const messages = await this.conversation.ensureOpeningMessage(ws.userId, ws.step, 'app');
    messages.forEach((msg) => {
      this.send(ws, { event: 'chat:message', payload: msg });
    });
  }

  private readCookie(cookieHeader: string | undefined, name: string): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  }

  private send(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private sendError(ws: WebSocket, code: string, message: string) {
    this.send(ws, {
      event: 'error',
      payload: { code, message, retryable: code !== 'THREAD_COMPLETE' && code !== 'THREAD_CAP_REACHED' }
    });
  }

  private startHeartbeat() {
    setInterval(() => {
      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }
}
