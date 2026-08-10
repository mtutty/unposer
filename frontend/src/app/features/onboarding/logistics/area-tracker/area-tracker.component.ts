import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { InfoArea } from '../../../../models/flow.model';

/**
 * Glyph row for the logistics step's tracked information areas (see backend
 * models/logistics-areas.ts — server-driven, not hardcoded here beyond the icon shapes
 * themselves). Each area fills in visually once `data` has a non-empty value for its id, turning
 * the somewhat-random order topics land in during free-form conversation into a visible
 * checklist — the "gamify completion" ask.
 */
@Component({
    selector: 'app-area-tracker',
    template: `
    <ul class="area-tracker" aria-label="Information we're gathering">
      @for (area of areas; track area.id) {
        @let filled = isFilled(area.id);
        <li class="area-chip" [class.area-filled]="filled" tabindex="0">
          <span class="area-glyph" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              @switch (area.id) {
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
          </span>
          <span class="area-tooltip" role="tooltip">
            <strong>{{ area.label }}</strong>
            <span>{{ area.description }}</span>
          </span>
        </li>
      }
    </ul>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .area-tracker {
        list-style: none;
        margin: 1.25rem 0 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
      }

      .area-chip {
        position: relative;
        width: 4rem;
        height: 4rem;
        border-radius: 50%;
        border: 2px solid var(--border);
        background: #fff;
        color: var(--pencil);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
      }

      .area-filled {
        background: var(--brass);
        border-color: var(--brass-strong);
        color: var(--ink);
      }

      // Centers the svg regardless of inline-element baseline/descender quirks (a bare <span>
      // wrapping an <svg> leaves a few px of line-box space below it, which reads as "off-center"
      // even though the parent .area-chip is itself a centered flex container).
      .area-glyph {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;

        svg {
          display: block;
        }
      }

      .area-tooltip {
        position: absolute;
        bottom: calc(100% + 0.6rem);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
        width: max-content;
        max-width: 13rem;
        background: var(--cover);
        color: var(--paper-text);
        padding: 0.55em 0.8em;
        border-radius: var(--radius-sm);
        font-size: 0.76rem;
        line-height: 1.35;
        display: flex;
        flex-direction: column;
        gap: 0.2em;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
        z-index: 5;

        strong {
          font-family: var(--font-display);
          color: var(--brass);
        }
      }

      .area-chip:hover .area-tooltip,
      .area-chip:focus-visible .area-tooltip {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    `
    ]
})
export class AreaTrackerComponent {
  @Input() areas: InfoArea[] = [];
  @Input() data: Record<string, any> = {};

  isFilled(id: string): boolean {
    const value = this.data?.[id];
    return value !== undefined && value !== null && value !== '';
  }
}
