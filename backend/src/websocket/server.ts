import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { db } from '../db/connection';
import { ConversationService } from '../services/conversation.service';
import { TopicConversationService } from '../services/topic-conversation.service';
import { RequisitionConversationService } from '../services/requisition-conversation.service';
import { FlowService } from '../services/flow.service';
import { ThreadStep } from '../types';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  step?: ThreadStep;
  // Set instead of `step` for an employer's requisition Q&A connection (Phase 2 —
  // docs/employer-onboarding-spec.md §4/§2.2's live-chat-only decision) — mutually exclusive
  // with `step`, see handleConnection.
  requisitionId?: string;
  isAlive?: boolean;
}

const CHAT_STEPS: ThreadStep[] = ['logistics', 'deep_prompts'];

/**
 * Live-chat transport for the steps/flows that need real-time back-and-forth: the candidate's
 * Step 3 logistics (app channel) and Step 5 deep prompts (app only, always), plus — per spec
 * §2.2's always-live-chat decision — an employer's requisition Q&A (Phase 2). Sandbox and
 * share-link chat are plain REST — no adaptive real-time need there.
 */
export class WSServer {
  private wss: WebSocketServer;
  private conversation: ConversationService;
  // deep_prompts runs on the topic_thread/exchange model (Iteration 3) instead of
  // conversation_threads/messages — see topic-conversation.service.ts's header comment. Logistics
  // keeps using `conversation` above, untouched.
  private topicConversation: TopicConversationService;
  private requisitionConversation: RequisitionConversationService;
  private flow: FlowService;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.conversation = new ConversationService();
    this.topicConversation = new TopicConversationService();
    this.requisitionConversation = new RequisitionConversationService();
    this.flow = new FlowService();

    this.wss.on('connection', this.handleConnection.bind(this));
    this.startHeartbeat();
  }

  private async handleConnection(ws: AuthenticatedWebSocket, req: any) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const step = url.searchParams.get('step') as ThreadStep | null;
    const requisitionId = url.searchParams.get('requisitionId');
    // session_token is an httpOnly cookie — frontend JS can't read it to put on the query
    // string, but the browser attaches it to the WS handshake automatically (same-origin
    // request), so we read it straight from the upgrade request's Cookie header.
    const token = this.readCookie(req.headers.cookie, 'session_token');

    if (!token || (!step && !requisitionId) || (!!step && !CHAT_STEPS.includes(step))) {
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

    if (requisitionId) {
      // Owner-only, same check GET/PATCH /api/requisitions/:id makes server-side — an employer
      // can only ever open their own requisition's Q&A thread. No role check needed beyond this:
      // a non-employer user simply owns no job_requisitions row, so the lookup 404s-equivalent
      // (closes the socket) the same way.
      const requisition = await db('job_requisitions').where({ id: requisitionId, user_id: session.user_id }).first();
      if (!requisition) {
        ws.close(1008, 'Requisition not found');
        return;
      }

      ws.userId = session.user_id;
      ws.requisitionId = requisitionId;
      ws.isAlive = true;
      this.wireSocket(ws);
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
    ws.step = step!;
    ws.isAlive = true;
    this.wireSocket(ws);
  }

  private wireSocket(ws: AuthenticatedWebSocket) {
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
        if (ws.requisitionId) {
          await this.handleRequisitionChatMessage(ws, payload);
        } else {
          await this.handleChatMessage(ws, payload);
        }
        break;

      case 'chat:typing':
        // No relay needed for a single-participant (candidate/employer + AI) thread.
        break;

      case 'chat:resume':
        if (ws.requisitionId) {
          await this.handleRequisitionResumeSession(ws);
        } else {
          await this.handleResumeSession(ws);
        }
        break;

      default:
        this.sendError(ws, 'INVALID_EVENT', 'Unknown event type');
    }
  }

  private async handleChatMessage(ws: AuthenticatedWebSocket, payload: any) {
    if (!ws.userId || !ws.step) return;

    try {
      const outcome =
        ws.step === 'deep_prompts'
          ? await this.topicConversation.postUserMessage(ws.userId, 'app', payload.content)
          : await this.conversation.postUserMessage(ws.userId, ws.step, 'app', payload.content);

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

    const messages =
      ws.step === 'deep_prompts'
        ? await this.topicConversation.ensureOpeningExchanges(ws.userId, 'app')
        : await this.conversation.ensureOpeningMessage(ws.userId, ws.step, 'app');
    messages.forEach((msg) => {
      this.send(ws, { event: 'chat:message', payload: msg });
    });
  }

  /** Requisition Q&A's chat:message handler (Phase 2) — no FlowProgress/step:complete concept
   *  here (job_requisitions has its own status, not steps_state), so completion is signaled with
   *  its own `requisition:complete` event instead. */
  private async handleRequisitionChatMessage(ws: AuthenticatedWebSocket, payload: any) {
    if (!ws.requisitionId) return;

    try {
      const outcome = await this.requisitionConversation.postUserMessage(ws.requisitionId, payload.content);

      this.send(ws, { event: 'chat:message', payload: outcome.assistantMessage });

      if (outcome.complete) {
        this.send(ws, { event: 'requisition:complete', payload: { requisitionId: ws.requisitionId } });
      }
    } catch (error: any) {
      this.sendError(ws, error.code || 'INTERNAL_ERROR', error.message || 'Failed to process message');
    }
  }

  private async handleRequisitionResumeSession(ws: AuthenticatedWebSocket) {
    if (!ws.requisitionId) return;

    const messages = await this.requisitionConversation.ensureOpeningMessage(ws.requisitionId);
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
