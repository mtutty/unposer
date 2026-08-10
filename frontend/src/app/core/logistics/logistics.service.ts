import { Injectable } from '@angular/core';
import { ApiService } from '../api/api.service';
import { LogisticsResponse, Message } from '../../models/conversation.model';
import { Channel } from '../../models/flow.model';

@Injectable({
  providedIn: 'root'
})
export class LogisticsService {
  constructor(private api: ApiService) {}

  get() {
    return this.api.get<LogisticsResponse | null>('/logistics');
  }

  chooseChannel(channel: Channel) {
    return this.api.post<{ channel: Channel; messages: Message[] }>('/logistics/channel', { channel });
  }
}
