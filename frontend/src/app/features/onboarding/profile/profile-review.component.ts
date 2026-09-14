import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProfileService } from '../../../core/profile/profile.service';
import { CandidateProfile } from '../../../models/profile.model';
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

    @if (profileService.profile()) {
      @if (profileService.progression(); as prog) {
        @if (prog.tier !== 'none') {
          <div class="card banner more-questions">
            <p>
              @if (prog.singleSessionDimensions.length) {
                Based on one session so far — this will sharpen as you share more, especially across different days.
              } @else {
                Want to sharpen this further? A few more stories go a long way.
              }
            </p>
            <a class="btn btn-secondary" [routerLink]="deepPromptsRoute">Answer one more question</a>
          </div>
        }
      }
    }

    @if (!profileService.profile()) {
      @if (!profileService.synthesizing()) {
        @if (profileService.synthesisError()) {
          <p class="error-line">{{ profileService.synthesisError() }}</p>
        }
        <div class="option-stack">
          @if (profileService.progression(); as prog) {
            @if (prog.tier !== 'none') {
              <div class="card option-card">
                <div class="option-text">
                  <h4>Add another story</h4>
                  <p>{{ storiesPrompt(prog.topicsCompleted, prog.singleSessionDimensions.length > 0) }}</p>
                </div>
                <a class="btn btn-secondary" [routerLink]="deepPromptsRoute">Answer one more question</a>
              </div>
            }
          }

          <div class="card option-card option-preferred">
            <div class="option-text">
              <h4>See your profile</h4>
              <p>We'll pull together your resume, your goals, and your stories into one narrative profile.</p>
            </div>
            <button class="btn btn-primary" (click)="generate()">View my profile</button>
          </div>
        </div>
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
        <p class="meta">
          Inferred from your stories — never from a rating. Flag anything that doesn't sound like you.
          <a routerLink="/how-your-profile-works" target="_blank" rel="noopener">How this works</a>
        </p>
        <div class="insight-list">
          @for (insight of p.profile_data.insights; track insight.id) {
            <div class="card insight" [class.flagged]="insight.status === 'flagged'">
              <span class="eyebrow">{{ insight.category.replace('_', ' ') }}</span>
              <p class="statement">{{ insight.statement }}</p>
              <p class="meta evidence">"{{ insight.evidence }}"</p>
              @if (insight.status === 'active') {
                <button class="btn btn-ghost refine" (click)="flag(insight.id)" [disabled]="flaggingId() === insight.id">
                  {{ flaggingId() === insight.id ? 'Sending a follow-up…' : 'Refine this' }}
                </button>
              } @else if (insight.status === 'flagged') {
                <span class="stamp stamp-brick">Follow-up sent</span>
                @if (reaskQuestionFor(p, insight.id); as question) {
                  <p class="reask-question">We asked in your stories chat: <em>"{{ question }}"</em></p>
                  <a class="btn btn-secondary" [routerLink]="deepPromptsRoute">Answer it now</a>
                }
              }
            </div>
          }
        </div>

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
      .option-stack {
        margin-top: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .option-card {
        padding: 1.5rem 1.75rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
        flex-wrap: wrap;
      }

      .option-preferred {
        border-left: 3px solid var(--brass-strong);
      }

      .option-text {
        flex: 1;
        min-width: 220px;

        h4 {
          font-size: 1.05rem;
          margin-bottom: 0.3em;
        }

        p {
          margin: 0;
          color: var(--ink-soft);
        }
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
      }

      // Flagged still has a live next step (answer the follow-up) — dim the now-superseded
      // statement/evidence, but not the whole card, so that action doesn't read as inert.
      .insight.flagged {
        .statement,
        .evidence {
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

      // Muted, not alarmed — this is "tune this up," not "this is wrong."
      .refine {
        color: var(--ink-soft);

        &:hover:not(:disabled) {
          color: var(--ink);
        }
      }

      .reask-question {
        margin: 0.6rem 0 0;
        font-size: 0.88rem;
        color: var(--ink-soft);

        em {
          color: var(--ink);
          font-style: italic;
        }
      }

      .more-questions {
        margin-top: 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;

        p {
          margin: 0;
          color: var(--ink-soft);
        }
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
    this.profileService.loadProgression().subscribe();
  }

  generate(): void {
    if (this.profileService.synthesizing()) return;
    this.profileService.generate().subscribe();
  }

  flag(insightId: string): void {
    this.flaggingId.set(insightId);
    this.profileService.flagInsight(insightId).subscribe({
      next: () => {
        this.flaggingId.set(null);
        this.flow.loadProgress().subscribe();
      },
      error: () => this.flaggingId.set(null)
    });
  }

  // Reads the question straight off the persisted profile (correction_log) rather than
  // component state, so it survives a reload/revisit — not just the moment right after flagging —
  // and stays correctly paired with its insight even if more than one is flagged at once.
  reaskQuestionFor(p: CandidateProfile, insightId: string): string | null {
    const entries = p.correction_log?.filter((c) => c.insightId === insightId) ?? [];
    return entries.length ? entries[entries.length - 1].reaskQuestion : null;
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

  storiesLabel(count: number): string {
    const n = count ?? 0;
    return `${n} ${n === 1 ? 'story' : 'stories'}`;
  }

  // Bands tuned to the personality engine's own milestones (spec §3.5): 3-5 is roughly where the
  // first dimensions start crossing medium confidence, 6-9 is mid-way through all 11, 10+ is
  // past "sketch" territory where volume stops being the bottleneck and same-day-only evidence
  // (singleSession) becomes the more useful thing to fix — see progression.service.ts.
  storiesPrompt(count: number, singleSession: boolean): string {
    const n = count ?? 0;
    const shared = this.storiesLabel(n);

    if (n <= 2) {
      return `You've shared ${shared} so far — every one helps us build a fuller picture. A few more go a long way toward a sharper profile.`;
    }
    if (n <= 5) {
      return (
        `You've shared ${shared} so far — good progress. A few more will round out the areas we haven't heard much about yet` +
        (singleSession ? ', especially if one comes from a different day than the rest.' : '.')
      );
    }
    if (n <= 9) {
      return (
        `You've shared ${shared} so far — we're getting a well-rounded picture. A couple more would help us reach full confidence across the board` +
        (singleSession ? ', particularly one from a different day — right now they all came from one sitting.' : '.')
      );
    }
    return singleSession
      ? `You've shared ${shared} so far — that's a rich set. They've all come from one sitting though, so at this point a story from a different day will sharpen your profile more than another one today.`
      : `You've shared ${shared} so far — that's a rich, well-rounded set. Add another any time something comes to mind, but your profile already has plenty to work with.`;
  }
}
