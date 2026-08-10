import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, signal, ViewChild, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { WebSocketService } from '../../../core/websocket/websocket.service';
import { FlowService } from '../../../core/flow/flow.service';
import { Message } from '../../../models/conversation.model';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
}

/** Live-chat UI shared by the Step 3 (app channel) and Step 5 deep-prompt conversations. */
@Component({
    selector: 'app-chat-panel',
    imports: [FormsModule],
    template: `
    <div class="chat">
      <div class="thread" #threadEl>
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
        <p class="error-line">{{ errorMessage() }}</p>
      }

      @if (completed()) {
        <div class="completed-banner">
          <span class="stamp stamp-brass">Step complete</span>
          <ng-content select="[doneAction]"></ng-content>
        </div>
      } @else {
        <form class="composer" (ngSubmit)="send()">
          <textarea
            [(ngModel)]="draft"
            name="draft"
            rows="1"
            placeholder="Write your answer…"
            (keydown.enter)="onEnter($event)"
          ></textarea>
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
        height: 100%;
        min-height: 0;
      }

      .thread {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        padding: 0.25rem 0.25rem 1rem;
      }

      .status-line {
        text-align: center;
      }

      .thinking {
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 1em;

        span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--pencil);
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

      .error-line {
        color: var(--brick-strong);
        font-size: 0.85rem;
        margin: 0 0 0.5rem;
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
        font-family: var(--font-body);
        font-size: 1rem;
        padding: 0.7em 0.9em;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        max-height: 8em;

        &:focus {
          border-color: var(--brass-strong);
        }
      }
    `
    ]
})
export class ChatPanelComponent implements OnInit, OnDestroy {
  @Input({ required: true }) step!: 'logistics' | 'deep_prompts';
  @Output() completeChange = new EventEmitter<boolean>();
  /** Fires whenever a new assistant message arrives — lets a parent (e.g. the logistics step's
   *  area tracker) know it's a good time to re-fetch whatever got extracted this turn. */
  @Output() assistantReplied = new EventEmitter<void>();
  @ViewChild('threadEl') threadEl?: ElementRef<HTMLDivElement>;

  messages = signal<DisplayMessage[]>([]);
  connecting = signal(true);
  thinking = signal(false);
  completed = signal(false);
  errorMessage = signal('');
  draft = '';

  private subs: Subscription[] = [];

  constructor(private ws: WebSocketService, private flow: FlowService) {}

  ngOnInit(): void {
    this.ws.connect(this.step);

    this.subs.push(
      this.ws.connected().subscribe((connected) => {
        if (connected) this.connecting.set(false);
      }),

      this.ws.on('chat:message').subscribe((payload: Message) => {
        this.thinking.set(false);
        this.messages.update((list) => [...list, { id: payload.id, role: payload.role as 'user' | 'assistant', content: payload.content }]);
        this.scrollToBottom();
        if (payload.role === 'assistant') this.assistantReplied.emit();
      }),

      this.ws.on('progress:update').subscribe((progress) => this.flow.setProgress(progress)),

      this.ws.on('step:complete').subscribe(() => {
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
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    queueMicrotask(() => {
      const el = this.threadEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
