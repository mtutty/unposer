import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProfileService } from '../../../core/profile/profile.service';
import { FlowService } from '../../../core/flow/flow.service';
import { STEP_ROUTES } from '../../../models/flow.model';
import { GeneratingStatusComponent } from '../../../shared/components/generating-status/generating-status.component';
import { ProfileCorrectionsComponent } from '../../../shared/components/profile-corrections/profile-corrections.component';

@Component({
    selector: 'app-profile-review-step',
    imports: [RouterLink, GeneratingStatusComponent, ProfileCorrectionsComponent],
    template: `
    <span class="eyebrow">Interview Yourself · Your Profile</span>
    <h1>Your profile</h1>

    @if (!profileService.profile()) {
      @if (!profileService.synthesizing()) {
        <p class="lede">
          We'll pull together your resume, your goals, and your stories into one narrative profile.
        </p>
        @if (profileService.synthesisError()) {
          <p class="error-line">{{ profileService.synthesisError() }}</p>
        }
        <button class="btn btn-primary" (click)="generate()">Generate my profile</button>
      }
      <app-generating-status class="top-generating" [active]="profileService.synthesizing()" [stages]="generatingStages" />
    }

    @if (profileService.profile(); as p) {
      @if (!profileService.synthesizing()) {
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
          <div class="card banner banner-brick reask-banner">
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

      @if (p.profile_data.openQuestions.length || profileService.synthesizing()) {
        <h3 class="section-title">Open questions from your practice interview</h3>
      }
      <app-profile-corrections />
    }
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .lede {
        color: var(--ink-soft);
        max-width: 42em;
      }

      .top-generating {
        display: block;
        margin-top: 1.5rem;
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
export class ProfileReviewStepComponent implements OnInit {
  approving = signal(false);
  flaggingId = signal<string | null>(null);
  reaskBanner = signal('');

  deepPromptsRoute = STEP_ROUTES['deep_prompts'];
  sandboxRoute = STEP_ROUTES['sandbox'];
  shareRoute = STEP_ROUTES['share'];

  // Only used for the initial "no profile yet" generate — once a profile exists, the corrections
  // widget owns its own (differently-worded) stages for the apply-corrections case.
  readonly generatingStages: Array<{ afterMs: number; text: string }> = [
    { afterMs: 0, text: 'Pulling together your resume, goals, and stories…' },
    { afterMs: 4000, text: 'Looking for patterns across what you told us…' },
    { afterMs: 12000, text: 'Drafting your narrative summary…' },
    { afterMs: 25000, text: 'Writing up what we noticed, with the evidence behind it…' },
    { afterMs: 45000, text: 'Still working — this one is taking a bit longer than usual…' }
  ];

  constructor(public profileService: ProfileService, private flow: FlowService) {}

  ngOnInit(): void {
    this.profileService.get().subscribe();
  }

  generate(): void {
    if (this.profileService.synthesizing()) return;
    this.profileService.generate().subscribe();
  }

  flag(insightId: string): void {
    this.flaggingId.set(insightId);
    this.profileService.flagInsight(insightId).subscribe({
      next: (result) => {
        this.reaskBanner.set(result.reaskQuestion);
        this.flaggingId.set(null);
        this.flow.loadProgress().subscribe();
      },
      error: () => this.flaggingId.set(null)
    });
  }

  approve(): void {
    this.approving.set(true);
    this.profileService.approve().subscribe({
      next: () => {
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
