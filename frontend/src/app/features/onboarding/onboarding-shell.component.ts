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
      // Previously "height: 100%" with .notebook/.page-col hardcoding the topbar's height as a
      // literal "64px" in a calc() below. That number was stale — app-topbar's real rendered
      // height is ~91px once its user/nav block's content and padding are accounted for (measured
      // live: 91px, not 64px) — so page-col was handed 27px more room than actually existed below
      // the topbar, and the page grew exactly that much taller than the viewport (the "page is
      // 20-40px too tall" bug — the topbar's height, not chat-frame's sizing, was the actual
      // culprit; see the flex-basis fix elsewhere for the *other*, real bug that commit fixed).
      // Making :host itself the flex column that includes app-topbar removes the magic number
      // entirely: .notebook just gets flex:1 of whatever's actually left, so this can never drift
      // out of sync with the topbar's real height again, at any viewport width.
      :host {
        display: flex;
        flex-direction: column;
        height: 100dvh;
      }

      .notebook {
        display: grid;
        grid-template-columns: 220px 1fr;
        flex: 1;
        min-height: 0;
        background: var(--cover);
      }

      .page-col {
        background: var(--page);
        border-radius: var(--radius-lg) 0 0 0;
        margin: 1.5rem 0 0;
        padding: 2.5rem clamp(1.5rem, 4vw, 3.5rem);
        box-shadow: var(--shadow-cover);
        // No explicit height — .notebook's grid row has a real definite height (from :host/
        // .notebook's flex chain above) and align-self's default stretch sizes this grid item to
        // fill it (minus this rule's own margin-top), so a step with a growing chat thread can
        // still hand its scrollable child a real bound to fill and shrink within — see chat-
        // panel's :host, which relies on this chain to keep .thread as the only thing that
        // scrolls. overflow-y here is the fallback for step content that's simply taller than the
        // viewport and has no internal scroll region of its own (e.g. a long profile) — it scrolls
        // here instead of growing body.
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
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
