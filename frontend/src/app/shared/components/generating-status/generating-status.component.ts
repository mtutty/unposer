import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal, ChangeDetectionStrategy } from '@angular/core';

/**
 * Staged status-message + spinner for a slow (roughly-a-minute) LLM call with no progress events
 * of its own — cycles through plausible stage text on a timer purely to keep the wait legible, not
 * a readout of real backend phase transitions. Previously copy-pasted three times (resume upload's
 * "parsing", profile generation's "generating", and applying sandbox corrections' "generating" —
 * the latter explicitly copied from the former) before being pulled out here.
 */
@Component({
  selector: 'app-generating-status',
  template: `
    @if (active) {
      <div class="generating-status">
        <span class="spinner" aria-hidden="true"></span>
        <div class="generating-copy">
          <p class="generating-line" aria-live="polite">{{ currentText() }}</p>
          <p class="meta generating-estimate">{{ estimate }}</p>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .generating-status {
        display: flex;
        align-items: center;
        gap: 0.9rem;
      }

      .spinner {
        flex-shrink: 0;
        width: 1.6rem;
        height: 1.6rem;
        border-radius: 50%;
        border: 3px solid var(--border);
        border-top-color: var(--brass-strong);
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .generating-copy {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }

      .generating-line {
        margin: 0;
        font-weight: 600;
        color: var(--ink);
      }

      .generating-estimate {
        margin: 0;
        font-size: 0.78rem;
      }

      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation: none;
        }
      }
    `
  ]
})
export class GeneratingStatusComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) active!: boolean;
  @Input({ required: true }) stages!: Array<{ afterMs: number; text: string }>;
  @Input() estimate = 'Usually takes about a minute.';

  currentText = signal('');
  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['active']) {
      if (this.active) this.start();
      else this.clear();
    }
  }

  ngOnDestroy(): void {
    this.clear();
  }

  private start(): void {
    this.clear();
    if (!this.stages.length) return;
    this.currentText.set(this.stages[0].text);
    this.timers = this.stages
      .slice(1)
      .map((stage) => setTimeout(() => this.currentText.set(stage.text), stage.afterMs));
  }

  private clear(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers = [];
  }
}
