import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { FlowStepId } from '../../../models/flow.model';

/**
 * A small monochrome glyph per onboarding step — stands in for numbering wherever a step needs
 * a compact visual identity (e.g. the dashboard's sub-step bubbles). Uses currentColor so it
 * inherits whatever fill/text color its container sets per status, and stays legible at bubble
 * scale instead of leaning on emoji rendering, which varies by OS and clashes with the app's
 * controlled "notebook" palette.
 */
@Component({
    selector: 'app-step-icon',
    template: `
    <svg viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (stepId) {
        @case ('resume') {
          <path d="M4 1.5h5.5L12 4v10a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 14V2a.5.5 0 0 1 .5-.5z" />
          <path d="M9.5 1.5V4H12" />
          <path d="M6 7.5h4M6 9.5h4M6 11.5h2.5" />
        }
        @case ('logistics') {
          <circle cx="8" cy="8" r="6" />
          <path d="M10.4 5.6 8.8 8.8 5.6 10.4 7.2 7.2z" />
        }
        @case ('deep_prompts') {
          <path d="M2 3.5h12v7H6.5L4 13v-2.5H2z" />
        }
        @case ('profile_review') {
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
        }
        @case ('sandbox') {
          <rect x="6" y="1.5" width="4" height="7" rx="2" />
          <path d="M4 7.5a4 4 0 0 0 8 0M8 11.5v2.5M6 14h4" />
        }
        @case ('share') {
          <circle cx="4" cy="8" r="1.8" />
          <circle cx="12" cy="3.5" r="1.8" />
          <circle cx="12" cy="12.5" r="1.8" />
          <path d="M5.6 7.1 10.4 4.4M5.6 8.9 10.4 11.6" />
        }
      }
    </svg>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      :host {
        display: inline-flex;
      }
    `
    ]
})
export class StepIconComponent {
  @Input() stepId!: FlowStepId;
}
