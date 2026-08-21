import { FlowService } from './flow.service';
import { flowSteps } from '../models/flow-steps';
import { FlowProgress } from '../types';

// `db` is knex's callable-query-builder export (`db('table').where(...)...`).
// Mock it as a jest.fn() returning a small chainable stub whose terminal
// methods (first/returning) resolve whatever the test configures.
jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.update = jest.fn(() => builder);
  builder.first = jest.fn();
  builder.returning = jest.fn();
  builder.delete = jest.fn();
  return builder;
}

function progressFixture(overrides: Partial<FlowProgress> = {}): FlowProgress {
  return {
    id: 'progress-1',
    user_id: 'user-1',
    current_step: 'resume',
    steps_state: { resume: 'in_progress' } as FlowProgress['steps_state'],
    logistics_channel: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

describe('FlowService', () => {
  let service: FlowService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    service = new FlowService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  describe('getProgress', () => {
    it('returns the existing row when one is found', async () => {
      const existing = progressFixture();
      builder.first.mockResolvedValue(existing);

      const result = await service.getProgress('user-1');

      expect(result).toBe(existing);
      expect(builder.insert).not.toHaveBeenCalled();
    });

    it('creates an initial row — first step in_progress, rest pending — when none exists', async () => {
      builder.first.mockResolvedValue(undefined);
      builder.returning.mockResolvedValue([progressFixture()]);

      await service.getProgress('user-1');

      const [inserted] = builder.insert.mock.calls[0];
      expect(inserted.current_step).toBe(flowSteps[0].id);
      expect(inserted.steps_state[flowSteps[0].id]).toBe('in_progress');
      expect(inserted.steps_state[flowSteps[1].id]).toBe('pending');
    });
  });

  describe('completeStep', () => {
    it('advances current_step to the next step on normal forward progress', async () => {
      // Candidate is on 'resume' (index 0) and just completed it.
      builder.first.mockResolvedValue(
        progressFixture({ current_step: 'resume', steps_state: { resume: 'in_progress' } as any })
      );
      builder.returning.mockResolvedValue([progressFixture()]);

      await service.completeStep('user-1', 'resume');

      const [update] = builder.update.mock.calls[0];
      expect(update.steps_state.resume).toBe('complete');
      expect(update.steps_state.logistics).toBe('in_progress');
      expect(update.current_step).toBe('logistics');
    });

    // The regression this guards: b160575 "Keep current_step from moving
    // backward when the rail revisits a completed step."
    it('does not move current_step backward when re-confirming an earlier, already-passed step', async () => {
      builder.first.mockResolvedValue(
        progressFixture({
          current_step: 'profile_review',
          steps_state: {
            resume: 'complete',
            logistics: 'complete',
            deep_prompts: 'complete',
            profile_review: 'in_progress'
          } as any
        })
      );
      builder.returning.mockResolvedValue([progressFixture()]);

      await service.completeStep('user-1', 'resume');

      const [update] = builder.update.mock.calls[0];
      expect(update.steps_state.resume).toBe('complete');
      expect(update.current_step).toBe('profile_review'); // unchanged, not dragged back to 'logistics'
    });

    it('does not overwrite an already-complete next step back to in_progress', async () => {
      builder.first.mockResolvedValue(
        progressFixture({
          current_step: 'profile_review',
          steps_state: { resume: 'complete', logistics: 'complete' } as any
        })
      );
      builder.returning.mockResolvedValue([progressFixture()]);

      await service.completeStep('user-1', 'resume');

      const [update] = builder.update.mock.calls[0];
      expect(update.steps_state.logistics).toBe('complete'); // not downgraded to in_progress
    });

    it('stays on the same step when completing the last step in the flow', async () => {
      const last = flowSteps.reduce((a, b) => (b.order > a.order ? b : a));
      builder.first.mockResolvedValue(
        progressFixture({ current_step: last.id, steps_state: {} as any })
      );
      builder.returning.mockResolvedValue([progressFixture()]);

      await service.completeStep('user-1', last.id);

      const [update] = builder.update.mock.calls[0];
      expect(update.current_step).toBe(last.id);
    });
  });

  describe('reopenStep', () => {
    it('jumps current_step directly to the reopened step', async () => {
      builder.returning.mockResolvedValue([progressFixture()]);

      await service.reopenStep('user-1', 'deep_prompts');

      const [update] = builder.update.mock.calls[0];
      expect(update.current_step).toBe('deep_prompts');
      expect(update.steps_state.deep_prompts).toBe('in_progress');
    });
  });
});
