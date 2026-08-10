import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PublicShareService } from '../../core/share/public-share.service';

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Component({
    selector: 'app-public-share',
    imports: [CommonModule, FormsModule],
    template: `
    <div class="screen">
      @if (loadError()) {
        <div class="card error-card">
          <span class="stamp stamp-brick">Link unavailable</span>
          <p>{{ loadError() }}</p>
        </div>
      } @else if (headline()) {
        <div class="intro">
          <span class="stamp stamp-brass">Shared profile · expires {{ expiresAt() | date: 'mediumDate' }}</span>
          <h1>{{ headline() }}</h1>
          <p class="lede">Ask anything you'd ask a candidate — this is answering from their approved profile.</p>
        </div>

        <div class="card chat-frame">
          <div class="thread">
            @for (message of messages(); track $index) {
              <div class="chat-bubble" [class.from-user]="message.role === 'user'" [class.from-assistant]="message.role === 'assistant'">
                {{ message.content }}
              </div>
            }
            @if (messages().length === 0) {
              <p class="meta">Try: "Why are you looking for a new role?"</p>
            }
            @if (sending()) {
              <div class="chat-bubble from-assistant thinking-line meta">thinking…</div>
            }
          </div>

          <form class="composer" (ngSubmit)="send()">
            <textarea [(ngModel)]="draft" name="draft" rows="1" placeholder="Ask a question…"></textarea>
            <button type="submit" class="btn btn-primary" [disabled]="!draft.trim() || sending()">Send</button>
          </form>
        </div>
      } @else {
        <p class="meta">Loading…</p>
      }
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .screen {
        min-height: 100%;
        background: var(--cover);
        padding: 3rem 1.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .error-card {
        max-width: 420px;
        padding: 2rem;
        text-align: center;
      }

      .intro {
        max-width: 640px;
        text-align: center;
        color: var(--paper-text);
        margin-bottom: 1.75rem;

        h1 {
          color: var(--paper-text);
        }
      }

      .lede {
        color: var(--paper-text-soft);
      }

      .chat-frame {
        width: 100%;
        max-width: 640px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        min-height: 420px;
      }

      .thread {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        overflow-y: auto;
        margin-bottom: 1rem;
      }

      .thinking-line {
        font-style: italic;
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
    `
    ]
})
export class PublicShareComponent implements OnInit {
  headline = signal<string | null>(null);
  expiresAt = signal<string | null>(null);
  loadError = signal('');
  messages = signal<DisplayMessage[]>([]);
  draft = '';
  sending = signal(false);
  private token = '';

  constructor(private route: ActivatedRoute, private publicShare: PublicShareService) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    this.publicShare.getProfile(this.token).subscribe({
      next: (view) => {
        this.headline.set(view.headline);
        this.expiresAt.set(view.expiresAt);
      },
      error: (err) => {
        this.loadError.set(err.error?.error?.message || 'This link is invalid or has expired.');
      }
    });
  }

  send(): void {
    const question = this.draft.trim();
    if (!question) return;

    const history = this.messages();
    this.messages.update((list) => [...list, { role: 'user', content: question }]);
    this.draft = '';
    this.sending.set(true);

    this.publicShare.sendMessage(this.token, history, question).subscribe({
      next: ({ reply }) => {
        this.messages.update((list) => [...list, { role: 'assistant', content: reply }]);
        this.sending.set(false);
      },
      error: (err) => {
        this.messages.update((list) => [
          ...list,
          { role: 'assistant', content: err.error?.error?.message || 'Something went wrong.' }
        ]);
        this.sending.set(false);
      }
    });
  }
}
