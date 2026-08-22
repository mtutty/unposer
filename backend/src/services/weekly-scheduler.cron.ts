import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config';
import { WeeklySchedulerService } from './weekly-scheduler.service';

// Personality engine (spec §3.5, Iteration 9). The actual trigger — everything about *what* a
// weekly check does lives in weekly-scheduler.service.ts; this file is only "when." Gated by
// config.scheduler.enabled (see config/index.ts's comment on why this doesn't just inherit
// email.enabled) so importing/calling this from index.ts is safe in every environment, including
// one with real Resend credentials configured for other purposes.
export function startWeeklyScheduler(): ScheduledTask | null {
  if (!config.scheduler.enabled) {
    console.log('[weekly-scheduler] disabled (SCHEDULER_ENABLED != true) — not scheduling');
    return null;
  }

  const scheduler = new WeeklySchedulerService();
  const task = cron.schedule(config.scheduler.cronExpression, () => {
    runOnce(scheduler).catch((error) => {
      console.error('[weekly-scheduler] run failed:', error);
    });
  });

  console.log(`[weekly-scheduler] enabled — cron "${config.scheduler.cronExpression}"`);
  return task;
}

async function runOnce(scheduler: WeeklySchedulerService): Promise<void> {
  const start = Date.now();
  const result = await scheduler.runWeeklyCheck();
  const elapsedMs = Date.now() - start;
  console.log(
    `[weekly-scheduler] run complete in ${elapsedMs}ms — processed=${result.processed} sent=${result.sent} wentDormant=${result.wentDormant}`
  );
}
