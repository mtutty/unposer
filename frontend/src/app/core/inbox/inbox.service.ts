import { Injectable } from '@angular/core';
import { ApiService } from '../api/api.service';
import { InboxView, Message } from '../../models/conversation.model';

@Injectable({
  providedIn: 'root'
})
export class InboxService {
  constructor(private api: ApiService) {}

  get() {
    return this.api.get<InboxView>('/inbox');
  }

  reply(content: string) {
    return this.api.post<{ assistantMessage: Message; complete: boolean; thread: any }>('/inbox/reply', { content });
  }

  requestNudge() {
    return this.api.post<Message>('/inbox/nudge', {});
  }
}
