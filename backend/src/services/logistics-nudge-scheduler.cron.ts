import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config';
import { LogisticsNudgeSchedulerService } from './logistics-nudge-scheduler.service';

// Same trigger/logic split as weekly-scheduler.cron.ts: everything about *what* a check does
// lives in logistics-nudge-scheduler.service.ts; this file is only "when." Shares
// config.scheduler.enabled with the weekly scheduler (see that config's own comment for why one
// switch, not two) but runs on its own, more frequent cron expression.
export function startLogisticsNudgeScheduler(): ScheduledTask | null {
  if (!config.scheduler.enabled) {
    console.log('[logistics-nudge-scheduler] disabled (SCHEDULER_ENABLED != true) — not scheduling');
    return null;
  }

  const scheduler = new LogisticsNudgeSchedulerService();
  const task = cron.schedule(config.scheduler.logisticsNudgeCronExpression, () => {
    runOnce(scheduler).catch((error) => {
      console.error('[logistics-nudge-scheduler] run failed:', error);
    });
  });

  console.log(`[logistics-nudge-scheduler] enabled — cron "${config.scheduler.logisticsNudgeCronExpression}"`);
  return task;
}

async function runOnce(scheduler: LogisticsNudgeSchedulerService): Promise<void> {
  const start = Date.now();
  const result = await scheduler.runCheck();
  const elapsedMs = Date.now() - start;
  console.log(`[logistics-nudge-scheduler] run complete in ${elapsedMs}ms — processed=${result.processed} nudged=${result.nudged}`);
}
