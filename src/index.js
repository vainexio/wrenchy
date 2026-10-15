import mongoose from 'mongoose';
import { config } from './config.js';
import { connectDatabase } from './db.js';
import { client } from './bot/client.js';
import { createApp } from './server/app.js';

async function main() {
  // Start the web server first so Render's port/health check passes quickly.
  // Bind to 0.0.0.0 explicitly; Render routes traffic and health checks over IPv4.
  const server = createApp(client).listen(config.port, '0.0.0.0', () => {
    console.log(`[web] listening on port ${config.port}`);
  });

  await connectDatabase();
  await client.login(config.token);

  const shutdown = async (signal) => {
    console.log(`[app] ${signal} received, shutting down`);
    server.close();
    await client.destroy();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (err) => console.error('[app] unhandled rejection:', err));

main().catch((err) => {
  console.error('[app] failed to start:', err);
  process.exit(1);
});
