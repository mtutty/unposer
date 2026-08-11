import { Component, OnInit, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AreaTrackerComponent } from '../../../features/onboarding/logistics/area-tracker/area-tracker.component';
import { FlowService } from '../../../core/flow/flow.service';
import { LogisticsService } from '../../../core/logistics/logistics.service';
import { ResumeService } from '../../../core/resume/resume.service';
import { Resume } from '../../../models/resume.model';

/**
 * Read-only "What we're gathering" glyph row, dropped onto all three "Tell Your Story" step pages
 * (resume, logistics, deep_prompts) so the tracker — and the sense of progress it gives — stays
 * visible for the whole stage, not just while sitting on the Goals & Logistics page itself.
 *
 * Self-fetches its own snapshot rather than taking it as an @Input. LogisticsStepComponent keeps
 * its *own* copy of this same shape of state instead of using this component, because it also
 * needs to refresh it live as the chat extracts new fields turn by turn and feed it into
 * ChatPanelComponent's `infoAreas` input — this component's data is fetched once on mount and
 * left alone, since nothing on the resume/deep-prompts pages changes it while it's showing.
 */
@Component({
  selector: 'app-story-tracker',
  imports: [AreaTrackerComponent],
  template: `
    @if (areas().length) {
      <div class="story-tracker">
        <span class="eyebrow tracker-label">What we're gathering</span>
        <app-area-tracker [areas]="areas()" [data]="trackerData()" />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .story-tracker {
        margin-top: 1.75rem;
      }

      .tracker-label {
        display: block;
        margin-bottom: 0.6rem;
      }
    `
  ]
})
export class StoryTrackerComponent implements OnInit {
  // Reactive rather than fetched-once here too: flow.steps() may still be loading when this
  // mounts (the shell kicks it off but doesn't wait on it) — see StepRailComponent/
  // LogisticsStepComponent for the same pattern.
  areas = computed(() => this.flow.steps().find((s) => s.id === 'logistics')?.infoAreas ?? []);
  knownData = signal<Record<string, any>>({});
  // "Background" is sourced from the resume record, not chat extraction — see logistics-areas.ts's
  // `source` field — so it's merged in here rather than living in knownData.
  resumeFilled = signal(false);
  trackerData = computed(() => (this.resumeFilled() ? { ...this.knownData(), resumeBackground: true } : this.knownData()));

  constructor(
    private flow: FlowService,
    private logisticsService: LogisticsService,
    private resumeService: ResumeService
  ) {}

  ngOnInit(): void {
    forkJoin([this.logisticsService.get(), this.resumeService.get()]).subscribe(([logistics, resume]) => {
      if (logistics?.data) this.knownData.set(logistics.data);
      this.resumeFilled.set(this.hasResumeContent(resume));
    });
  }

  /** A confirmed-but-blank resume (career-changer/no-resume path) shouldn't count as "filled" —
   *  only real content should light up the glyph. Kept in sync with LogisticsStepComponent's
   *  identical check. */
  private hasResumeContent(resume: Resume | null): boolean {
    const data = resume?.structured_data;
    if (!data) return false;
    return !!(data.summary?.trim() || data.workHistory?.length);
  }
}
