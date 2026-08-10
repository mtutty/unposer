import { Component, ChangeDetectionStrategy } from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { FlowService } from '../../../core/flow/flow.service';
import { STEP_ROUTES } from '../../../models/flow.model';

@Component({
    selector: 'app-step-rail',
    imports: [RouterLink, RouterLinkActive],
    template: `
    <nav class="rail" aria-label="Onboarding stages">
      @for (stage of flow.stages(); track stage.id) {
        @let stageState = flow.stageState(stage.id);
        @let active = flow.isActiveStage(stage.id);
        <div class="stage" [class.stage-active]="active">
          <div class="stage-head" [class.stage-done]="stageState === 'complete'">
            <span class="stage-name">{{ stage.name }}</span>
            @if (stageState === 'complete') {
              <span class="stage-seal" aria-hidden="true">✓</span>
            }
          </div>

          @if (active) {
            <div class="substeps">
              @for (step of flow.stepsForStage(stage.id); track step.id) {
                @let state = flow.progress()?.steps_state?.[step.id] ?? 'pending';
                @let reachable = state !== 'pending';
                <a
                  class="tab"
                  [class.tab-current]="state === 'in_progress'"
                  [class.tab-done]="state === 'complete'"
                  [class.tab-locked]="!reachable"
                  [attr.aria-disabled]="!reachable"
                  [routerLink]="reachable ? routes[step.id] : null"
                  routerLinkActive="tab-active"
                >
                  <span class="tab-name">{{ step.name }}</span>
                  @if (state === 'complete') {
                    <span class="tab-seal" aria-hidden="true">✓</span>
                  }
                </a>
              }
            </div>
          }
        </div>
      }
    </nav>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .rail {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
        padding: 1.5rem 0 1.5rem 1rem;
      }

      .stage-head {
        display: flex;
        align-items: center;
        gap: 0.6em;
        padding: 0.65em 0.9em;
        font-family: var(--font-display);
        font-size: 0.92rem;
        font-weight: 600;
        color: var(--paper-text-soft);
      }

      .stage-active .stage-head {
        color: var(--ink);
      }

      .stage-done .stage-name {
        color: var(--paper-text);
      }

      .stage-seal {
        color: var(--sage);
        font-size: 0.8em;
      }

      .stage-active .stage-seal {
        color: var(--sage-strong);
      }

      .substeps {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        margin-top: 0.2rem;
      }

      .tab {
        display: flex;
        align-items: center;
        gap: 0.6em;
        padding: 0.55em 0.9em 0.55em 1.6em;
        border-radius: var(--radius-md) 0 0 var(--radius-md);
        color: var(--paper-text-soft);
        text-decoration: none;
        font-family: var(--font-display);
        font-size: 0.85rem;
        font-weight: 500;
        border: 1px solid transparent;
        border-right: none;
        transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
      }

      .tab-locked {
        opacity: 0.4;
        cursor: default;
        pointer-events: none;
      }

      .tab:not(.tab-locked):hover {
        background: var(--cover-3);
        color: var(--paper-text);
      }

      .tab-current,
      .tab-active {
        background: var(--page);
        color: var(--ink);
        transform: translateX(-2px);
      }

      .tab-done:not(.tab-active) {
        color: var(--paper-text);
      }

      .tab-seal {
        margin-left: auto;
        color: var(--sage);
        font-size: 0.8em;
      }

      .tab-current .tab-seal,
      .tab-active .tab-seal {
        color: var(--sage-strong);
      }
    `
    ]
})
export class StepRailComponent {
  routes = STEP_ROUTES;
  constructor(public flow: FlowService) {}
}
