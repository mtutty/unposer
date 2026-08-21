import { of } from 'rxjs';
import { FlowService } from './flow.service';
import { ApiService } from '../api/api.service';
import { FlowStage, FlowStep, FlowProgress } from '../../models/flow.model';

const STEPS: FlowStep[] = [
  { id: 'resume', name: 'Resume', description: '', order: 1, stage: 'story', channels: ['app'], completionCriteria: '', conversationStarters: [] },
  { id: 'logistics', name: 'Logistics', description: '', order: 2, stage: 'story', channels: ['app'], completionCriteria: '', conversationStarters: [] },
  { id: 'deep_prompts', name: 'Stories', description: '', order: 3, stage: 'story', channels: ['app'], completionCriteria: '', conversationStarters: [] },
  { id: 'profile_review', name: 'Profile', description: '', order: 4, stage: 'interview', channels: ['app'], completionCriteria: '', conversationStarters: [] },
  { id: 'sandbox', name: 'Sandbox', description: '', order: 5, stage: 'interview', railVisible: false, channels: ['app'], completionCriteria: '', conversationStarters: [] },
  { id: 'share', name: 'Share', description: '', order: 6, stage: 'interview', railVisible: false, channels: ['app'], completionCriteria: '', conversationStarters: [] }
];

const STAGES: FlowStage[] = [
  { id: 'story', name: 'Tell Your Story', description: '', order: 1, steps: ['resume', 'logistics', 'deep_prompts'] },
  { id: 'interview', name: 'Interview Yourself', description: '', order: 2, steps: ['profile_review', 'sandbox', 'share'] }
];

function progressWith(state: Partial<Record<string, 'pending' | 'in_progress' | 'complete'>>, current = 'resume'): FlowProgress {
  return {
    id: 'p1',
    user_id: 'u1',
    current_step: current as any,
    steps_state: state as any,
    logistics_channel: null,
    created_at: '',
    updated_at: ''
  };
}

describe('FlowService', () => {
  let service: FlowService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post']);
    service = new FlowService(api);
    service.steps.set(STEPS);
    service.stages.set(STAGES);
  });

  it('loadSteps populates the steps and stages signals from the API response', () => {
    service.steps.set([]);
    service.stages.set([]);
    api.get.and.returnValue(of({ steps: STEPS, stages: STAGES }));

    service.loadSteps().subscribe();

    expect(service.steps()).toEqual(STEPS);
    expect(service.stages()).toEqual(STAGES);
  });

  describe('stepsForStage', () => {
    it('returns only rail-visible steps, in stage order', () => {
      const steps = service.stepsForStage('interview');
      expect(steps.map((s) => s.id)).toEqual(['profile_review']); // sandbox/share excluded
    });

    it('returns an empty array for an unknown stage', () => {
      expect(service.stepsForStage('nope' as any)).toEqual([]);
    });
  });

  describe('stageOf', () => {
    it('finds the stage containing a given step, including non-rail-visible ones', () => {
      expect(service.stageOf('logistics')).toBe('story');
      expect(service.stageOf('sandbox')).toBe('interview');
    });
  });

  describe('isActiveStage', () => {
    it('is true for the stage containing the current step', () => {
      service.setProgress(progressWith({}, 'deep_prompts'));
      expect(service.isActiveStage('story')).toBeTrue();
      expect(service.isActiveStage('interview')).toBeFalse();
    });

    it('is false with no progress loaded', () => {
      expect(service.isActiveStage('story')).toBeFalse();
    });
  });

  describe('stageState', () => {
    it('is "complete" only when every rail-visible step in the stage is complete', () => {
      // sandbox/share aren't rail-visible, so 'interview' only needs profile_review.
      service.setProgress(progressWith({ profile_review: 'complete' }));
      expect(service.stageState('interview')).toBe('complete');
    });

    it('is "in_progress" when some but not all rail-visible steps are underway', () => {
      service.setProgress(progressWith({ resume: 'complete', logistics: 'in_progress' }));
      expect(service.stageState('story')).toBe('in_progress');
    });

    it('is "pending" when no rail-visible step in the stage has started', () => {
      service.setProgress(progressWith({}));
      expect(service.stageState('story')).toBe('pending');
    });

    it('is "pending" with no progress loaded at all', () => {
      expect(service.stageState('story')).toBe('pending');
    });
  });

  describe('reset', () => {
    it('clears the progress signal after the API call completes', () => {
      service.setProgress(progressWith({}));
      api.post.and.returnValue(of({}));

      service.reset().subscribe();

      expect(service.progress()).toBeNull();
    });
  });
});
