import express from 'express';
import compression from 'compression';
import ipaddr from 'ipaddr.js';
import playerRouter from './routes/player';
import playerPublicRouter from './routes/playerPublic';
import apikeyPublicRouter from './routes/apikeyPublic';
import { HttpError } from './util/httpError';
import {
  SERVER_HOST,
  SERVER_PORT,
  CLOUD_FLARE_TUNNEL,
  CACHE_DB_POOL_MAX,
  CACHE_DB_POOL_MIN,
  TRUST_PROXY_CIDRS,
  CRON_API_KEYS,
} from './config';
import { purgeExpiredEntries, closeCache, pool as cachePool } from './services/cache';
import { observeRequest, registry } from './services/metrics';
import { checkHypixelReachability, getCircuitBreakerState } from './services/hypixel';
import { shutdown as shutdownHypixelTracker } from './services/hypixelTracker';
import { flushHistoryBuffer, startHistoryFlushInterval, stopHistoryFlushInterval } from './services/history';
import {
  initializeDynamicRateLimitService,
  stopDynamicRateLimitService,
} from './services/dynamicRateLimit';
import { startAdaptiveTtlRefresh, stopAdaptiveTtlRefresh } from './services/statsCache';
import { getRedisClient, getRateLimitFallbackState, startKeyCountRefresher, stopKeyCountRefresher } from './services/redis';
import {
  initializeResourceMetrics,
  stopResourceMetrics,
  flushResourceMetricsOnShutdown,
} from './services/resourceMetrics';
import adminRouter from './routes/admin';
import apikeyRouter from './routes/apikey';
import statsRouter from './routes/stats';
import configRouter from './routes/config';
import cronRouter from './routes/cron';
import { securityHeaders } from './middleware/securityHeaders';
import { isAuthorizedMonitoring, enforceMonitoringAuth } from './middleware/monitoringAuth';
import { enforceMonitoringRateLimit } from './middleware/rateLimit';
import { sanitizeUrlForLogs, isIPInCIDR } from './util/requestUtils';

const app = express();

app.disable('x-powered-by');
app.use(securityHeaders);


// Configure trust proxy with CIDR allowlist
app.set('trust proxy', (ip: string) => {
  return TRUST_PROXY_CIDRS.some((cidr) => isIPInCIDR(ip, cidr));
});
// Enable gzip compression for all responses (clients should send Accept-Encoding: gzip)
// Large Hypixel JSON payloads compress very well (often 80-90% reduction)
app.use(compression());
app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1_000_000_000;
    const durationMs = durationSeconds * 1000;
    const routeLabel =
      typeof res.locals.metricsRoute === 'string'
        ? res.locals.metricsRoute
        : req.baseUrl
          ? `${req.baseUrl}${req.route?.path ?? ''}`
          : req.route?.path ?? req.path;
    observeRequest(req.method, routeLabel, res.statusCode, durationSeconds);

    const rawTarget = req.originalUrl ?? req.url ?? routeLabel;
    const target = sanitizeUrlForLogs(rawTarget);
    const message = `[request] ${req.method} ${target} -> ${res.statusCode} (${durationMs.toFixed(2)} ms)`;
    if (res.statusCode >= 500) {
      console.error(message);
    } else if (res.statusCode === 429) {
      // Rate limit blocks are logged separately by the rate limit middleware
      // Skip duplicate logging here
    } else if (res.statusCode >= 400) {
      console.warn(message);
    } else {
      console.info(message);
    }
  });
  next();
});

