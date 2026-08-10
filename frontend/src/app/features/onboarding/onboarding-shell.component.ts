import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { StepRailComponent } from '../../shared/components/step-rail/step-rail.component';
import { FlowService } from '../../core/flow/flow.service';

@Component({
    selector: 'app-onboarding-shell',
    imports: [RouterOutlet, TopbarComponent, StepRailComponent],
    template: `
    <app-topbar />
    <div class="notebook">
      <app-step-rail class="rail-col" />
      <main class="page-col">
        <router-outlet />
      </main>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      :host {
        display: block;
        height: 100%;
      }

      .notebook {
        display: grid;
        grid-template-columns: 220px 1fr;
        min-height: calc(100% - 64px);
        background: var(--cover);
      }

      .page-col {
        background: var(--page);
        border-radius: var(--radius-lg) 0 0 0;
        margin: 1.5rem 0 0;
        padding: 2.5rem clamp(1.5rem, 4vw, 3.5rem);
        box-shadow: var(--shadow-cover);
        min-height: calc(100vh - 64px - 1.5rem);
        display: flex;
        flex-direction: column;
      }

      @media (max-width: 720px) {
        .notebook {
          grid-template-columns: 1fr;
        }

        .rail-col {
          display: none;
        }

        .page-col {
          margin: 0;
          border-radius: 0;
        }
      }
    `
    ]
})
export class OnboardingShellComponent implements OnInit {
  constructor(private flow: FlowService) {}

  ngOnInit(): void {
    forkJoin([this.flow.loadSteps(), this.flow.loadProgress()]).subscribe();
  }
}
