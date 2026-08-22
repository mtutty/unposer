import { Component, OnInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { ScheduleService } from '../../core/schedule/schedule.service';
import { PacePreference, PauseDuration, Progression } from '../../models/personality.model';

/** Destination every scheduled re-engagement email links back to (spec §3.5 — "every email
 *  carries a link back to the site for pace controls, suspend, and unsubscribe"). Authenticated
 *  page, not a magic link — see weekly-scheduler.service.ts's sendWithSettingsFooter comment for
 *  why. Reachable any time from the dashboard too, not just from an email. */
@Component({
  selector: 'app-schedule-settings',
  imports: [TopbarComponent, DatePipe],
  template: `
    <app-topbar />

    <div class="container page">
      <span class="eyebrow">Ongoing</span>
      <h1>How often we reach out</h1>
      <p class="lede">
        The longer-term conversations are what make this worth doing — new questions on separate
        occasions build the depth a one-time chat can't. None of this is required or graded: pause
        or unsubscribe any time with no effect on your existing profile.
      </p>

      @if (loadError()) {
        <p class="error-line">{{ loadError() }}</p>
      }

      @if (state(); as s) {
        @if (s.unsubscribed_at) {
          <div class="card banner banner-brick">
            <p>
              You unsubscribed on {{ s.unsubscribed_at | date: 'mediumDate' }}. Your profile, evidence,
              and everything you've already told us stays exactly as it is — we just won't reach out
              again unless you turn this back on.
            </p>
            <button class="btn btn-primary" [disabled]="saving()" (click)="resume()">Resume weekly check-ins</button>
          </div>
        } @else if (s.dormant_at) {
          <div class="card banner banner-brick">
            <p>
              We marked this dormant on {{ s.dormant_at | date: 'mediumDate' }} after a few unanswered
              check-ins — replying to any past message brings this right back automatically, or use the
              button below.
            </p>
            <button class="btn btn-primary" [disabled]="saving()" (click)="resume()">Resume weekly check-ins</button>
          </div>
        } @else if (isPaused(s)) {
          <div class="card banner">
            <p>
              Paused{{ s.paused_indefinitely ? ' indefinitely' : ' until ' + (s.paused_until | date: 'mediumDate') }}.
              We won't send anything until you resume.
            </p>
            <button class="btn btn-primary" [disabled]="saving()" (click)="resume()">Resume now</button>
          </div>
        }

        <div class="card panel">
          <h3 class="section-title">Pace</h3>
          <p class="meta">How eager you are to keep going, once you're past your first sitting.</p>
          <div class="pace-options">
            @for (option of paceOptions; track option.value) {
              <label class="pace-option" [class.selected]="s.pace_preference === option.value">
                <input
                  type="radio"
                  name="pace"
                  [value]="option.value"
                  [checked]="s.pace_preference === option.value"
                  [disabled]="saving()"
                  (change)="setPace(option.value)"
                />
                <span class="pace-label">{{ option.label }}</span>
                <span class="pace-desc">{{ option.description }}</span>
              </label>
            }
          </div>
        </div>

        <div class="card panel">
          <h3 class="section-title">Pause</h3>
          <p class="meta">Stop the weekly check-ins for a while without unsubscribing.</p>
          <div class="pause-buttons">
            <button class="btn btn-secondary" [disabled]="saving()" (click)="pause('30d')">30 days</button>
            <button class="btn btn-secondary" [disabled]="saving()" (click)="pause('90d')">90 days</button>
            <button class="btn btn-secondary" [disabled]="saving()" (click)="pause('indefinite')">Indefinitely</button>
          </div>
        </div>

        <div class="card panel unsubscribe-panel">
          <h3 class="section-title">Unsubscribe</h3>
          <p class="meta">
            Stops the weekly check-ins for good. Clearly separate from deleting anything — your account,
            profile, and everything you've shared stay exactly as they are.
          </p>
          <button class="btn btn-tertiary" [disabled]="saving()" (click)="unsubscribe()">Unsubscribe from check-ins</button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .page {
        padding: 3rem 1.5rem 4rem;
        max-width: 42em;
      }

      .lede {
        color: var(--ink-soft);
        margin-bottom: 2rem;
      }

      .banner {
        margin-bottom: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: flex-start;
      }

      .panel {
        margin-bottom: 1.5rem;
        padding: 1.5rem;
      }

      .section-title {
        margin: 0 0 0.25rem;
      }

      .meta {
        color: var(--ink-soft);
        margin: 0 0 1rem;
      }

      .pace-options {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }

      .pace-option {
        display: grid;
        grid-template-columns: auto 1fr;
        column-gap: 0.6rem;
        align-items: baseline;
        padding: 0.6rem 0.8rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md, 8px);
        cursor: pointer;

        &.selected {
          border-color: var(--brass-strong);
        }
      }

      .pace-label {
        font-weight: 600;
      }

      .pace-desc {
        grid-column: 2;
        color: var(--ink-soft);
        font-size: 0.9em;
      }

      .pause-buttons {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .unsubscribe-panel .btn-tertiary {
        color: var(--ink-soft);
      }

      .error-line {
        color: var(--brick, #a33);
      }
    `
  ]
})
export class ScheduleSettingsComponent implements OnInit {
  state = signal<Progression | null>(null);
  loadError = signal<string | null>(null);
  saving = signal(false);

  readonly paceOptions: { value: PacePreference; label: string; description: string }[] = [
    { value: 'whenever', label: 'Whenever', description: "We'll check in about once a week — no pressure either way." },
    { value: 'one_a_week', label: 'One a week', description: 'Keep it steady, one new question at a time.' },
    { value: 'all_now', label: 'All at once', description: "I'd rather move faster than the default weekly pace." }
  ];

  constructor(private schedule: ScheduleService) {}

  ngOnInit(): void {
    this.reload();
  }

  isPaused(s: Progression): boolean {
    if (s.paused_indefinitely) return true;
    if (!s.paused_until) return false;
    return new Date(s.paused_until).getTime() > Date.now();
  }

  private reload(): void {
    this.schedule.getState().subscribe({
      next: (s) => {
        this.state.set(s);
        this.loadError.set(null);
      },
      error: () => this.loadError.set("Couldn't load your check-in settings.")
    });
  }

  setPace(pace: PacePreference): void {
    this.run(this.schedule.setPace(pace));
  }

  pause(duration: PauseDuration): void {
    this.run(this.schedule.pause(duration));
  }

  resume(): void {
    this.run(this.schedule.resume());
  }

  unsubscribe(): void {
    this.run(this.schedule.unsubscribe());
  }

  private run(action: ReturnType<ScheduleService['getState']>): void {
    this.saving.set(true);
    action.subscribe({
      next: (s) => {
        this.state.set(s);
        this.saving.set(false);
      },
      error: () => {
        this.loadError.set("That didn't save — try again.");
        this.saving.set(false);
      }
    });
  }
}
