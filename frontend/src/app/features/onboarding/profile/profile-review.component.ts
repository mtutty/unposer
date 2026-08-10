import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
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
      <p class="meta">Writing your profile…</p>
    }

    @if (profile(); as p) {
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
        <ul class="open-questions">
          @for (q of p.profile_data.openQuestions; track q.id) {
            <li>{{ q.note }}</li>
          }
        </ul>
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
  profile = signal<CandidateProfile | null>(null);
  generating = signal(false);
  approving = signal(false);
  genError = signal('');
  flaggingId = signal<string | null>(null);
  reaskBanner = signal('');

  deepPromptsRoute = STEP_ROUTES['deep_prompts'];
  sandboxRoute = STEP_ROUTES['sandbox'];
  shareRoute = STEP_ROUTES['share'];

  constructor(private profileService: ProfileService, private flow: FlowService) {}

  ngOnInit(): void {
    this.profileService.get().subscribe((p) => this.profile.set(p));
  }

  generate(): void {
    this.generating.set(true);
    this.genError.set('');
    this.profileService.generate().subscribe({
      next: (p) => {
        this.profile.set(p);
        this.generating.set(false);
      },
      error: (err) => {
        this.genError.set(err.error?.error?.message || 'Could not generate a profile yet');
        this.generating.set(false);
      }
    });
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
