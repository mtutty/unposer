import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api/api.service';
import { Message } from '../../models/conversation.model';
import { Channel } from '../../models/flow.model';

export interface DeepPromptsThreadView {
  channel: Channel;
  messages: Message[];
  threadStatus: 'open' | 'closed' | null;
}

/** Step 5's REST actions outside the live-chat WebSocket — the upfront/mid-conversation channel
 *  picker and its read-only email-thread view, mirroring LogisticsService's shape. See
 *  backend/src/routes/deep-prompts.routes.ts. */
@Injectable({
  providedIn: 'root'
})
export class DeepPromptsService {
  constructor(private api: ApiService) {}

  get(): Observable<DeepPromptsThreadView> {
    return this.api.get<DeepPromptsThreadView>('/deep-prompts/thread');
  }

  chooseChannel(channel: Channel): Observable<{ channel: Channel; messages: Message[] }> {
    return this.api.post<{ channel: Channel; messages: Message[] }>('/deep-prompts/channel', { channel });
  }

  switchToEmail(): Observable<{ message: Message }> {
    return this.api.post<{ message: Message }>('/deep-prompts/switch-to-email', {});
  }
}
