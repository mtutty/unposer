import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api/api.service';
import { Message } from '../../models/conversation.model';

/** Step 5's one REST action outside the live-chat WebSocket (flow addendum §3, Iteration 6) —
 *  moving the currently-open topic to email. See backend/src/routes/deep-prompts.routes.ts. */
@Injectable({
  providedIn: 'root'
})
export class DeepPromptsService {
  constructor(private api: ApiService) {}

  switchToEmail(): Observable<{ message: Message }> {
    return this.api.post<{ message: Message }>('/deep-prompts/switch-to-email', {});
  }
}
