import express from 'express';
import playerRouter from './routes/player';
import { HttpError } from './util/httpError';
import { SERVER_HOST, SERVER_PORT, CLOUD_FLARE_TUNNEL } from './config';
import { purgeExpiredEntries, closeCache } from './services/cache';
import { metricsHandler, metricsMiddleware } from './services/metrics';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);
app.use('/api/player', playerRouter);

void purgeExpiredEntries().catch((error) => {
  console.error('Failed to purge expired cache entries', error);
});

const purgeInterval = setInterval(() => {
  void purgeExpiredEntries().catch((error) => {
    console.error('Failed to purge expired cache entries', error);
  });
}, 60 * 60 * 1000);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, cause: err.causeCode, message: err.message });
    return;
  }

  console.error('Unexpected error', err);
  res.status(500).json({ success: false, cause: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
});

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  const location = CLOUD_FLARE_TUNNEL || `http://${SERVER_HOST}:${SERVER_PORT}`;
  console.log(`Levelhead proxy listening at ${location}`);
});

let shuttingDown = false;
let cacheClosePromise: Promise<void> | null = null;

function safeCloseCache(): Promise<void> {
  if (!cacheClosePromise) {
    cacheClosePromise = closeCache().catch((error) => {
      console.error('Error closing cache database', error);
    });
  }

  return cacheClosePromise;
}

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully...`);
  clearInterval(purgeInterval);

  const forcedShutdown = setTimeout(() => {
    console.error('Forcing shutdown.');
    void safeCloseCache();
    process.exit(1);
  }, 5000);
  forcedShutdown.unref();

  server.close((err?: Error) => {
    if (err) {
      console.error('Error closing HTTP server', err);
      process.exitCode = 1;
    }

    safeCloseCache().finally(() => {
      clearTimeout(forcedShutdown);

      const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
      process.exit(exitCode);
    });
  });
}

const shutdownSignals = ['SIGINT', 'SIGTERM'] as const;

shutdownSignals.forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

process.on('exit', () => {
  clearInterval(purgeInterval);
  void safeCloseCache();
});
