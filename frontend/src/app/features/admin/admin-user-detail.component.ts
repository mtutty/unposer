import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { AdminService, AdminUserDetail } from '../../core/admin/admin.service';

/**
 * Read-only browse of one candidate's full accumulated record, plus the admin "reset this user's
 * data" danger zone. Same deliberately plain/utilitarian styling as admin-users.component.ts —
 * see its file comment for why this doesn't use the candidate-facing "notebook" design system.
 */
@Component({
  selector: 'app-admin-user-detail',
  imports: [TopbarComponent, FormsModule, DatePipe, RouterLink],
  template: `
    <app-topbar />

    <div class="container page">
      <a routerLink="/admin/users" class="back-link">← All users</a>

      @if (loadError()) {
        <p class="error">{{ loadError() }}</p>
      }

      @if (detail(); as d) {
        <h1>{{ d.user.name }}</h1>
        <p class="lede meta">
          {{ d.user.email }} · {{ d.user.role }} · {{ d.user.status }} · last login
          {{ d.user.last_login_at ? (d.user.last_login_at | date: 'medium') : 'never' }}
        </p>

        <section class="card">
          <h2>Flow progress</h2>
          @if (d.flowProgress; as fp) {
            <p class="meta">Current step: <strong>{{ fp.current_step }}</strong>{{ fp.logistics_channel ? ' · logistics channel: ' + fp.logistics_channel : '' }}</p>
            <ul class="steps">
              @for (entry of stepEntries(fp.steps_state); track entry.step) {
                <li class="stamp" [class.stamp-brass]="entry.status === 'complete'" [class.stamp-muted]="entry.status === 'pending'">
                  {{ entry.step }}: {{ entry.status }}
                </li>
              }
            </ul>
          } @else {
            <p class="meta">Not started.</p>
          }
        </section>

        <section class="card">
          <h2>Resume</h2>
          @if (d.resume; as r) {
            <p class="meta">
              {{ r.file_name || (r.is_career_changer ? 'Manual entry (career changer)' : 'Manual entry') }} ·
              parse: {{ r.parse_status }} · {{ r.confirmed ? 'confirmed' : 'not yet confirmed' }}
            </p>
            @if (r.structured_data?.summary) {
              <p class="prose">{{ r.structured_data!.summary }}</p>
            }
            @if (r.structured_data?.workHistory?.length) {
              <ul class="plain-list">
                @for (job of r.structured_data!.workHistory; track job.company + job.title) {
                  <li>{{ job.title }} — {{ job.company }} ({{ job.startDate }}–{{ job.endDate }})</li>
                }
              </ul>
            }
          } @else {
            <p class="meta">Not started.</p>
          }
        </section>

        <section class="card">
          <h2>Logistics</h2>
          @if (d.logisticsResponse; as l) {
            <p class="meta">Status: {{ l.status }}</p>
            <dl class="kv">
              @for (entry of objectEntries(l.data); track entry.key) {
                <dt>{{ entry.key }}</dt>
                <dd>{{ entry.value }}</dd>
              }
            </dl>
          } @else {
            <p class="meta">Not started.</p>
          }

          @if (d.logisticsConversation.length) {
            <h3>Conversation ({{ d.logisticsConversation.length }} messages)</h3>
            <ol class="transcript">
              @for (m of d.logisticsConversation; track m.id) {
                <li [class.from-user]="m.role === 'user'">
                  <span class="who">{{ m.role }}</span>
                  <span class="content">{{ m.content }}</span>
                </li>
              }
            </ol>
          }
        </section>

        <section class="card">
          <h2>Deep prompts (stories)</h2>
          @if (d.deepPromptsTranscript.length) {
            <ol class="transcript">
              @for (m of d.deepPromptsTranscript; track m.id) {
                <li [class.from-user]="m.role === 'user'">
                  <span class="who">{{ m.role }}</span>
                  <span class="content">{{ m.content }}</span>
                </li>
              }
            </ol>
          } @else {
            <p class="meta">Not started.</p>
          }
        </section>

        <section class="card">
          <h2>Profile</h2>
          @if (d.profile; as p) {
            <p class="meta">Status: {{ p.status }} · version {{ p.version }}</p>
            <h3>{{ p.profile_data.headline }}</h3>
            <p class="prose">{{ p.profile_data.summary }}</p>
            @if (p.profile_data.insights.length) {
              <ul class="plain-list">
                @for (insight of p.profile_data.insights; track insight.id) {
                  <li>
                    <span class="stamp" [class.stamp-muted]="insight.status !== 'active'">{{ insight.category }}</span>
                    {{ insight.statement }}
                    @if (insight.status !== 'active') {
                      <em class="meta">({{ insight.status }})</em>
                    }
                  </li>
                }
              </ul>
            }
            @if (p.profile_data.openQuestions.length) {
              <h3>Open questions</h3>
              <ul class="plain-list">
                @for (q of p.profile_data.openQuestions; track q.id) {
                  <li>{{ q.note }} <em class="meta">({{ q.resolved ? 'resolved' : 'open' }})</em></li>
                }
              </ul>
            }
          } @else {
            <p class="meta">Not generated.</p>
          }
        </section>

        <section class="card">
          <h2>Sandbox practice chat</h2>
          @if (d.sandboxHistory.length) {
            <ol class="transcript">
              @for (m of d.sandboxHistory; track m.id) {
                <li [class.from-user]="m.role === 'user'">
                  <span class="who">{{ m.role }}</span>
                  <span class="content">
                    {{ m.content }}
                    @if (m.flagged_gap) {
                      <em class="meta"> — flagged: {{ m.gap_note }}</em>
                    }
                  </span>
                </li>
              }
            </ol>
          } @else {
            <p class="meta">Not started.</p>
          }
        </section>

        <section class="card">
          <h2>Share links</h2>
          @if (d.shareLinks.length) {
            <ul class="plain-list">
              @for (link of d.shareLinks; track link.id) {
                <li>{{ link.label || link.token }} · expires {{ link.expires_at | date: 'medium' }}</li>
              }
            </ul>
          } @else {
            <p class="meta">None created.</p>
          }
        </section>

        <section class="card danger-zone">
          <h2>Reset accumulated data</h2>
          @if (d.user.role === 'admin') {
            <p class="meta">Admin accounts have no candidate data to reset.</p>
          } @else {
            <p class="meta">
              Permanently deletes this user's resume, logistics responses, conversations, profile, sandbox
              history, and share links — everything above. Their account and login stay intact; they'd start
              onboarding over from scratch. This cannot be undone.
            </p>
            <div class="field">
              <label for="confirmEmail">Type the user's email ({{ d.user.email }}) to confirm</label>
              <input id="confirmEmail" type="text" [(ngModel)]="confirmEmail" name="confirmEmail" autocomplete="off" />
            </div>
            <button
              class="btn btn-secondary danger"
              [disabled]="resetting() || confirmEmail !== d.user.email"
              (click)="reset(d.user.id, d.user.email)"
            >
              {{ resetting() ? 'Resetting…' : 'Reset user data' }}
            </button>
            @if (resetError()) {
              <span class="error">{{ resetError() }}</span>
            }
            @if (resetDone()) {
              <p class="success">Done — this user's accumulated data has been wiped.</p>
            }
          }
        </section>
      } @else if (!loadError()) {
        <p class="meta">Loading…</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .page {
        padding: 1.5rem;
        max-width: 60rem;
      }

      .back-link {
        display: inline-block;
        margin-bottom: 1rem;
        font-family: var(--font-mono);
        font-size: 0.85rem;
      }

      .card {
        margin-bottom: 1.25rem;
        padding: 1.25rem;
      }

      .card h2 {
        margin-top: 0;
      }

      .card h3 {
        margin-bottom: 0.4rem;
      }

      .meta {
        font-family: var(--font-mono);
        font-size: 0.85rem;
      }

      .prose {
        white-space: pre-wrap;
      }

      .steps {
        list-style: none;
        margin: 0.5rem 0 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .kv {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.25rem 1rem;
        font-size: 0.9rem;
      }

      .kv dt {
        font-family: var(--font-mono);
        color: var(--pencil, #666);
      }

      .kv dd {
        margin: 0;
      }

      .plain-list {
        margin: 0.5rem 0 0;
        padding-left: 1.2rem;
      }

      .plain-list li {
        margin-bottom: 0.4rem;
      }

      .transcript {
        list-style: none;
        margin: 0.5rem 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-height: 24rem;
        overflow-y: auto;
      }

      .transcript li {
        padding: 0.5rem 0.75rem;
        border-radius: var(--radius, 6px);
        background: var(--paper-muted, #f4f2ee);
      }

      .transcript li.from-user {
        background: var(--sage, #e4ede6);
      }

      .transcript .who {
        display: block;
        font-family: var(--font-mono);
        font-size: 0.75rem;
        text-transform: uppercase;
        color: var(--pencil, #666);
        margin-bottom: 0.15rem;
      }

      .danger-zone {
        border-color: var(--brick-strong, #a33);
      }

      .btn.danger {
        border-color: var(--brick-strong, #a33);
        color: var(--brick-strong, #a33);
      }

      .error {
        color: var(--brick-strong, #a33);
      }

      .success {
        color: var(--sage-strong, #2f6b45);
      }
    `
  ]
})
export class AdminUserDetailComponent implements OnInit {
  detail = signal<AdminUserDetail | null>(null);
  loadError = signal<string | null>(null);

