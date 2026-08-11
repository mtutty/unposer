import { Component, OnInit, OnDestroy, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProfileService } from '../../../core/profile/profile.service';
import { FlowService } from '../../../core/flow/flow.service';
import { CandidateProfile } from '../../../models/profile.model';
import { STEP_ROUTES } from '../../../models/flow.model';

@Component({
    selector: 'app-profile-review-step',
    imports: [RouterLink],
    template: `
    <span class="eyebrow">Interview Yourself · Your Profile</span>
    <h1>Your profile</h1>

    @if (!profile() && !generating()) {
      <p class="lede">
        We'll pull together your resume, your goals, and your stories into one narrative profile.
      </p>
      @if (genError()) {
        <p class="error-line">{{ genError() }}</p>
      }
      <button class="btn btn-primary" (click)="generate()">Generate my profile</button>
    }

    @if (generating()) {
      <div class="generating-status">
        <span class="spinner" aria-hidden="true"></span>
        <div class="generating-copy">
          <p class="generating-line" aria-live="polite">{{ generatingStatus() }}</p>
          <p class="meta generating-estimate">Usually takes about a minute.</p>
        </div>
      </div>
    }

    @if (profile(); as p) {
      @if (!generating()) {
        <div class="card panel">
          <span class="stamp" [class.stamp-brass]="p.status === 'approved'">{{ statusLabel(p.status) }}</span>
          <h2>{{ p.profile_data.headline }}</h2>
          <p>{{ p.profile_data.summary }}</p>
        </div>

        <h3 class="section-title">What we picked up on</h3>
        <p class="meta">Inferred from your stories — never from a rating. Flag anything that doesn't sound like you.</p>
        <div class="insight-list">
          @for (insight of p.profile_data.insights; track insight.id) {
            <div class="card insight" [class.flagged]="insight.status === 'flagged'">
              <span class="eyebrow">{{ insight.category.replace('_', ' ') }}</span>
              <p class="statement">{{ insight.statement }}</p>
              <p class="meta evidence">"{{ insight.evidence }}"</p>
              @if (insight.status === 'active') {
                <button class="btn btn-ghost" (click)="flag(insight.id)" [disabled]="flaggingId() === insight.id">
                  {{ flaggingId() === insight.id ? 'Sending a follow-up…' : 'Not quite right' }}
                </button>
              } @else if (insight.status === 'flagged') {
                <span class="stamp stamp-brick">Follow-up sent</span>
              }
            </div>
          }
        </div>

        @if (reaskBanner()) {
          <div class="card reask-banner">
            <p>We sent a follow-up question to your stories chat: <em>"{{ reaskBanner() }}"</em></p>
            <a class="btn btn-secondary" [routerLink]="deepPromptsRoute">Answer it now</a>
          </div>
        }

        <h3 class="section-title">Work style &amp; goals</h3>
        <div class="grid-2">
          <div class="card facts">
            <h4>Work style</h4>
            <p><strong>Environment:</strong> {{ p.profile_data.workStyle.preferredEnvironment }}</p>
            <p><strong>Team dynamics:</strong> {{ p.profile_data.workStyle.teamDynamics }}</p>
            <p><strong>Communication:</strong> {{ p.profile_data.workStyle.communicationStyle }}</p>
          </div>
          <div class="card facts">
            <h4>Goals</h4>
            <p><strong>Short-term:</strong> {{ p.profile_data.goals.shortTerm }}</p>
            <p><strong>Long-term:</strong> {{ p.profile_data.goals.longTerm }}</p>
            <p><strong>Ideal next role:</strong> {{ p.profile_data.goals.idealNextRole }}</p>
          </div>
        </div>

        @if (p.profile_data.openQuestions.length) {
          <h3 class="section-title">Open questions from your practice interview</h3>
          <p class="meta">
            These came from flagging an answer as not quite right while practicing in the sandbox.
            Apply them to fold your corrections straight into the profile — you can keep flagging
            more and applying again anytime, whenever you're ready.
          </p>
          <ul class="open-questions">
            @for (q of p.profile_data.openQuestions; track q.id) {
              <li>{{ q.note }}</li>
            }
          </ul>
          <button class="btn btn-primary apply-corrections" (click)="applyCorrections()">Apply my edits</button>
          @if (applyError()) {
            <p class="error-line">{{ applyError() }}</p>
          }
        }

        @if (appliedBanner()) {
          <div class="card applied-banner">
            <p>{{ appliedBanner() }}</p>
          </div>
        }

        @if (p.status !== 'approved') {
          <button class="btn btn-primary approve" (click)="approve()" [disabled]="approving()">
            {{ approving() ? 'Approving…' : 'Approve this profile' }}
          </button>
        } @else {
          <div class="post-approve-actions">
            <a class="btn btn-primary" [routerLink]="sandboxRoute">Try the practice interview</a>
            <a class="btn btn-secondary" [routerLink]="shareRoute">Get your share link</a>
          </div>
        }
      }
    }
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .lede {
        color: var(--ink-soft);
        max-width: 42em;
      }

      .generating-status {
        display: flex;
        align-items: center;
        gap: 0.9rem;
        margin-top: 1.5rem;
      }

      .spinner {
        flex-shrink: 0;
        width: 1.6rem;
        height: 1.6rem;
        border-radius: 50%;
        border: 3px solid var(--border);
        border-top-color: var(--brass-strong);
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .generating-copy {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }

      .generating-line {
        margin: 0;
        font-weight: 600;
        color: var(--ink);
      }

      .generating-estimate {
        margin: 0;
        font-size: 0.78rem;
      }

      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation: none;
        }
      }

      .panel {
        margin-top: 1.25rem;
        padding: 1.75rem;
      }

      .section-title {
        margin-top: 2rem;
      }

      .insight-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 1rem;
      }

      .insight {
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;

        &.flagged {
          opacity: 0.7;
        }
      }

      .statement {
        font-weight: 600;
        margin: 0;
      }

      .evidence {
        font-style: italic;
      }

      .reask-banner {
        margin-top: 1.25rem;
        padding: 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border-left: 3px solid var(--brick-strong);
      }

      .grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }

      .facts {
        padding: 1.25rem;

        p {
          margin: 0.35em 0;
          font-size: 0.92rem;
        }
      }

      .open-questions {
        color: var(--ink-soft);
      }

      .apply-corrections {
        margin-top: 0.75rem;
      }

      .applied-banner {
        margin-top: 1.25rem;
        padding: 1.25rem;
        border-left: 3px solid var(--brass-strong);

        p {
          margin: 0;
        }
      }

      .approve {
        margin-top: 2rem;
        align-self: flex-start;
      }

      .post-approve-actions {
        margin-top: 2rem;
        align-self: flex-start;
        display: flex;
        gap: 0.9rem;
      }

      @media (max-width: 640px) {
        .grid-2 {
          grid-template-columns: 1fr;
        }
      }
    `
    ]
})
export class ProfileReviewStepComponent implements OnInit, OnDestroy {
  profile = signal<CandidateProfile | null>(null);
  generating = signal(false);
  generatingStatus = signal('');
  approving = signal(false);
  genError = signal('');
  flaggingId = signal<string | null>(null);
  reaskBanner = signal('');
  applyError = signal('');
  appliedBanner = signal('');

