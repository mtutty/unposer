import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

/**
 * The per-area glyph, factored out of area-tracker so the same icon set can be reused wherever an
 * info-area needs a visual identity outside the glyph row itself — currently the chat panel's
 * extraction log (see ChatPanelComponent) and the vertical area list (see AreaListComponent).
 * `areaId` values come from backend/src/models/logistics-areas.ts; unrecognized ids simply render
 * an empty (but sized) svg rather than throwing.
 */
@Component({
    selector: 'app-area-glyph',
    template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (areaId) {
        @case ('resumeBackground') {
          <path d="M4.1 3h5.8l2 2v7.8a.5.5 0 0 1-.5.5H4.6a.5.5 0 0 1-.5-.5V3.5a.5.5 0 0 1 .5-.5z" />
          <path d="M9.9 3v2h2" />
          <path d="M5.1 7.2h5.8M5.1 8.9h5.8M5.1 10.6h4" />
        }
        @case ('motivation') {
          <g transform="translate(-4,-0.625) scale(1.5)">
            <path
              d="M8 1.6c1.2 1.9 2.6 3.2 2.6 5.7a2.6 2.6 0 1 1-5.2 0c0-.9.35-1.6.8-2.2.25.85.85 1.1 1.05.4-.3-1.4-.9-2.3.75-3.9z"
              vector-effect="non-scaling-stroke"
            />
          </g>
        }
        @case ('targetRolesIndustries') {
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="3" />
          <circle cx="8" cy="8" r="0.6" fill="currentColor" stroke="none" />
        }
        @case ('jobLevel') {
          <path d="M2.5 13.5h11" />
          <path d="M4 13.5V10M8 13.5V6.5M12 13.5V3" />
        }
        @case ('locationPreference') {
          <path d="M8 14.3S3.2 9.7 3.2 6.3a4.8 4.8 0 0 1 9.6 0c0 3.4-4.8 8-4.8 8z" />
          <circle cx="8" cy="6.2" r="1.6" />
        }
        @case ('timeframe') {
          <rect x="2.5" y="4" width="11" height="10" rx="1.5" />
          <path d="M5.5 2.5v3M10.5 2.5v3" />
          <path d="M2.5 7h11" />
          <circle cx="6" cy="10" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="10" cy="10" r="0.6" fill="currentColor" stroke="none" />
        }
        @case ('salaryRange') {
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5v7" />
          <path d="M10.1 6.1c0-.85-.95-1.5-2.1-1.5s-2.1.6-2.1 1.45c0 1.95 4.2.95 4.2 2.9 0 .85-.95 1.45-2.1 1.45s-2.1-.65-2.1-1.5" />
        }
        @case ('priorities') {
          <path d="M8 1.9l1.8 3.65 4 .58-2.9 2.83.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.83 4-.58z" />
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

      svg {
        display: block;
      }
    `
    ]
})
export class AreaGlyphComponent {
  @Input({ required: true }) areaId!: string;
  @Input() size = 32;
}
