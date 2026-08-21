import { flowSteps, flowStages, getStep, nextStep } from './flow-steps';

describe('flow-steps data integrity', () => {
  // The frontend renders the rail purely from this data (see CLAUDE.md
  // "Server-Driven UI") — a gap or mismatch here is a silent frontend bug,
  // not a compile error, so it's worth asserting the shape directly.

  it('gives every step a unique, sequential order starting at 1', () => {
    const orders = flowSteps.map((s) => s.order).sort((a, b) => a - b);
    expect(orders).toEqual(flowSteps.map((_, i) => i + 1));
  });

  it('has flowStages reference every flowStep exactly once', () => {
    const stageStepIds = flowStages.flatMap((stage) => stage.steps);
    const stepIds = flowSteps.map((s) => s.id);

    expect(new Set(stageStepIds).size).toBe(stageStepIds.length); // no duplicates
    expect(stageStepIds.slice().sort()).toEqual(stepIds.slice().sort());
  });

  it("has each step's declared stage match the stage that actually lists it", () => {
    for (const stage of flowStages) {
      for (const stepId of stage.steps) {
        expect(getStep(stepId).stage).toBe(stage.id);
      }
    }
  });

  it('gives every step at least one channel', () => {
    for (const step of flowSteps) {
      expect(step.channels.length).toBeGreaterThan(0);
    }
  });
});

describe('getStep', () => {
  it('returns the step with the matching id', () => {
    expect(getStep('logistics').name).toBe('Goals & Logistics');
  });

  it('throws for an unknown id', () => {
    // @ts-expect-error — intentionally passing an invalid FlowStepId
    expect(() => getStep('not-a-real-step')).toThrow('Unknown flow step');
  });
});

describe('nextStep', () => {
  it('returns the step with the next order value', () => {
    expect(nextStep('resume')?.id).toBe('logistics');
    expect(nextStep('logistics')?.id).toBe('deep_prompts');
  });

  it('returns null after the last step', () => {
    const last = flowSteps.reduce((a, b) => (b.order > a.order ? b : a));
    expect(nextStep(last.id)).toBeNull();
  });
});
