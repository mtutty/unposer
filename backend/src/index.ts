import { createServer } from 'http';
import { createApp } from './app';
import { WSServer } from './websocket/server';
import { config } from './config';
import { startWeeklyScheduler } from './services/weekly-scheduler.cron';

const app = createApp();
const server = createServer(app);

// Initialize WebSocket server
new WSServer(server);

// Personality engine weekly re-engagement scheduler (spec §3.5, Iteration 9) — no-op unless
// SCHEDULER_ENABLED=true (see config/index.ts and weekly-scheduler.cron.ts).
const schedulerTask = startWeeklyScheduler();

server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Dev auth enabled: ${config.devAuth.enabled}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  schedulerTask?.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
