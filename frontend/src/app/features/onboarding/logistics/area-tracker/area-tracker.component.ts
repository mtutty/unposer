import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { InfoArea } from '../../../../models/flow.model';
import { AreaGlyphComponent } from '../../../../shared/components/area-glyph/area-glyph.component';
import { truncateWords } from '../../../../shared/utils/text';

/**
 * Glyph row for the logistics step's tracked information areas (see backend
 * models/logistics-areas.ts — server-driven, not hardcoded here beyond the icon shapes
 * themselves). Each area fills in visually once `data` has a non-empty value for its id, turning
 * the somewhat-random order topics land in during free-form conversation into a visible
 * checklist — the "gamify completion" ask.
 */
@Component({
    selector: 'app-area-tracker',
    imports: [AreaGlyphComponent],
    template: `
    <ul class="area-tracker" aria-label="Information we're gathering">
      @for (area of areas; track area.id) {
        @let filled = isFilled(area.id);
        <li class="area-chip" [class.area-filled]="filled" tabindex="0">
          <span class="area-glyph" aria-hidden="true">
            <app-area-glyph [areaId]="area.id" />
          </span>
          <span class="area-tooltip" role="tooltip">
            <strong>{{ area.label }}</strong>
            <span>{{ area.description }}</span>
            @if (summaryFor(area); as summary) {
              <span class="area-tooltip-summary">{{ summary }}</span>
            }
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

      .area-tooltip-summary {
        padding-top: 0.3em;
        margin-top: 0.15em;
        border-top: 1px solid var(--border-on-cover);
        color: var(--paper-text-soft);
        font-style: italic;
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

  /** A <=20-word summary of the candidate's response for this area, for the tooltip once it's
   *  filled. Resume-sourced areas (e.g. 'resumeBackground') have no chat-extracted text to
   *  summarize — the tracker data there is just a boolean flag — so those get no summary line. */
  summaryFor(area: InfoArea): string | null {
    if ((area.source ?? 'chat') !== 'chat') return null;
    return truncateWords(this.data?.[area.id]);
  }
}
