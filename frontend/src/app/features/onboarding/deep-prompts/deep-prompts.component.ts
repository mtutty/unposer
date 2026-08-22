import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatPanelComponent } from '../../../shared/components/chat-panel/chat-panel.component';
import { StoryTrackerComponent } from '../../../shared/components/story-tracker/story-tracker.component';
import { FlowService } from '../../../core/flow/flow.service';
import { DeepPromptsService } from '../../../core/deep-prompts/deep-prompts.service';
import { STEP_ROUTES } from '../../../models/flow.model';

@Component({
    selector: 'app-deep-prompts-step',
    imports: [ChatPanelComponent, StoryTrackerComponent, RouterLink],
    template: `
    <span class="eyebrow">Tell Your Story · Your Stories</span>
    <h1>Your stories</h1>
    <p class="lede">
      A few open-ended questions — tell me about times things happened, not how you'd rate
      yourself. The stories carry the signal; there's nothing to score.
    </p>

    <div class="email-switch">
      @if (emailSwitchConfirmation()) {
        <p class="meta confirmation">{{ emailSwitchConfirmation() }}</p>
      } @else {
        <button class="btn btn-ghost" (click)="switchToEmail()" [disabled]="switchingToEmail()">
          {{ switchingToEmail() ? 'Sending…' : 'Continue this by email instead' }}
        </button>
      }
      @if (emailSwitchError()) {
        <p class="error-line">{{ emailSwitchError() }}</p>
      }
    </div>

    <app-story-tracker />

    <div class="chat-frame">
      <app-chat-panel step="deep_prompts" (completeChange)="onComplete()">
        <a doneAction class="btn btn-secondary" [routerLink]="nextRoute">Review your profile</a>
      </app-chat-panel>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .lede {
        color: var(--ink-soft);
        max-width: 42em;
      }

      .email-switch {
        margin-top: 1rem;
      }

      .confirmation {
        color: var(--sage-strong, var(--ink-soft));
      }

      .chat-frame {
        margin-top: 1.5rem;
        padding: 1.5rem;
        flex: 1;
        display: flex;
        min-height: 460px;
      }
    `
    ]
})
export class DeepPromptsStepComponent {
  nextRoute = STEP_ROUTES['profile_review'];
  switchingToEmail = signal(false);
  emailSwitchConfirmation = signal('');
  emailSwitchError = signal('');

  constructor(private flow: FlowService, private deepPrompts: DeepPromptsService) {}

  onComplete(): void {
    this.flow.loadProgress().subscribe();
  }

  switchToEmail(): void {
    this.switchingToEmail.set(true);
    this.emailSwitchError.set('');
    this.deepPrompts.switchToEmail().subscribe({
      next: () => {
        this.switchingToEmail.set(false);
        this.emailSwitchConfirmation.set("We've emailed you this question — reply whenever it's convenient, or keep going here.");
      },
      error: (err) => {
        this.switchingToEmail.set(false);
        this.emailSwitchError.set(err.error?.error?.message || "Couldn't send that email — try again in a moment.");
      }
    });
  }
}