  deepPromptsRoute = STEP_ROUTES['deep_prompts'];
  sandboxRoute = STEP_ROUTES['sandbox'];
  shareRoute = STEP_ROUTES['share'];

  // Same idea as the resume step's parsingStages: profile generation is one request with no
  // progress events of its own, so this cycles through plausible stages on a timer purely to keep
  // the ~minute-long wait legible — not a readout of real backend phase transitions.
  private readonly generatingStages: Array<{ afterMs: number; text: string }> = [
    { afterMs: 0, text: 'Pulling together your resume, goals, and stories…' },
    { afterMs: 4000, text: 'Looking for patterns across what you told us…' },
    { afterMs: 12000, text: 'Drafting your narrative summary…' },
    { afterMs: 25000, text: 'Writing up what we noticed, with the evidence behind it…' },
    { afterMs: 45000, text: 'Still working — this one is taking a bit longer than usual…' }
  ];
  private generatingTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(private profileService: ProfileService, private flow: FlowService) {}

  ngOnInit(): void {
    this.profileService.get().subscribe((p) => this.profile.set(p));
  }

  ngOnDestroy(): void {
    this.clearGeneratingStatus();
  }

  generate(): void {
    this.generating.set(true);
    this.genError.set('');
    this.startGeneratingStatus();
    this.profileService.generate().subscribe({
      next: (p) => {
        this.profile.set(p);
        this.generating.set(false);
        this.clearGeneratingStatus();
      },
      error: (err) => {
        this.genError.set(err.error?.error?.message || 'Could not generate a profile yet');
        this.generating.set(false);
        this.clearGeneratingStatus();
      }
    });
  }

  /** Kicks off the staged status-message cycle for the duration of the generate request. */
  private startGeneratingStatus(): void {
    this.clearGeneratingStatus();
    this.generatingStatus.set(this.generatingStages[0].text);
    this.generatingTimers = this.generatingStages
      .slice(1)
      .map((stage) => setTimeout(() => this.generatingStatus.set(stage.text), stage.afterMs));
  }

  private clearGeneratingStatus(): void {
    this.generatingTimers.forEach((timer) => clearTimeout(timer));
    this.generatingTimers = [];
  }

  flag(insightId: string): void {
    this.flaggingId.set(insightId);
    this.profileService.flagInsight(insightId).subscribe({
      next: (result) => {
        this.profile.set(result.profile);
        this.reaskBanner.set(result.reaskQuestion);
        this.flaggingId.set(null);
        this.flow.loadProgress().subscribe();
      },
      error: () => this.flaggingId.set(null)
    });
  }

  applyCorrections(): void {
    if (this.generating()) return;
    this.generating.set(true);
    this.applyError.set('');
    this.appliedBanner.set('');
    this.startGeneratingStatus();

    this.profileService.applyCorrections().subscribe({
      next: ({ profile, appliedCount }) => {
        // Applying regenerates the profile and goes straight back to `approved` — see
        // ProfileService.applyGapCorrections — so there's nothing further to review here.
        this.profile.set(profile);
        this.appliedBanner.set(
          `Your profile has been updated with ${appliedCount} correction${appliedCount === 1 ? '' : 's'}.`
        );
        this.generating.set(false);
        this.clearGeneratingStatus();
      },
      error: (err) => {
        this.applyError.set(err.error?.error?.message || 'Could not apply your corrections — try again.');
        this.generating.set(false);
        this.clearGeneratingStatus();
      }
    });
  }

  approve(): void {
    this.approving.set(true);
    this.profileService.approve().subscribe({
      next: (result) => {
        this.profile.set(result.profile);
        this.approving.set(false);
        this.flow.loadProgress().subscribe();
      },
      error: () => this.approving.set(false)
    });
  }

  statusLabel(status: string): string {
    return status === 'approved' ? 'Approved' : status === 'pending_review' ? 'Ready for review' : 'Draft';
  }
}