  confirmEmail = '';
  resetting = signal(false);
  resetError = signal<string | null>(null);
  resetDone = signal(false);

  constructor(private admin: AdminService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loadError.set(null);
    this.admin.getUserDetail(id).subscribe({
      next: (detail) => this.detail.set(detail),
      error: (err) => this.loadError.set(err?.error?.error?.message || "Failed to load this user's data.")
    });
  }

  stepEntries(stepsState: Record<string, string>): Array<{ step: string; status: string }> {
    return Object.entries(stepsState).map(([step, status]) => ({ step, status }));
  }

  objectEntries(data: Record<string, unknown>): Array<{ key: string; value: unknown }> {
    return Object.entries(data || {}).map(([key, value]) => ({ key, value }));
  }

  reset(id: string, email: string): void {
    if (this.confirmEmail !== email) return;
    this.resetting.set(true);
    this.resetError.set(null);
    this.resetDone.set(false);
    this.admin.resetUserData(id, this.confirmEmail).subscribe({
      next: () => {
        this.resetting.set(false);
        this.resetDone.set(true);
        this.confirmEmail = '';
        this.load();
      },
      error: (err) => {
        this.resetting.set(false);
        this.resetError.set(err?.error?.error?.message || 'Reset failed.');
      }
    });
  }
}
