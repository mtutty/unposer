import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { StepIconComponent } from '../../shared/components/step-icon/step-icon.component';
import { FlowService } from '../../core/flow/flow.service';
import { AuthService } from '../../core/auth/auth.service';
import { FlowProgress, FlowStageId, FlowStepId, STEP_ROUTES, StepStatus } from '../../models/flow.model';

@Component({
    selector: 'app-dashboard',
    imports: [TopbarComponent, RouterLink, StepIconComponent],
    template: `
    <app-topbar />

    <div class="container page">
      <span class="eyebrow">Your profile</span>
      <h1>Welcome back, {{ auth.currentUser()?.name }}</h1>
      <p class="lede">
        Two stages, your pace. Logistics can go by chat or by email — pick up wherever you left off.
      </p>

      @if (flow.progress(); as progress) {
        <ol class="stages">
          @for (stage of flow.stages(); track stage.id) {
            @let stageState = flow.stageState(stage.id);
            @let isActive = flow.isActiveStage(stage.id);
            @let destination = cardDestination(stage.id, progress, stageState, isActive);
            <li
              class="stage-row"
              [class.done]="stageState === 'complete'"
              [class.locked]="stageState === 'pending'"
              [class.clickable]="!!destination"
              [routerLink]="destination ? routes[destination] : null"
              [attr.tabindex]="destination ? 0 : null"
              [attr.role]="destination ? 'link' : null"
              (keydown.enter)="destination && activateOnEnter($event)"
            >
              <span class="stamp" [class.stamp-brass]="stageState === 'complete'" [class.stamp-muted]="stageState === 'pending'">
                {{ stageState === 'complete' ? 'done' : stageState === 'in_progress' ? 'in progress' : 'not yet' }}
              </span>
              <div class="stage-copy">
                <h3>{{ stage.name }}</h3>
                <p class="meta">{{ stage.description }}</p>
                <ol class="substeps">
                  @for (step of flow.stepsForStage(stage.id); track step.id) {
                    @let state = progress.steps_state[step.id];
                    <li
                      class="substep"
                      [class.substep-complete]="state === 'complete'"
                      [class.substep-current]="state === 'in_progress'"
                      [class.substep-pending]="state === 'pending'"
                    >
                      @if (state !== 'pending') {
                        <a
                          class="bubble"
                          [routerLink]="routes[step.id]"
                          (click)="$event.stopPropagation()"
                          [attr.aria-label]="step.name + ' — ' + (state === 'complete' ? 'done' : 'in progress')"
                        >
                          @if (state === 'complete') {
                            <span aria-hidden="true">✓</span>
                          } @else {
                            <app-step-icon [stepId]="step.id" />
                          }
                        </a>
                      } @else {
                        <span class="bubble" [attr.aria-label]="step.name + ' — not yet'">
                          <app-step-icon [stepId]="step.id" />
                        </span>
                      }
                      <span class="substep-label">{{ step.name }}</span>
                    </li>
                  }
                </ol>
              </div>
            </li>

            @if (isActive) {
              <li class="connector cta-row">
                <span class="cta-line" aria-hidden="true"></span>
                <a class="btn btn-primary" [routerLink]="routes[progress.current_step]">
                  Continue: {{ currentStepName() }}
                  <svg class="arrow-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M2 8h11M9 4l4 4-4 4" />
                  </svg>
                </a>
              </li>
            }
          }
        </ol>
      }
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .page {
        padding: 3rem 1.5rem 4rem;
      }

      .lede {
        color: var(--ink-soft);
        max-width: 40em;
      }

      .stages {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .stage-row {
        display: flex;
        align-items: flex-start;
        gap: 1.25rem;
        padding: 1.25rem 1.4rem;
        background: #fff;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        transition: border-color 0.15s ease, box-shadow 0.15s ease;

        &.locked {
          opacity: 0.55;
        }

        &.clickable {
          cursor: pointer;

          &:hover,
          &:focus-visible {
            border-color: var(--brass-strong);
          }

          &:focus-visible {
            outline: 2px solid var(--brass-strong);
            outline-offset: 2px;
          }
        }
      }

      .stage-copy {
        flex: 1;

        h3 {
          margin-bottom: 0.15em;
        }
      }

      .stage-copy > p {
        margin: 0;
      }

      .substeps {
        list-style: none;
        margin: 1.4rem 0 0;
        padding: 0;
        display: flex;
        flex-direction: row;
        align-items: flex-start;
      }

      .substep {
        position: relative;
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.55rem;
        text-align: center;
        min-width: 0;

        &:not(:first-child)::before {
          content: '';
          position: absolute;
          top: 2rem;
          left: -50%;
          width: 100%;
          height: 2px;
          background: var(--border);
          z-index: 0;
        }

        &.substep-complete:not(:first-child)::before,
        &.substep-current:not(:first-child)::before {
          background: var(--brass-strong);
        }
      }

      .bubble {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 4rem;
        height: 4rem;
        border-radius: 50%;
        font-family: var(--font-mono);
        font-size: 1.6rem;
        font-weight: 600;
        border: 3px solid var(--border);
        background: #fff;
        color: var(--pencil);
        text-decoration: none;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
      }

      a.bubble:hover {
        transform: scale(1.1);
        border-color: var(--brass-strong);
      }

      .substep-current .bubble {
        background: var(--sage);
        border-color: var(--sage-strong);
        color: var(--paper-text);
      }

      .substep-complete .bubble {
        background: var(--brass);
        border-color: var(--brass-strong);
        color: var(--ink);
      }

      .substep-label {
        font-size: 1rem;
        color: var(--pencil);
        line-height: 1.25;
      }

      .substep-current .substep-label {
        color: var(--ink);
        font-weight: 600;
      }

      .substep-complete .substep-label {
        color: var(--ink-soft);
      }

      // Layout (flex/gap) and the line/arrow come from the global .cta-row/.cta-line/.arrow-icon
      // primitives — this just adds the padding specific to sitting inside the stage list.
      .connector {
        padding: 0.15rem 0.4rem;
      }
    `
    ]
})
export class DashboardComponent implements OnInit {
  routes = STEP_ROUTES;

  constructor(public flow: FlowService, public auth: AuthService) {}

  ngOnInit(): void {
    forkJoin([this.flow.loadSteps(), this.flow.loadProgress()]).subscribe();
  }

  currentStepName(): string {
    const id = this.flow.progress()?.current_step;
    return this.flow.steps().find((s) => s.id === id)?.name ?? '';
  }

  /** Where clicking anywhere on a stage card goes: the active stage's current step, or the
   *  first rail-visible step of a completed stage for review. Locked (pending) stages aren't
   *  clickable at all — nothing in them is reachable yet. */
  cardDestination(stageId: FlowStageId, progress: FlowProgress, stageState: StepStatus, isActive: boolean): FlowStepId | null {
    if (isActive) return progress.current_step;
    if (stageState === 'complete') return this.flow.stepsForStage(stageId)[0]?.id ?? null;
    return null;
  }

  /** Keyboard activation for the card (a routerLink-decorated <li> has no native Enter handling). */
  activateOnEnter(event: Event): void {
    (event.currentTarget as HTMLElement).click();
  }
}
