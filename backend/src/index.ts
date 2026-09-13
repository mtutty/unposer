import { createApp } from './app';
import { config } from './config';
import { startWeeklyScheduler } from './services/weekly-scheduler.cron';
import { startLogisticsNudgeScheduler } from './services/logistics-nudge-scheduler.cron';

const app = createApp();

// No more WebSocket server (see the removed websocket/server.ts) — every chat surface in the app
// now speaks the same POST+SSE interaction model over plain HTTP (utils/sse.ts), so a bare
// app.listen() is enough; there's no separate upgrade-handling http.Server to wire up any more.

// Personality engine weekly re-engagement scheduler (spec §3.5, Iteration 9) — no-op unless
// SCHEDULER_ENABLED=true (see config/index.ts and weekly-scheduler.cron.ts).
const schedulerTask = startWeeklyScheduler();

// Step 3 (logistics) email-thread nudges — closes the "composed on-demand only" gap named in
// CLAUDE.md's Known TODOs and docs/system-test-plan.md. Same SCHEDULER_ENABLED gate, its own
// cron cadence (see logistics-nudge-scheduler.cron.ts / config/index.ts).
const logisticsNudgeTask = startLogisticsNudgeScheduler();

const server = app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Dev auth enabled: ${config.devAuth.enabled}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  schedulerTask?.stop();
  logisticsNudgeTask?.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
