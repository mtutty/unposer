import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api/api.service';
import { environment } from '../../../environments/environment';

/**
 * Superset of every chat-turn frame type any streaming route emits (see CLAUDE.md's "Streaming
 * Chat (SSE)" section for the shared vocabulary) — not every route sends every type. `done` and
 * `citations` carry route-specific extra fields (e.g. `progress` for a candidate step, `thread`
 * for requisition Q&A), so they're typed loosely here; callers narrow further with their own
 * message-shaped types where it matters (see SandboxService.streamMessage).
 */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; tool: string }
  | { type: 'tool_call_end'; tool: string }
  | ({ type: 'done' } & Record<string, any>)
  | ({ type: 'citations' } & Record<string, any>)
  | { type: 'error'; code?: string; message: string };

/**
 * Shared client-side transport for every chat surface in the app (candidate logistics/
 * deep_prompts, employer requisition Q&A, sandbox/share) — replaces the old WebSocketService.
 * See docs/websocket-to-sse-migration-plan.md for why this is one service rather than one per
 * surface, and CLAUDE.md's "Streaming Chat (SSE)" section for the settled design this implements.
 */
@Injectable({
  providedIn: 'root'
})
export class ChatStreamService {
  constructor(private api: ApiService) {}

  /** Plain JSON GET — the "open/resume" call every chat surface makes on entry (existing history,
   *  or a freshly-generated opener on a candidate's first visit). Not SSE-framed. */
  open<T>(path: string): Observable<T> {
    return this.api.get<T>(path);
  }

  /**
   * POSTs one chat turn and parses the `text/event-stream` response body back into typed events.
   * Goes around ApiService/HttpClient on purpose — reading a response body progressively needs a
   * real ReadableStream reader, which `fetch` gives directly; `withCredentials`'s equivalent here
   * is `credentials: 'include'`, same cookie-based session as every other call. Wrapped in an
   * Observable (rather than returning the async generator directly) so callers get the same
   * subscribe/unsubscribe shape as the rest of this app's services, and so navigating away
   * mid-reply aborts the fetch via the teardown below instead of leaving it running unread.
   */
  sendMessage(path: string, body: Record<string, unknown>): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((subscriber) => {
      const controller = new AbortController();

      fetch(`${environment.apiUrl}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            const errBody = await response.json().catch(() => null);
            subscriber.next({ type: 'error', message: errBody?.error?.message || `Request failed (${response.status})` });
            subscriber.complete();
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            // Frames are separated by a blank line (`\n\n`) — the last element may be a partial
            // frame still waiting on more bytes, so hold it back for the next read instead of
            // parsing it early. See backend/src/utils/sse.ts's writeSSEEvent for the writer side.
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              if (!frame.trim()) continue;
              const lines = frame.split('\n');
              const eventLine = lines.find((l) => l.startsWith('event: '));
              const dataLine = lines.find((l) => l.startsWith('data: '));
              if (!eventLine || !dataLine) continue;
              const type = eventLine.slice('event: '.length);
              const data = JSON.parse(dataLine.slice('data: '.length));
              subscriber.next({ type, ...data } as ChatStreamEvent);
            }
          }

          subscriber.complete();
        })
        .catch((err) => {
          if (controller.signal.aborted) return; // teardown-triggered abort, not a real failure
          subscriber.next({ type: 'error', message: err?.message || 'Connection failed' });
          subscriber.complete();
        });

      return () => controller.abort();
    });
  }
}
