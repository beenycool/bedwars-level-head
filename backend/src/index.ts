import { sql } from 'kysely';
import { createApp } from './app';
import {
  SERVER_HOST,
  SERVER_PORT,
  CLOUD_FLARE_TUNNEL,
  CACHE_DB_POOL_MAX,
  CACHE_DB_POOL_MIN,
} from './config';
import { pool as cachePool } from './services/cache';
import { logger } from './util/logger';
import { getRedisClient } from './services/redis';
import {
  startBackgroundServices,
  startPostListenServices,
  stopAllServices,
  flushBeforeClose,
  safeCloseCache,
} from './scheduler';

const app = createApp();

// Initialize background services (metrics, history flush, leader election)
startBackgroundServices();

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  const location = CLOUD_FLARE_TUNNEL || `http://${SERVER_HOST}:${SERVER_PORT}`;
  logger.info(`Levelhead proxy listening at ${location}`);
  logger.info(`Cache DB pool configured with min=${CACHE_DB_POOL_MIN} max=${CACHE_DB_POOL_MAX}.`);

  // Start services that should only run after we start listening
  startPostListenServices();

  void Promise.all([
    getRedisClient()?.ping().catch(() => {}),
    sql`SELECT 1`.execute(cachePool).catch(() => {}),
  ]).then(() => logger.info('[startup] connections warmed'));
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  
  // Stop background services and leader election
  await stopAllServices().catch((error) => {
    logger.error('Error stopping services during shutdown', error);
  });

  const forcedShutdown = setTimeout(() => {
    logger.error('Forcing shutdown.');
    void safeCloseCache();
    process.exit(1);
  }, 15000);
  forcedShutdown.unref();

  try {
    await new Promise<void>((resolve) => {
      server.close((err?: Error) => {
        if (err) {
          logger.error({ err }, 'Error closing HTTP server');
          process.exitCode = 1;
        }

        resolve();
      });
    });
    // Final flushes before closing DB connections
    await flushBeforeClose();
  } finally {
    safeCloseCache().finally(() => {
      clearTimeout(forcedShutdown);

      const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
      process.exit(exitCode);
    });
  }
}

const shutdownSignals = ['SIGINT', 'SIGTERM'] as const;

shutdownSignals.forEach((signal) => {
  process.on(signal, () => {
    void shutdown(signal);
  });
});

// Best-effort cleanup for unexpected exits
process.on('exit', () => {
  void safeCloseCache();
});
