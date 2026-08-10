import { Injectable } from '@angular/core';
import { ApiService } from '../api/api.service';
import { SandboxMessage } from '../../models/sandbox.model';

@Injectable({
  providedIn: 'root'
})
export class SandboxService {
  constructor(private api: ApiService) {}

  getHistory() {
    return this.api.get<SandboxMessage[]>('/sandbox');
  }

  postMessage(content: string) {
    return this.api.post<{ userMessage: SandboxMessage; assistantMessage: SandboxMessage }>('/sandbox/message', {
      content
    });
  }

  flagGap(messageId: string, note: string) {
    return this.api.post<{ message: SandboxMessage; profile: any; routedTo: string }>('/sandbox/flag-gap', {
      messageId,
      note
    });
  }
}
