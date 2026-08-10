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
          @let old = isOld(message);
          @let expanded = expandedIds().has(message.id);
          <div class="chat-bubble" [class.from-user]="message.role === 'user'" [class.from-assistant]="message.role === 'assistant'">
            <div class="bubble-text" [class.clamped]="old && !expanded">{{ message.content }}</div>
            @if (old) {
              <button type="button" class="expand-toggle" (click)="toggleExpand(message.id)">
                {{ expanded ? 'Show less' : 'Show more' }}
              </button>
            }
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
      // Makes the host itself a shrinkable flex child of whatever frame embeds it (the logistics/
      // deep-prompts .chat-frame), rather than an unsized custom element — without this, .chat's
      // height:100% below has nothing definite to resolve against and the thread can't scroll
      // internally; the page just grows instead. See onboarding-shell's .page-col for the other
      // half of this chain.
      :host {
        display: flex;
        flex: 1;
        min-height: 0;
      }

      .chat {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        width: 100%;
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

      // Overrides the .chat-bubble.from-assistant border/background — the pending indicator reads
      // better as three bare dots than as an empty bordered bubble.
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

      // Clamps every message except each role's latest to 3 lines, so a long thread stays scannable
      // — the full text is one click away rather than gone.
      .bubble-text.clamped {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .expand-toggle {
        display: block;
        margin-top: 0.35em;
        padding: 0;
        border: none;
        background: none;
        font-family: var(--font-mono);
        font-size: 0.72rem;
        color: inherit;
        opacity: 0.7;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;

        &:hover {
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
  // Messages the candidate has manually expanded past their 3-line clamp — see isOld().
  expandedIds = signal<Set<string>>(new Set());

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

  /** True for any message other than the latest one from its own role — those are the ones that
   *  get clamped to 3 lines, since the newest exchange (one bubble per side) is what's actively
   *  being read. */
  isOld(message: DisplayMessage): boolean {
    const list = this.messages();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === message.role) return list[i].id !== message.id;
    }
    return false;
  }

  toggleExpand(id: string): void {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
