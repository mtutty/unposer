import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../api/api.service';
import { ChatStreamService } from '../chat/chat-stream.service';
import { SandboxCitation, SandboxMessage } from '../../models/sandbox.model';

/** One frame of the SSE stream POST /sandbox/message responds with — see sandbox.routes.ts for
 *  the server side of this shape. 'citations' arrives, if at all, after 'done' — the follow-up
 *  call that identifies them runs after the visible reply is already saved and shown.
 *  'tool_call_start'/'tool_call_end' bracket an LLM-invoked search_candidate_evidence lookup
 *  mid-turn — they carry no query/results, just that a lookup happened. */
export type SandboxStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; tool: string }
  | { type: 'tool_call_end'; tool: string }
  | { type: 'done'; message: SandboxMessage }
  | { type: 'citations'; messageId: string; citations: SandboxCitation[] }
  | { type: 'error'; message: string };

@Injectable({
  providedIn: 'root'
})
export class SandboxService {
  constructor(private api: ApiService, private chatStream: ChatStreamService) {}

  getHistory() {
    return this.api.get<SandboxMessage[]>('/sandbox');
  }

  /** Posts a question and streams the reply back chunk by chunk — see ChatStreamService for the
   *  shared SSE-parsing transport every chat surface in the app now uses. */
  streamMessage(content: string): Observable<SandboxStreamEvent> {
    return this.chatStream
      .sendMessage('/sandbox/message', { content })
      .pipe(map((event) => event as unknown as SandboxStreamEvent));
  }

  flagGap(messageId: string, note: string) {
    return this.api.post<{ message: SandboxMessage; profile: any; routedTo: string }>('/sandbox/flag-gap', {
      messageId,
      note
    });
  }
}
