import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { WebSocketService } from '../../core/websocket/websocket.service';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Live chat for a requisition's org/situational/cultural Q&A (Phase 2 —
 * docs/employer-onboarding-spec.md §4/§2.2), connected the same way
 * shared/components/chat-panel/chat-panel.component.ts is for the candidate's logistics/
 * deep_prompts steps, but a separate, smaller component rather than a generalization of that
 * one: no FlowProgress/step:complete concept here (job_requisitions has its own status, not
 * steps_state — see the `requisition:complete` event this listens for instead), no info-area
 * glyph tracker (nothing analogous exists on this side yet), and deliberately plain styling to
 * match the rest of features/employer/, not the candidate-facing "notebook" system.
 */
@Component({
  selector: 'app-requisition-chat-panel',
  imports: [FormsModule],
  template: `
    <div class="chat">
      <div class="thread">
        @if (connecting()) {
          <p class="meta status-line">Connecting…</p>
        }
        @for (message of messages(); track message.id) {
          <div class="chat-bubble" [class.from-user]="message.role === 'user'" [class.from-assistant]="message.role === 'assistant'">
            {{ message.content }}
          </div>
        }
        @if (thinking()) {
          <div class="chat-bubble from-assistant thinking">
            <span></span><span></span><span></span>
          </div>
        }
      </div>

      @if (errorMessage()) {
        <p class="error">{{ errorMessage() }}</p>
      }

      @if (completed()) {
        <div class="completed-banner">
          <span class="stamp stamp-brass">Q&amp;A complete</span>
          <p class="meta">This requisition is now active.</p>
        </div>
      } @else {
        <form class="composer" (ngSubmit)="send()">
          <textarea [(ngModel)]="draft" name="draft" rows="1" placeholder="Write your answer…" (keydown.enter)="onEnter($event)"></textarea>
          <button type="submit" class="btn btn-primary" [disabled]="!draft.trim() || thinking()">Send</button>
        </form>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .chat {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .thread {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        min-height: 12rem;
      }

      .status-line {
        text-align: center;
      }

      .thinking {
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 0.6em 0.2em;
        border: none;
        background: transparent;

        span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--pencil, #666);
          animation: pulse 1.1s infinite ease-in-out;
        }

        span:nth-child(2) {
          animation-delay: 0.15s;
        }

        span:nth-child(3) {
          animation-delay: 0.3s;
        }
      }

      @keyframes pulse {
        0%,
        80%,
        100% {
          opacity: 0.25;
        }
        40% {
          opacity: 1;
        }
      }

      .error {
        color: var(--brick-strong, #a33);
      }

      .completed-banner {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border);
      }

      .composer {
        display: flex;
        gap: 0.6rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border);
      }

      textarea {
        flex: 1;
        resize: none;
        font-family: inherit;
        font-size: 1rem;
        padding: 0.7em 0.9em;
        border: 1px solid var(--border);
        border-radius: 4px;
        max-height: 8em;
      }
    `
  ]
})
export class RequisitionChatPanelComponent implements OnInit, OnDestroy {
  @Input({ required: true }) requisitionId!: string;
  @Output() completeChange = new EventEmitter<boolean>();

  messages = signal<DisplayMessage[]>([]);
  connecting = signal(true);
  thinking = signal(false);
  completed = signal(false);
  errorMessage = signal('');
  draft = '';

  private subs: Subscription[] = [];

  constructor(private ws: WebSocketService) {}

  ngOnInit(): void {
    this.ws.connect({ requisitionId: this.requisitionId });

    this.subs.push(
      this.ws.connected().subscribe((connected) => {
        if (connected) this.connecting.set(false);
      }),

      this.ws.on('chat:message').subscribe((payload: DisplayMessage) => {
        this.thinking.set(false);
        this.messages.update((list) => [...list, { id: payload.id, role: payload.role, content: payload.content }]);
      }),

      this.ws.on('requisition:complete').subscribe(() => {
        this.completed.set(true);
        this.completeChange.emit(true);
      }),

      this.ws.on('error').subscribe((err) => {
        this.thinking.set(false);
        this.errorMessage.set(err.message);
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.ws.disconnect();
  }

  onEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      this.send();
    }
  }

  send(): void {
    const content = this.draft.trim();
    if (!content) return;

    this.messages.update((list) => [...list, { id: `local-${Date.now()}`, role: 'user', content }]);
    this.draft = '';
    this.errorMessage.set('');
    this.thinking.set(true);
    this.ws.send('chat:message', { content });
  }
}
