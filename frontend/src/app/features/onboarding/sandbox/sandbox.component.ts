import { Component, ElementRef, OnDestroy, OnInit, ViewChild, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { SandboxService } from '../../../core/sandbox/sandbox.service';
import { FlowService } from '../../../core/flow/flow.service';
import { SandboxCitation, SandboxMessage } from '../../../models/sandbox.model';
import { STEP_ROUTES } from '../../../models/flow.model';
import { ProfileCorrectionsComponent } from '../../../shared/components/profile-corrections/profile-corrections.component';

/**
 * Step 7 practice-interview chat. Unlike the live-chat steps (chat-panel.component.ts, over a
 * WebSocket), this is plain REST with a streamed response body — the candidate holds the
 * conversational initiative here and spends most of a turn waiting on the reply, so perceived
 * latency (immediate echo, a thinking indicator, text arriving as it's generated) matters more
 * than it does for the elicitation steps. See SandboxService.streamMessage.
 */
@Component({
    selector: 'app-sandbox-step',
    imports: [FormsModule, RouterLink, ProfileCorrectionsComponent],
    template: `
    <span class="eyebrow">Interview Yourself · Practice Interview</span>
    <h1>Practice interview</h1>
    <p class="lede">
      Ask your profile the way a recruiter would. If it can't answer something well, flag it —
      that becomes an open question we route back into your stories.
    </p>

    <div class="card chat-frame">
      <div class="thread" #threadEl>
        @for (message of messages(); track message.id) {
          <div class="msg-block">
            <div class="chat-bubble" [class.from-user]="message.role === 'user'" [class.from-assistant]="message.role === 'assistant'">
              {{ message.content }}
            </div>
            @if (message.role === 'assistant') {
              @if (message.citations?.length) {
                <div class="citations">
                  <button
                    type="button"
                    class="citations-toggle"
                    [attr.aria-expanded]="expandedCitations().has(message.id)"
                    (click)="toggleCitations(message.id)"
                  >
                    <svg
                      class="chevron"
                      [class.chevron-closed]="!expandedCitations().has(message.id)"
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                    <span>Why this answer ({{ message.citations!.length }})</span>
                  </button>

                  <div class="citations-slide" [class.citations-open]="expandedCitations().has(message.id)">
                    <div class="citations-slide-inner">
                      <ul class="citation-list">
                        @for (citation of message.citations; track citation.label) {
                          <li class="citation-row">
                            <span class="citation-source">{{ sourceLabel(citation.source) }}</span>
                            <strong>{{ citation.label }}</strong>
                            <span class="citation-detail">{{ citation.detail }}</span>
                          </li>
                        }
                      </ul>
                    </div>
                  </div>
                </div>
              }
              @if (message.flagged_gap) {
                <div class="flagged-note">
                  <span class="stamp stamp-brick flagged-tag">Flagged as a gap</span>
                  <p class="meta gap-note-text">"{{ message.gap_note }}"</p>
                </div>
              } @else if (flaggingId() === message.id) {
                <form class="flag-form" (ngSubmit)="submitFlag(message.id)">
                  <input [(ngModel)]="gapNote" name="gapNote" placeholder="What should it have said?" />
                  <button type="submit" class="btn btn-secondary" [disabled]="!gapNote.trim()">Send</button>
                  <button type="button" class="btn btn-ghost" (click)="flaggingId.set(null)">Cancel</button>
                </form>
              } @else {
                <button class="btn btn-ghost flag-btn" (click)="startFlag(message.id)">This doesn't sound right</button>
              }
            }
          </div>
        }

        @if (thinking()) {
          <div class="chat-bubble from-assistant thinking">
            <span></span><span></span><span></span>
          </div>
        }

        @if (streamingReply()) {
          <div class="msg-block">
            <div class="chat-bubble from-assistant">{{ streamingReply() }}</div>
          </div>
        }

        @if (messages().length === 0 && !thinking() && !streamingReply()) {
          <p class="meta">Ask your first question — e.g. "Why are you looking to leave your current role?"</p>
        }
      </div>

      @if (errorMessage()) {
        <p class="error-line">{{ errorMessage() }}</p>
      }

      <form class="composer" (ngSubmit)="send()">
        <textarea [(ngModel)]="draft" name="draft" rows="1" placeholder="Ask a question…" (keydown.enter)="onEnter($event)"></textarea>
        <button type="submit" class="btn btn-primary" [disabled]="!draft.trim() || sending()">Send</button>
      </form>
    </div>

    <app-profile-corrections
      [showList]="false"
      explainerText="Apply your corrections to update your profile."
      [bannerLink]="profileReviewRoute"
      (applied)="onCorrectionsApplied()"
    />

    <a class="btn btn-secondary continue" [routerLink]="shareRoute">Continue to share</a>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .lede {
        color: var(--ink-soft);
        max-width: 42em;
      }

      .chat-frame {
        margin-top: 1.5rem;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        min-height: 420px;
      }

      .thread {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        overflow-y: auto;
        margin-bottom: 1rem;
      }

      .msg-block {
        display: flex;
        flex-direction: column;
        margin-bottom: 0.6rem;
      }

      // Same three-dot "thinking" treatment as the live-chat steps (chat-panel.component.ts) —
      // this chat should feel like the same product, not a separate REST-backed afterthought.
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

      .error-line {
        color: var(--brick-strong);
        font-size: 0.85rem;
        margin: 0 0 0.5rem;
      }

      // "Why this answer" — same disclosure language as the area tracker (area-tracker.component.ts):
      // chevron-right closed, chevron-down open, sliding open in normal flow rather than a floating
      // dropdown.
      .citations {
        align-self: flex-start;
        margin-top: 0.4rem;
        max-width: 72%;
      }

      .citations-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.4em;
        padding: 0.2em 0.5em 0.2em 0.3em;
        margin-left: -0.3em;
        border: none;
        border-radius: var(--radius-sm);
        background: none;
        color: var(--pencil);
        font-family: var(--font-mono);
        font-size: 0.74rem;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;

        &:hover {
          background: var(--page-2);
          color: var(--ink);
        }
      }

      .chevron {
        flex-shrink: 0;
        transition: transform 0.2s ease;
      }

      .chevron-closed {
        transform: rotate(-90deg);
      }

      .citations-slide {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.22s ease;
      }

      .citations-open {
        grid-template-rows: 1fr;
      }

      .citations-slide-inner {
        overflow: hidden;
      }

      .citation-list {
        list-style: none;
        margin: 0;
        padding: 0.6rem 0 0.2rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }

      .citation-row {
        display: flex;
        flex-direction: column;
        gap: 0.1em;
        padding: 0.5em 0.7em;
        border-left: 2px solid var(--brass-strong);
        background: var(--page-2);
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      }

      .citation-source {
        font-family: var(--font-mono);
        font-size: 0.68rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--brass-strong);
      }

      .citation-detail {
        font-size: 0.82rem;
        color: var(--ink-soft);
      }

      .flag-btn {
        align-self: flex-start;
        margin-top: 0.25rem;
        font-size: 0.78rem;
      }

      .flagged-note {
        align-self: flex-start;
        margin-top: 0.35rem;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }

      .flagged-tag {
        align-self: flex-start;
      }

      .gap-note-text {
        font-style: italic;
        margin: 0;
      }

      .flag-form {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.35rem;

        input {
          flex: 1;
          font-family: var(--font-body);
          padding: 0.4em 0.7em;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
        }
      }

      .composer {
        display: flex;
        gap: 0.6rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border);

        textarea {
          flex: 1;
          resize: none;
          font-family: var(--font-body);
          font-size: 1rem;
          padding: 0.7em 0.9em;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
        }
      }

      .continue {
        margin-top: 1.5rem;
        align-self: flex-start;
      }

      @media (prefers-reduced-motion: reduce) {
        .thinking span {
          animation: none;
        }
      }
    `
    ]
})
export class SandboxStepComponent implements OnInit, OnDestroy {
  messages = signal<SandboxMessage[]>([]);
  draft = '';
  sending = signal(false);
  // True from submit until the first chunk of the reply arrives — swaps out for streamingReply
  // the moment there's actual text to show, same "don't make them stare at nothing" idea as the
  // live-chat steps' thinking dots.
  thinking = signal(false);
  // Accumulates as chunks arrive; rendered as a live-growing assistant bubble. Cleared and folded
  // into `messages` once the 'done' event lands with the persisted (flaggable) message.
  streamingReply = signal('');
  errorMessage = signal('');
  flaggingId = signal<string | null>(null);
  gapNote = '';
  shareRoute = STEP_ROUTES['share'];
  profileReviewRoute = STEP_ROUTES['profile_review'];
  expandedCitations = signal<Set<string>>(new Set());

