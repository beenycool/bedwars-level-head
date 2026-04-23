import { sql } from 'kysely';
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
import { initAllowedKeyHashes as initAdminKeyHashes } from './middleware/adminAuth';
import { initAllowedKeyHashes as initCronKeyHashes } from './middleware/cronAuth';

async function main(): Promise<void> {
  await Promise.all([initAdminKeyHashes(), initCronKeyHashes()]);

  const app = createApp();

  startBackgroundServices();

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    const listeningServer = app.listen(SERVER_PORT, SERVER_HOST, () => {
      listeningServer.off('error', onError);

      const location = CLOUD_FLARE_TUNNEL || `http://${SERVER_HOST}:${SERVER_PORT}`;
      console.log(`Levelhead proxy listening at ${location}`);
      console.log(`Cache DB pool configured with min=${CACHE_DB_POOL_MIN} max=${CACHE_DB_POOL_MAX}.`);

      startPostListenServices();

      void Promise.all([
        getRedisClient()?.ping().catch(() => {}),
        sql`SELECT 1`.execute(cachePool).catch(() => {}),
      ]).then(() => console.info('[startup] connections warmed'));

      resolve(listeningServer);
    });

    listeningServer.once('error', onError);
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

  process.once('beforeExit', () => {
    void safeCloseCache();
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
