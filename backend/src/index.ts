import express from 'express';
import playerRouter from './routes/player';
import { HttpError } from './util/httpError';
import {
  SERVER_HOST,
  SERVER_PORT,
  CLOUD_FLARE_TUNNEL,
  CACHE_DB_POOL_MAX,
  CACHE_DB_POOL_MIN,
} from './config';
import { purgeExpiredEntries, closeCache, pool as cachePool } from './services/cache';
import { observeRequest, registry } from './services/metrics';
import { checkHypixelReachability } from './services/hypixel';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1_000_000_000;
    const routeLabel =
      typeof res.locals.metricsRoute === 'string'
        ? res.locals.metricsRoute
        : req.baseUrl
          ? `${req.baseUrl}${req.route?.path ?? ''}`
          : req.route?.path ?? req.path;
    observeRequest(req.method, routeLabel, res.statusCode, durationSeconds);
  });
  next();
});

app.use('/api/player', playerRouter);

app.get('/healthz', async (_req, res) => {
  res.locals.metricsRoute = '/healthz';
  const [dbHealthy, hypixelHealthy] = await Promise.all([
    cachePool
      .query('SELECT 1')
      .then(() => true)
      .catch((error) => {
        console.error('Database health check failed', error);
        return false;
      }),
    checkHypixelReachability(),
  ]);

  const healthy = dbHealthy && hypixelHealthy;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: {
      database: dbHealthy,
      hypixel: hypixelHealthy,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', async (_req, res) => {
  res.locals.metricsRoute = '/metrics';
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

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
  console.log(`Cache DB pool configured with min=${CACHE_DB_POOL_MIN} max=${CACHE_DB_POOL_MAX}.`);
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

async function shutdown(signal: NodeJS.Signals): Promise<void> {
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
  clearInterval(purgeInterval);
  void safeCloseCache();
});