  @ViewChild('threadEl') threadEl?: ElementRef<HTMLDivElement>;
  private streamSub?: Subscription;

  constructor(private sandboxService: SandboxService, private flow: FlowService) {}

  ngOnInit(): void {
    this.sandboxService.getHistory().subscribe((history) => this.messages.set(history));
  }

  ngOnDestroy(): void {
    // Aborts the in-flight fetch (see SandboxService.streamMessage's teardown) rather than letting
    // an unread reply keep streaming after the candidate has navigated away.
    this.streamSub?.unsubscribe();
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
    if (!content || this.sending()) return;

    // Shown immediately rather than waiting for the round trip — the whole point is that this is
    // the one chat where the human asks and then just waits, so the ask itself should never feel
    // like it vanished into the void for the several seconds before a reply starts coming back.
    this.messages.update((list) => [
      ...list,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content,
        flagged_gap: false,
        gap_note: null,
        citations: null,
        created_at: new Date().toISOString()
      }
    ]);
    this.draft = '';
    this.errorMessage.set('');
    this.thinking.set(true);
    this.streamingReply.set('');
    this.sending.set(true);
    this.scrollToBottom();

    this.streamSub = this.sandboxService.streamMessage(content).subscribe({
      next: (event) => {
        if (event.type === 'delta') {
          this.thinking.set(false);
          this.streamingReply.update((text) => text + event.text);
          this.scrollToBottom();
        } else if (event.type === 'done') {
          this.messages.update((list) => [...list, event.message]);
          this.streamingReply.set('');
          this.thinking.set(false);
          this.sending.set(false);
          this.flow.loadProgress().subscribe();
          this.scrollToBottom();
        } else if (event.type === 'citations') {
          // Arrives, if at all, a moment after 'done' — backfilled onto the already-shown message
          // rather than held up front, see SandboxService/sandbox.routes.ts.
          this.messages.update((list) =>
            list.map((m) => (m.id === event.messageId ? { ...m, citations: event.citations } : m))
          );
        } else if (event.type === 'error') {
          this.errorMessage.set(event.message);
          this.thinking.set(false);
          this.streamingReply.set('');
          this.sending.set(false);
        }
      },
      error: () => {
        this.errorMessage.set('Something went wrong — try again.');
        this.thinking.set(false);
        this.streamingReply.set('');
        this.sending.set(false);
      }
    });
  }

  toggleCitations(messageId: string): void {
    this.expandedCitations.update((set) => {
      const next = new Set(set);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  sourceLabel(source: SandboxCitation['source']): string {
    const labels: Record<SandboxCitation['source'], string> = {
      work_history: 'Work history',
      insight: 'Insight',
      star_story: 'Story',
      goals: 'Goals',
      preferences: 'Preferences',
      work_style: 'Work style'
    };
    return labels[source];
  }

  startFlag(messageId: string): void {
    this.gapNote = '';
    this.flaggingId.set(messageId);
  }

  submitFlag(messageId: string): void {
    const note = this.gapNote.trim();
    if (!note) return;

    this.sandboxService.flagGap(messageId, note).subscribe(({ message }) => {
      this.messages.update((list) => list.map((m) => (m.id === message.id ? message : m)));
      this.flaggingId.set(null);
    });
  }

  /** ProfileCorrectionsComponent's (applied) output — flags were cleared server-side, so refetch
   *  this transcript to reflect that. */
  onCorrectionsApplied(): void {
    this.sandboxService.getHistory().subscribe((history) => this.messages.set(history));
  }

  private scrollToBottom(): void {
    queueMicrotask(() => {
      const el = this.threadEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
