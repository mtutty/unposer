import { db } from '../db/connection';
import { FlowProgress, FlowStepId, StepStatus } from '../types';
import { flowSteps } from '../models/flow-steps';

export class FlowService {
  async getProgress(userId: string): Promise<FlowProgress> {
    let progress = await db('flow_progress').where({ user_id: userId }).first();

    if (!progress) {
      const initialState = {} as Record<FlowStepId, StepStatus>;
      flowSteps.forEach((step, i) => {
        initialState[step.id] = i === 0 ? 'in_progress' : 'pending';
      });

      [progress] = await db('flow_progress')
        .insert({
          user_id: userId,
          current_step: flowSteps[0].id,
          steps_state: initialState
        })
        .returning('*');
    }

    return progress;
  }

  async setChannel(userId: string, channel: 'app' | 'email'): Promise<FlowProgress> {
    const [progress] = await db('flow_progress')
      .where({ user_id: userId })
      .update({ logistics_channel: channel, updated_at: new Date() })
      .returning('*');
    return progress;
  }

  /**
   * Marks a step complete and advances current_step to the next one in order — unless the
   * candidate is re-confirming a step they've already moved past (e.g. revisiting Resume from the
   * rail after Logistics/Your Stories are done and re-saving an edit). In that case current_step
   * stays put: this step's own steps_state entry still gets marked 'complete' the same way, but we
   * don't drag the flow's position backward just because an earlier step was touched again.
   */
  async completeStep(userId: string, stepId: FlowStepId): Promise<FlowProgress> {
    const progress = await this.getProgress(userId);
    const stepsState = { ...progress.steps_state, [stepId]: 'complete' as StepStatus };

    const currentIndex = flowSteps.findIndex((s) => s.id === stepId);
    const next = flowSteps[currentIndex + 1];
    if (next && stepsState[next.id] !== 'complete') {
      stepsState[next.id] = 'in_progress';
    }

    const currentStepIndex = flowSteps.findIndex((s) => s.id === progress.current_step);
    const alreadyPastThisStep = currentStepIndex > currentIndex;
    const newCurrentStep = alreadyPastThisStep ? progress.current_step : next ? next.id : stepId;

    const [updated] = await db('flow_progress')
      .where({ user_id: userId })
      .update({
        steps_state: stepsState,
        current_step: newCurrentStep,
        updated_at: new Date()
      })
      .returning('*');

    return updated;
  }

  /** Jumps current_step back to a prior step (e.g. flagged-insight re-ask routes to deep_prompts). */
  async reopenStep(userId: string, stepId: FlowStepId): Promise<FlowProgress> {
    const progress = await this.getProgress(userId);
    const stepsState = { ...progress.steps_state, [stepId]: 'in_progress' as StepStatus };

    const [updated] = await db('flow_progress')
      .where({ user_id: userId })
      .update({ steps_state: stepsState, current_step: stepId, updated_at: new Date() })
      .returning('*');

    return updated;
  }

  async resetProgress(userId: string): Promise<void> {
    await db.transaction(async (trx) => {
      await trx('flow_progress').where({ user_id: userId }).delete();
      await trx('messages').where({ user_id: userId }).delete();
      await trx('conversation_threads').where({ user_id: userId }).delete();
      await trx('logistics_responses').where({ user_id: userId }).delete();
      await trx('resumes').where({ user_id: userId }).delete();
      await trx('candidate_profiles').where({ user_id: userId }).delete();
      await trx('sandbox_messages').where({ user_id: userId }).delete();
      await trx('share_links').where({ user_id: userId }).delete();
    });
  }
}
