import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ShareService } from '../../../core/share/share.service';
import { ShareLink } from '../../../models/sandbox.model';

@Component({
    selector: 'app-share-step',
    imports: [CommonModule, FormsModule],
    template: `
    <span class="eyebrow">Interview Yourself · Share</span>
    <h1>Share with recruiters</h1>
    <p class="lede">
      Anyone with this link gets the same conversation you just had in the practice interview —
      backed by the profile you approved. It expires on its own; nothing to revoke later.
    </p>

    <form class="card panel create-form" (ngSubmit)="create()">
      <div class="field-row">
        <div class="field">
          <label for="days">Expires in (days)</label>
          <input id="days" type="number" min="1" max="60" [(ngModel)]="days" name="days" />
        </div>
        <div class="field">
          <label for="label">Label (optional)</label>
          <input id="label" [(ngModel)]="label" name="label" placeholder="e.g. Referral to Acme" />
        </div>
      </div>
      @if (createError()) {
        <p class="error-line">{{ createError() }}</p>
      }
      <button type="submit" class="btn btn-primary" [disabled]="creating()">
        {{ creating() ? 'Generating…' : 'Generate link' }}
      </button>
    </form>

    @if (justCreatedUrl()) {
      <div class="card new-link">
        <span class="eyebrow">New link</span>
        <code>{{ justCreatedUrl() }}</code>
        <button class="btn btn-secondary" (click)="copy(justCreatedUrl()!)">{{ copied() ? 'Copied' : 'Copy' }}</button>
      </div>
    }

    @if (links().length) {
      <h3 class="section-title">Active links</h3>
      <ul class="link-list">
        @for (link of links(); track link.id) {
          <li class="card link-row">
            <div>
              <p class="link-label">{{ link.label || 'Untitled link' }}</p>
              <p class="meta">Expires {{ link.expires_at | date: 'mediumDate' }}</p>
            </div>
            <span class="stamp" [class.stamp-brick]="isExpired(link)">{{ isExpired(link) ? 'expired' : 'active' }}</span>
          </li>
        }
      </ul>
    }
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .lede {
        color: var(--ink-soft);
        max-width: 42em;
      }

      .panel {
        margin-top: 1.25rem;
        padding: 1.5rem;
      }

      .create-form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .field-row {
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: 1rem;
      }

      .new-link {
        margin-top: 1.25rem;
        padding: 1.25rem;
        display: flex;
        align-items: center;
        gap: 1rem;

        code {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 0.85rem;
          overflow-x: auto;
          white-space: nowrap;
        }
      }

      .section-title {
        margin-top: 2rem;
      }

      .link-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }

      .link-row {
        padding: 1rem 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .link-label {
        margin: 0;
        font-weight: 600;
      }

      .error-line {
        color: var(--brick-strong);
        font-size: 0.85rem;
      }

      @media (max-width: 640px) {
        .field-row {
          grid-template-columns: 1fr;
        }
      }
    `
    ]
})
export class ShareStepComponent implements OnInit {
  links = signal<ShareLink[]>([]);
  days = 14;
  label = '';
  creating = signal(false);
  createError = signal('');
  justCreatedUrl = signal<string | null>(null);
  copied = signal(false);

  constructor(private shareService: ShareService) {}

  ngOnInit(): void {
    this.shareService.list().subscribe((links) => this.links.set(links));
  }

  create(): void {
    this.creating.set(true);
    this.createError.set('');
    this.shareService.create(this.days, this.label || undefined).subscribe({
      next: ({ link, url }) => {
        this.links.update((list) => [link, ...list]);
        this.justCreatedUrl.set(url);
        this.label = '';
        this.creating.set(false);
      },
      error: (err) => {
        this.createError.set(err.error?.error?.message || 'Could not create a link');
        this.creating.set(false);
      }
    });
  }

  copy(url: string): void {
    navigator.clipboard.writeText(url).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }

  isExpired(link: ShareLink): boolean {
    return new Date(link.expires_at) < new Date();
  }
}
