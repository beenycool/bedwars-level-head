import { createApp } from './app';
import { SERVER_HOST, SERVER_PORT } from './config';
import { logger } from './util/logger';
import { startBackgroundServices, stopBackgroundServices, safeCloseCache } from './scheduler';
import { initAllowedKeyHashes as initAdminKeyHashes } from './middleware/adminAuth';

async function main(): Promise<void> {
  await initAdminKeyHashes();

  const app = createApp();
  startBackgroundServices();

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    const listeningServer = app.listen(SERVER_PORT, SERVER_HOST, () => {
      listeningServer.off('error', onError);
      logger.info(`Levelhead proxy listening on ${SERVER_HOST}:${SERVER_PORT}`);
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
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    await stopBackgroundServices();

    const forcedShutdown = setTimeout(() => {
      logger.error('Forcing shutdown.');
      void safeCloseCache();
      process.exit(1);
    }, 10_000);
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
    } finally {
      await safeCloseCache();
      clearTimeout(forcedShutdown);
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    }
  }

  (['SIGINT', 'SIGTERM'] as const).forEach((signal) => {
    process.on(signal, () => {
      void shutdown(signal);
    });
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
