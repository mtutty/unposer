import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProfileService } from '../../../core/profile/profile.service';
import { GeneratingStatusComponent } from '../generating-status/generating-status.component';

/**
 * Step 7 -> Step 6 feedback loop, wherever the candidate encounters it: the sandbox chat
 * (features/onboarding/sandbox/sandbox.component.ts) and the profile page's "Open questions from
 * your practice interview" section (features/onboarding/profile/profile-review.component.ts) both
 * drop this in rather than each keeping their own copy of the bar/spinner/banner. Self-fetching
 * style like StoryTrackerComponent — reads ProfileService's shared signals directly rather than
 * taking the count/profile as inputs, since the whole point is one source of truth both pages see.
 */
@Component({
  selector: 'app-profile-corrections',
  imports: [RouterLink, GeneratingStatusComponent],
  template: `
    @if (profileService.profile(); as p) {
      @if (profileService.synthesizing()) {
        <app-generating-status [active]="true" [stages]="stages" />
      } @else if (profileService.pendingCorrectionCount() > 0) {
        <div class="card banner corrections-bar">
          <div class="corrections-copy">
            <p class="corrections-count">
              You've flagged {{ profileService.pendingCorrectionCount() }} answer{{ profileService.pendingCorrectionCount() === 1 ? '' : 's' }} as not quite right.
            </p>
            <p>{{ explainerText }}</p>
            @if (showList) {
              <ul class="open-questions">
                @for (q of p.profile_data.openQuestions; track q.id) {
                  <li>{{ q.note }}</li>
                }
              </ul>
            }
          </div>
          <button class="btn btn-primary" (click)="apply()">Apply my edits</button>
        </div>
      }

      @if (profileService.synthesisError()) {
        <p class="error-line">{{ profileService.synthesisError() }}</p>
      }

      @if (profileService.correctionsBanner()) {
        <div class="card banner applied-banner">
          <p>{{ profileService.correctionsBanner() }}</p>
          @if (bannerLink) {
            <a class="btn btn-secondary" [routerLink]="bannerLink">{{ bannerLinkLabel }}</a>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .corrections-bar,
      .applied-banner {
        margin-top: 1.5rem;
      }

      .corrections-copy {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .corrections-count {
        font-weight: 600;
      }

      .open-questions {
        color: var(--ink-soft);
        margin: 0;
      }

      .error-line {
        color: var(--brick-strong);
        font-size: 0.85rem;
        margin: 0.5rem 0 0;
      }
    `
  ]
})
export class ProfileCorrectionsComponent {
  // profile-review wants the note list inline; sandbox doesn't — the notes are already shown
  // inline under each flagged message in the transcript itself.
  @Input() showList = true;
  @Input() explainerText =
    'Apply them to fold your corrections straight into the profile — you can keep flagging more ' +
    'and applying again anytime.';
  // Sandbox passes STEP_ROUTES['profile_review'] here since it isn't already on that page;
  // profile-review leaves this null since the updated profile is already right there.
  @Input() bannerLink: string | null = null;
  @Input() bannerLinkLabel = 'See your updated profile';
  // Fires only on a successful apply — lets sandbox refetch its message history once flags are
  // cleared server-side (see ProfileService.applyGapCorrections).
  @Output() applied = new EventEmitter<void>();

  readonly stages: Array<{ afterMs: number; text: string }> = [
    { afterMs: 0, text: 'Pulling together your resume, goals, and stories…' },
    { afterMs: 4000, text: 'Reconciling your corrections with the rest of your profile…' },
    { afterMs: 12000, text: 'Drafting your updated narrative summary…' },
    { afterMs: 25000, text: 'Writing up what we noticed, with the evidence behind it…' },
    { afterMs: 45000, text: 'Still working — this one is taking a bit longer than usual…' }
  ];

  constructor(public profileService: ProfileService) {}

  apply(): void {
    if (this.profileService.synthesizing()) return;
    this.profileService.applyCorrections().subscribe(() => this.applied.emit());
  }
}
