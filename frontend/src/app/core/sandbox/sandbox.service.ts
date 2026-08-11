import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api/api.service';
import { environment } from '../../../environments/environment';
import { SandboxCitation, SandboxMessage } from '../../models/sandbox.model';

/** One line of the NDJSON stream POST /sandbox/message responds with — see sandbox.routes.ts for
 *  the server side of this shape. 'citations' arrives, if at all, after 'done' — the follow-up
 *  call that identifies them runs after the visible reply is already saved and shown. */
export type SandboxStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; message: SandboxMessage }
  | { type: 'citations'; messageId: string; citations: SandboxCitation[] }
  | { type: 'error'; message: string };

@Injectable({
  providedIn: 'root'
})
export class SandboxService {
  constructor(private api: ApiService) {}

  getHistory() {
    return this.api.get<SandboxMessage[]>('/sandbox');
  }

  /**
   * Posts a question and streams the reply back chunk by chunk. Goes around ApiService/HttpClient
   * on purpose — reading a response body progressively needs a real ReadableStream reader, which
   * `fetch` gives directly; `withCredentials`'s equivalent here is `credentials: 'include'`, same
   * cookie-based session as every other call. Wrapped in an Observable (rather than returning the
   * async generator directly) so callers get the same subscribe/unsubscribe shape as the rest of
   * this app's services, and so navigating away mid-reply aborts the fetch via the teardown below
   * instead of leaving it running unread.
   */
  streamMessage(content: string): Observable<SandboxStreamEvent> {
    return new Observable<SandboxStreamEvent>((subscriber) => {
      const controller = new AbortController();

      fetch(`${environment.apiUrl}/sandbox/message`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            const body = await response.json().catch(() => null);
            subscriber.next({ type: 'error', message: body?.error?.message || `Request failed (${response.status})` });
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
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? ''; // last element may be a partial line — hold it for next read
            for (const line of lines) {
              if (line.trim()) subscriber.next(JSON.parse(line) as SandboxStreamEvent);
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

  flagGap(messageId: string, note: string) {
    return this.api.post<{ message: SandboxMessage; profile: any; routedTo: string }>('/sandbox/flag-gap', {
      messageId,
      note
    });
  }
}
