import { createApp } from './app';
import {
  SERVER_HOST,
  SERVER_PORT,
  CLOUD_FLARE_TUNNEL,
  CACHE_DB_POOL_MIN,
  CACHE_DB_POOL_MAX,
} from './config';
import { pool as cachePool } from './services/cache';
import { getRedisClient } from './services/redis';
import {
  startBackgroundServices,
  startPostListenServices,
  stopAllServices,
  flushBeforeClose,
  safeCloseCache,
} from './scheduler';

const app = createApp();

startBackgroundServices();

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  const location = CLOUD_FLARE_TUNNEL || `http://${SERVER_HOST}:${SERVER_PORT}`;
  console.log(`Levelhead proxy listening at ${location}`);
  console.log(`Cache DB pool configured with min=${CACHE_DB_POOL_MIN} max=${CACHE_DB_POOL_MAX}.`);

  startPostListenServices();

  void Promise.all([
    getRedisClient()?.ping().catch(() => {}),
    cachePool.query('SELECT 1').catch(() => {}),
  ]).then(() => console.info('[startup] connections warmed'));
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully...`);
  await stopAllServices();

  const forcedShutdown = setTimeout(() => {
    console.error('Forcing shutdown.');
    void safeCloseCache();
    process.exit(1);
  }, 15000);
  forcedShutdown.unref();

  try {
    await new Promise<void>((resolve) => {
      server.close((err?: Error) => {
        if (err) {
          console.error('Error closing HTTP server', err);
          process.exitCode = 1;
        }

        resolve();
      });
    });
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

process.on('exit', () => {
  void safeCloseCache();
});
