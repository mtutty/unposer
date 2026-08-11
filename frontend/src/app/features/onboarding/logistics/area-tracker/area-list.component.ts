import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { InfoArea } from '../../../../models/flow.model';
import { AreaGlyphComponent } from '../../../../shared/components/area-glyph/area-glyph.component';
import { truncateWords } from '../../../../shared/utils/text';

/**
 * The full, vertical read of the logistics info areas — glyph, label, description, and (once
 * filled) the same truncated response summary the area-tracker tooltip shows. Presentational only
 * (no expand/collapse state of its own): app-area-tracker uses it as the content of its desktop
 * dropdown, and LogisticsStepComponent uses it directly as the mobile "Goals" tab's content — see
 * onboarding UX spec item 6/7. One markup/style source so both read identically.
 */
@Component({
    selector: 'app-area-list',
    imports: [AreaGlyphComponent],
    template: `
    <ul class="area-list" aria-label="Information we're gathering">
      @for (area of areas; track area.id) {
        @let filled = isFilled(area.id);
        <li class="area-row" [class.area-row-filled]="filled">
          <span class="area-row-glyph" [class.area-row-glyph-filled]="filled" aria-hidden="true">
            <app-area-glyph [areaId]="area.id" [size]="26" />
          </span>
          <span class="area-row-text">
            <strong>{{ area.label }}</strong>
            <span class="area-row-description">{{ area.description }}</span>
            @if (summaryFor(area); as summary) {
              <span class="area-row-summary">{{ summary }}</span>
            }
          </span>
        </li>
      }
    </ul>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .area-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .area-row {
        display: flex;
        align-items: flex-start;
        gap: 0.85rem;
      }

      .area-row-glyph {
        flex-shrink: 0;
        width: 2.6rem;
        height: 2.6rem;
        border-radius: 50%;
        border: 2px solid var(--border);
        background: #fff;
        color: var(--pencil);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
      }

      .area-row-glyph-filled {
        background: var(--brass);
        border-color: var(--brass-strong);
        color: var(--ink);
      }

      .area-row-text {
        display: flex;
        flex-direction: column;
        gap: 0.15em;
        padding-top: 0.15em;

        strong {
          font-family: var(--font-display);
          font-size: 0.92rem;
        }
      }

      .area-row-description {
        color: var(--ink-soft);
        font-size: 0.85rem;
      }

      // The candidate's actual answer — the reason this panel exists — was reading as an
      // afterthought next to the description above it (smaller, monospace, muted). Matching (and
      // slightly exceeding) the description's weight here, in the same narrative body font rather
      // than a "metadata" mono treatment, puts the emphasis on the more important of the two.
      .area-row-summary {
        font-size: 0.9rem;
        color: var(--ink);
        font-weight: 500;
      }
    `
    ]
})
export class AreaListComponent {
  @Input() areas: InfoArea[] = [];
  @Input() data: Record<string, any> = {};

  isFilled(id: string): boolean {
    const value = this.data?.[id];
    return value !== undefined && value !== null && value !== '';
  }

  summaryFor(area: InfoArea): string | null {
    if ((area.source ?? 'chat') !== 'chat') return null;
    return truncateWords(this.data?.[area.id]);
  }
}
