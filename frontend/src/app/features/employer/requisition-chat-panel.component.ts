import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, signal, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatStreamService } from '../../core/chat/chat-stream.service';
import { RequisitionMessage } from '../../models/requisition.model';

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
        <p class="error">{{ errorMessage() }}</p>
      }

      @if (completed()) {
        <div class="completed-banner">
          <span class="stamp stamp-brass">Q&amp;A complete</span>
          <p class="meta">This requisition is now active.</p>
        </div>
      } @else {
        <form class="composer" (ngSubmit)="send()">
          <textarea [(ngModel)]="draft" name="draft" rows="5" placeholder="Write your answer…" (keydown.enter)="onEnter($event)"></textarea>
          <button type="submit" class="btn btn-primary" [disabled]="!draft.trim() || thinking()">Send</button>
        </form>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      // A fixed, bounded height (rather than a viewport-relative one, since this panel is embedded
      // partway down a normal-scrolling form page, not a dedicated full-screen chat route) so
      // .thread scrolls internally instead of growing the whole page — same intent as the
      // candidate-facing chat surfaces (chat-panel.component.ts, sandbox/public-share), applied at
      // this component's own scale rather than page-col's viewport-height chain.
      .chat {
        display: flex;
        flex-direction: column;
        // Bumped alongside the composer's rows="5" (was 28rem for a 2-line composer) so .thread
        // doesn't get squeezed down to almost nothing by the now much taller textarea.
        height: 32rem;
        gap: 0.75rem;
      }

      .thread {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        min-height: 0;
        overflow-y: auto;
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
        min-height: 8.75em;
        max-height: 14em;
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

  @ViewChild('threadEl') threadEl?: ElementRef<HTMLDivElement>;

  private subs: Subscription[] = [];
  private sendSub?: Subscription;

  constructor(private chatStream: ChatStreamService) {}

  ngOnInit(): void {
    this.subs.push(
      this.chatStream
        .open<{ messages: RequisitionMessage[]; thread: { status: string } }>(`/requisitions/${this.requisitionId}/qa`)
        .subscribe({
          next: ({ messages, thread }) => {
            this.connecting.set(false);
            this.messages.set(messages.map((m) => ({ id: m.id, role: m.role, content: m.content })));
            if (thread.status === 'complete') this.completed.set(true);
            this.scrollToBottom();
          },
          error: (err) => {
            this.connecting.set(false);
            this.errorMessage.set(err?.error?.error?.message || 'Could not load this conversation.');
          }
        })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.sendSub?.unsubscribe();
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
    this.scrollToBottom();

    this.sendSub = this.chatStream.sendMessage(`/requisitions/${this.requisitionId}/qa/message`, { content }).subscribe({
      next: (event) => {
        if (event.type === 'done') {
          const payload = event as unknown as { message: RequisitionMessage; complete: boolean; thread: { status: string } };
          this.thinking.set(false);
          this.messages.update((list) => [...list, { id: payload.message.id, role: payload.message.role, content: payload.message.content }]);
          if (payload.complete) {
            this.completed.set(true);
            this.completeChange.emit(true);
          }
          this.scrollToBottom();
        } else if (event.type === 'error') {
          this.thinking.set(false);
          this.errorMessage.set(event.message);
        }
      },
      error: () => {
        this.thinking.set(false);
        this.errorMessage.set('Something went wrong — try again.');
      }
    });
  }

  // setTimeout, not queueMicrotask — see chat-panel.component.ts's identical scrollToBottom for
  // why: under zone.js CD, a microtask scheduled from here runs *during* the same drain tick()
  // itself waits on, so it reads scrollHeight before the new message is actually in the DOM.
  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.threadEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