app.use('/api/public/player', playerPublicRouter);
app.use('/api/public/apikey', apikeyPublicRouter);
app.use('/api/player', playerRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/apikey', apikeyRouter);
app.use('/api/config', configRouter);
if (CRON_API_KEYS.length > 0) {
  app.use('/api/cron', cronRouter);
}
app.use('/stats', statsRouter);

app.get('/healthz', enforceMonitoringRateLimit, async (_req, res) => {
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

  const circuitBreaker = getCircuitBreakerState();
  const fallbackState = getRateLimitFallbackState();
  const healthy = dbHealthy;
  let status: 'ok' | 'degraded' | 'unhealthy' = healthy
    ? (hypixelHealthy ? 'ok' : 'degraded')
    : 'unhealthy';

  if (status === 'ok') {
    // If circuit breaker is open, consider it degraded
    if (circuitBreaker.state === 'open') {
      status = 'degraded';
    }

    // If rate limiting is in fallback mode and requireRedis is true, mark as degraded
    if (fallbackState.isInFallbackMode && fallbackState.requireRedis) {
      status = 'degraded';
    }
  }

  const response: Record<string, any> = {
    status,
    timestamp: new Date().toISOString(),
  };

  if (isAuthorizedMonitoring(_req)) {
    response.circuitBreaker = {
      state: circuitBreaker.state,
      failureCount: circuitBreaker.failureCount,
      ...(circuitBreaker.lastFailureAt ? { lastFailureAt: new Date(circuitBreaker.lastFailureAt).toISOString() } : {}),
      ...(circuitBreaker.nextRetryAt ? { nextRetryAt: new Date(circuitBreaker.nextRetryAt).toISOString() } : {}),
    };
    response.rateLimit = {
      requireRedis: fallbackState.requireRedis,
      fallbackMode: fallbackState.fallbackMode,
      isInFallbackMode: fallbackState.isInFallbackMode,
      ...(fallbackState.activatedAt ? { activatedAt: fallbackState.activatedAt } : {}),
    };
    response.checks = {
      database: dbHealthy,
      hypixel: hypixelHealthy,
    };
  }

  res.status(healthy ? 200 : 503).json(response);
});

app.get('/metrics', enforceMonitoringRateLimit, enforceMonitoringAuth, async (_req, res) => {
  res.locals.metricsRoute = '/metrics';
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

void purgeExpiredEntries().catch((error) => {
  console.error('Failed to purge expired cache entries', error);
});

void initializeDynamicRateLimitService().catch((error) => {
  console.error('Failed initializing dynamic rate limit service', error);
  process.exit(1);
});

void initializeResourceMetrics().catch((error) => {
  console.error('Failed initializing resource metrics', error);
  process.exit(1);
});

// Start history flush interval
startHistoryFlushInterval();

const purgeInterval = setInterval(() => {
  void purgeExpiredEntries().catch((error) => {
    console.error('Failed to purge expired cache entries', error);
  });
}, 60 * 60 * 1000);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    if (err.headers) {
      Object.entries(err.headers).forEach(([key, value]) => {
        if (!res.headersSent) {
          res.set(key, value);
        }
      });
    }
    // Build response body with retry info for rate limit errors
    const responseBody: Record<string, unknown> = { success: false, cause: err.causeCode, message: err.message };
    if (err.status === 429 && err.headers?.['Retry-After']) {
      const retryAfterSeconds = parseInt(err.headers['Retry-After'], 10);
      if (!isNaN(retryAfterSeconds)) {
        responseBody.retryAfter = retryAfterSeconds;
        responseBody.retryAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
      }
    }
    
    res.status(err.status).json(responseBody);
    return;
  }

  if (err instanceof Error) {
    console.error('Unexpected error:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
  } else {
    console.error('Unexpected error (non-Error object):', String(err));
  }
  res.status(500).json({ success: false, cause: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
});

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  const location = CLOUD_FLARE_TUNNEL || `http://${SERVER_HOST}:${SERVER_PORT}`;
  console.log(`Levelhead proxy listening at ${location}`);
  console.log(`Cache DB pool configured with min=${CACHE_DB_POOL_MIN} max=${CACHE_DB_POOL_MAX}.`);

  startAdaptiveTtlRefresh();
  startKeyCountRefresher();

  void Promise.all([
    getRedisClient()?.ping().catch(() => {}),
    cachePool.query('SELECT 1').catch(() => {}),
  ]).then(() => console.info('[startup] connections warmed'));
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
  stopHistoryFlushInterval();
  stopDynamicRateLimitService();
  stopAdaptiveTtlRefresh();
  stopKeyCountRefresher();
  stopResourceMetrics();

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
    // Flush history buffer before closing cache
    await flushHistoryBuffer().catch((error) => {
      console.error('Error flushing history buffer during shutdown', error);
    });
    // Flush hypixel tracker buffer before closing cache
    await shutdownHypixelTracker().catch((error) => {
      console.error('Error shutting down hypixel tracker during shutdown', error);
    });
    // Flush resource metrics before closing cache
    await flushResourceMetricsOnShutdown().catch(err => console.error('Failed to flush resource metrics on shutdown', err));
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
