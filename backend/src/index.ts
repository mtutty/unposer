import { createServer } from 'http';
import { createApp } from './app';
import { WSServer } from './websocket/server';
import { config } from './config';

const app = createApp();
const server = createServer(app);

// Initialize WebSocket server
new WSServer(server);

server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Dev auth enabled: ${config.devAuth.enabled}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
