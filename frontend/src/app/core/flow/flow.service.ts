import { Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';
import { ApiService } from '../api/api.service';
import { FlowProgress, FlowStage, FlowStageId, FlowStep, FlowStepId, StepStatus } from '../../models/flow.model';

@Injectable({
  providedIn: 'root'
})
export class FlowService {
  steps = signal<FlowStep[]>([]);
  stages = signal<FlowStage[]>([]);
  progress = signal<FlowProgress | null>(null);

  constructor(private api: ApiService) {}

  loadSteps() {
    return this.api
      .get<{ steps: FlowStep[]; stages: FlowStage[] }>('/flow/steps')
      .pipe(tap((r) => {
        this.steps.set(r.steps);
        this.stages.set(r.stages);
      }));
  }

  /** Steps within a stage that get their own rail entry (excludes railVisible:false steps). */
  stepsForStage(stageId: FlowStageId): FlowStep[] {
    const stage = this.stages().find((s) => s.id === stageId);
    if (!stage) return [];
    const byId = new Map(this.steps().map((s) => [s.id, s]));
    return stage.steps.map((id) => byId.get(id)).filter((s): s is FlowStep => !!s && s.railVisible !== false);
  }

  stageOf(stepId: FlowStepId): FlowStageId | null {
    return this.stages().find((s) => s.steps.includes(stepId))?.id ?? null;
  }

  isActiveStage(stageId: FlowStageId): boolean {
    const current = this.progress()?.current_step;
    return !!current && this.stageOf(current) === stageId;
  }

  /** Aggregate state over a stage's rail-visible steps only — sandbox/share (CTAs, not rail
   *  entries) don't gate whether "Interview Yourself" itself reads as complete. */
  stageState(stageId: FlowStageId): StepStatus {
    const steps = this.stepsForStage(stageId);
    const state = this.progress()?.steps_state;
    if (!state || steps.length === 0) return 'pending';
    if (steps.every((s) => state[s.id] === 'complete')) return 'complete';
    if (steps.some((s) => state[s.id] === 'complete' || state[s.id] === 'in_progress')) return 'in_progress';
    return 'pending';
  }

  loadProgress() {
    return this.api.get<FlowProgress>('/flow/progress').pipe(tap((p) => this.progress.set(p)));
  }

  setProgress(progress: FlowProgress) {
    this.progress.set(progress);
  }

  reset() {
    return this.api.post('/flow/reset', {}).pipe(
      tap(() => {
        this.progress.set(null);
      })
    );
  }
}
