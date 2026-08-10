import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SandboxService } from '../../../core/sandbox/sandbox.service';
import { FlowService } from '../../../core/flow/flow.service';
import { SandboxMessage } from '../../../models/sandbox.model';
import { STEP_ROUTES } from '../../../models/flow.model';

@Component({
    selector: 'app-sandbox-step',
    imports: [FormsModule, RouterLink],
    template: `
    <span class="eyebrow">Interview Yourself · Practice Interview</span>
    <h1>Practice interview</h1>
    <p class="lede">
      Ask your profile the way a recruiter would. If it can't answer something well, flag it —
      that becomes an open question we route back into your stories.
    </p>

    <div class="card chat-frame">
      <div class="thread">
        @for (message of messages(); track message.id) {
          <div class="msg-block">
            <div class="chat-bubble" [class.from-user]="message.role === 'user'" [class.from-assistant]="message.role === 'assistant'">
              {{ message.content }}
            </div>
            @if (message.role === 'assistant') {
              @if (message.flagged_gap) {
                <span class="stamp stamp-brick flagged-tag">Flagged as a gap</span>
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
        @if (messages().length === 0) {
          <p class="meta">Ask your first question — e.g. "Why are you looking to leave your current role?"</p>
        }
      </div>

      <form class="composer" (ngSubmit)="send()">
        <textarea [(ngModel)]="draft" name="draft" rows="1" placeholder="Ask a question…"></textarea>
        <button type="submit" class="btn btn-primary" [disabled]="!draft.trim() || sending()">Send</button>
      </form>
    </div>

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

      .flag-btn {
        align-self: flex-start;
        margin-top: 0.25rem;
        font-size: 0.78rem;
      }

      .flagged-tag {
        align-self: flex-start;
        margin-top: 0.35rem;
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
    `
    ]
})
export class SandboxStepComponent implements OnInit {
  messages = signal<SandboxMessage[]>([]);
  draft = '';
  sending = signal(false);
  flaggingId = signal<string | null>(null);
  gapNote = '';
  shareRoute = STEP_ROUTES['share'];

  constructor(private sandboxService: SandboxService, private flow: FlowService) {}

  ngOnInit(): void {
    this.sandboxService.getHistory().subscribe((history) => this.messages.set(history));
  }

  send(): void {
    const content = this.draft.trim();
    if (!content) return;

    this.draft = '';
    this.sending.set(true);
    this.sandboxService.postMessage(content).subscribe({
      next: ({ userMessage, assistantMessage }) => {
        this.messages.update((list) => [...list, userMessage, assistantMessage]);
        this.sending.set(false);
        this.flow.loadProgress().subscribe();
      },
      error: () => this.sending.set(false)
    });
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
}
