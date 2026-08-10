import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatPanelComponent } from '../../../shared/components/chat-panel/chat-panel.component';
import { FlowService } from '../../../core/flow/flow.service';
import { STEP_ROUTES } from '../../../models/flow.model';

@Component({
    selector: 'app-deep-prompts-step',
    imports: [ChatPanelComponent, RouterLink],
    template: `
    <span class="eyebrow">Tell Your Story · Your Stories — live chat only</span>
    <h1>Your stories</h1>
    <p class="lede">
      A few open-ended questions — tell me about times things happened, not how you'd rate
      yourself. The stories carry the signal; there's nothing to score.
    </p>

    <div class="chat-frame card">
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

  constructor(private flow: FlowService) {}

  onComplete(): void {
    this.flow.loadProgress().subscribe();
  }
}
