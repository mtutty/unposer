import { Component, ElementRef, HostListener, Input, signal, ChangeDetectionStrategy } from '@angular/core';
import { InfoArea } from '../../../../models/flow.model';
import { AreaGlyphComponent } from '../../../../shared/components/area-glyph/area-glyph.component';
import { AreaListComponent } from './area-list.component';
import { truncateWords } from '../../../../shared/utils/text';

/**
 * Glyph row for the logistics step's tracked information areas (see backend
 * models/logistics-areas.ts — server-driven, not hardcoded here beyond the icon shapes
 * themselves). Each area fills in visually once `data` has a non-empty value for its id, turning
 * the somewhat-random order topics land in during free-form conversation into a visible
 * checklist — the "gamify completion" ask.
 *
 * Desktop-only (see LogisticsStepComponent, which hides this behind a media query on mobile in
 * favor of the "Goals" tab): clicking anywhere on the row — a glyph or the row itself — slides
 * open the full AreaListComponent read inline, in normal document flow (full width of whatever
 * column it's in — the chat panel above), rather than as a floating dropdown overlaying the page.
 */
@Component({
    selector: 'app-area-tracker',
    imports: [AreaGlyphComponent, AreaListComponent],
    template: `
    <div class="area-tracker-wrap">
      <div
        class="area-tracker-header"
        role="button"
        tabindex="0"
        [attr.aria-expanded]="expanded()"
        aria-label="Show details for what we're gathering"
        (click)="toggle()"
        (keydown.enter)="toggle()"
        (keydown.space)="onSpace($event)"
      >
        <ul class="area-tracker" aria-hidden="true">
          @for (area of areas; track area.id) {
            @let filled = isFilled(area.id);
            <li class="area-chip" [class.area-filled]="filled">
              <span class="area-glyph">
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
        <svg
          class="chevron"
          [class.chevron-closed]="!expanded()"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>

      <!-- Always rendered (rather than @if-gated) so the grid-template-rows transition below has
           something to animate between — it slides open in normal flow, pushing the chat panel
           down, instead of floating a dropdown over it. -->
      <div class="area-tracker-slide" [class.area-tracker-open]="expanded()">
        <div class="area-tracker-slide-inner">
          <div class="area-tracker-panel">
            <app-area-list [areas]="areas" [data]="data" />
          </div>
        </div>
      </div>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .area-tracker-wrap {
        position: relative;
      }

      .area-tracker-header {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.5rem 0.7rem 0.5rem 0.4rem;
        margin: 0 0 0 -0.4rem;
        border-radius: var(--radius-lg);
        cursor: pointer;
        transition: background 0.15s ease;

        &:hover,
        &:focus-visible {
          background: var(--page-2);
        }
      }

      // The path draws a down-pointing chevron (▼) — its natural, unrotated orientation reads as
      // "open" (this is what's revealed below once expanded), so only the *closed* state rotates
      // it to point right (▶), the conventional "click to reveal" affordance.
      .chevron {
        color: var(--pencil);
        flex-shrink: 0;
        transition: transform 0.2s ease;
      }

      .chevron-closed {
        transform: rotate(-90deg);
      }

      .area-tracker {
        list-style: none;
        margin: 0;
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

      // Keyboard users get the fully-expanded, always-legible AreaList via the header's own
      // Enter/Space toggle instead of tabbing chip-by-chip for a hover-only tooltip.
      .area-chip:hover .area-tooltip {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      // The slide-open mechanism: animating a grid track from 0fr to 1fr (rather than height:auto,
      // which can't be transitioned, or max-height, which needs a guessed cap) gives a smooth
      // reveal to the content's actual height. The inner wrapper supplies the overflow:hidden the
      // technique needs — it lives on a separate element so the panel's own padding/border don't
      // get clipped mid-transition.
      .area-tracker-slide {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.22s ease;
      }

      .area-tracker-open {
        grid-template-rows: 1fr;
      }

      .area-tracker-slide-inner {
        overflow: hidden;
      }

      .area-tracker-panel {
        width: 100%;
        margin-top: 0.5rem;
        padding: 1.25rem 1.4rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: #fff;
      }
    `
    ]
})
export class AreaTrackerComponent {
  @Input() areas: InfoArea[] = [];
  @Input() data: Record<string, any> = {};

  expanded = signal(false);

  constructor(private el: ElementRef<HTMLElement>) {}

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

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  onSpace(event: Event): void {
    event.preventDefault(); // stop the page from scrolling on Space
    this.toggle();
  }

  /** Collapses the panel on an outside click, same affordance as any other disclosure. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.expanded() && !this.el.nativeElement.contains(event.target as Node)) {
      this.expanded.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.expanded.set(false);
  }
}
