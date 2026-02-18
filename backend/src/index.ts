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
import { enforceAdminRateLimit } from './middleware/rateLimit';
import { enforceMonitoringAuth, isAuthorizedMonitoring } from './middleware/monitoringAuth';
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
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import crypto from 'crypto';
import { requestId } from './middleware/requestId';
import { logger } from './util/logger';
import { sanitizeUrlForLogs } from './util/requestUtils';
import { startGlobalLeaderElection, stopGlobalLeaderElection } from './services/globalLeader';

const app = express();
let globalPurgeInterval: ReturnType<typeof setInterval> | null = null;

async function startLeaderScopedServices(): Promise<void> {
  if (globalPurgeInterval) {
    return;
  }

  await purgeExpiredEntries().catch((error) => {
    logger.error('Failed to purge expired cache entries', error);
  });

  await initializeDynamicRateLimitService().catch((error) => {
    logger.error('Failed initializing dynamic rate limit service', error);
    throw error; // Let the caller (transitionToLeader) handle the failure
  });

  startKeyCountRefresher();

  globalPurgeInterval = setInterval(() => {
    void purgeExpiredEntries().catch((error) => {
      logger.error('Failed to purge expired cache entries', error);
    });
  }, 60 * 60 * 1000);
  globalPurgeInterval.unref();
}

async function stopLeaderScopedServices(): Promise<void> {
  if (globalPurgeInterval) {
    clearInterval(globalPurgeInterval);
    globalPurgeInterval = null;
  }

  stopDynamicRateLimitService();
  stopKeyCountRefresher();
}

app.use(requestId);
app.use((_req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (_req, res) => `'nonce-${(res as express.Response).locals.nonce}'`, "'strict-dynamic'"],
      styleSrc: ["'self'", (_req, res) => `'nonce-${(res as express.Response).locals.nonce}'`],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  frameguard: {
    action: 'deny',
  },
}));

app.use((_req, res, next) => {
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()');
  next();
});

app.use(pinoHttp({
  logger,
  genReqId: (req) => req.id,
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: sanitizeUrlForLogs(req.url),
    }),
  },
  customSuccessMessage: (req, res, responseTime) => {
    return `[request] ${req.method} ${sanitizeUrlForLogs(req.url)} -> ${res.statusCode} (${responseTime.toFixed(2)} ms)`;
  },
  customErrorMessage: (req, res, err) => {
    return `[request] ${req.method} ${sanitizeUrlForLogs(req.url)} -> ${res.statusCode} (${err.message})`;
  },
}));

function isIPInCIDR(ip: string, cidr: string): boolean {
  try {
    const parsed = ipaddr.parseCIDR(cidr);
    const network = parsed[0];
    const prefix = parsed[1];
    let parsedIp = ipaddr.parse(ip);

    // Handle IPv4-mapped IPv6 addresses
    if (parsedIp.kind() === 'ipv6') {
      const ipv6 = parsedIp as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        parsedIp = ipv6.toIPv4Address();
      }
    }

    // Match requires same address family
    if (parsedIp.kind() !== network.kind()) {
      return false;
    }

    // Use the match method with array format [address, prefix]
    if (parsedIp.kind() === 'ipv4') {
      return (parsedIp as ipaddr.IPv4).match([network as ipaddr.IPv4, prefix]);
    } else {
      return (parsedIp as ipaddr.IPv6).match([network as ipaddr.IPv6, prefix]);
    }
  } catch {
    return false;
  }
}

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

app.get('/healthz', enforceAdminRateLimit, async (req, res) => {
  // lgtm[js/missing-rate-limiting]
  res.locals.metricsRoute = '/healthz';
  const [dbHealthy, hypixelHealthy] = await Promise.all([
    cachePool
      .query('SELECT 1')
      .then(() => true)
      .catch((error) => {
        logger.error('Database health check failed', error);
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

  const response: Record<string, unknown> = {
    status,
    timestamp: new Date().toISOString(),
  };

  if (isAuthorizedMonitoring(req)) {
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

app.get('/metrics', enforceAdminRateLimit, enforceMonitoringAuth, async (_req, res) => {
  // lgtm[js/missing-rate-limiting]
  res.locals.metricsRoute = '/metrics';
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

void initializeResourceMetrics().catch((error) => {
  logger.error('Failed initializing resource metrics', error);
  process.exit(1);
});

// Start history flush interval
startHistoryFlushInterval();

startGlobalLeaderElection({
  onLeaderStart: startLeaderScopedServices,
  onLeaderStop: stopLeaderScopedServices,
});

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
    logger.error({ err }, 'Unexpected error');
    if (err.stack) {
      logger.error(err.stack);
    }
  } else {
    logger.error({ err: String(err) }, 'Unexpected error (non-Error object)');
  }
  res.status(500).json({ success: false, cause: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
});

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  const location = CLOUD_FLARE_TUNNEL || `http://${SERVER_HOST}:${SERVER_PORT}`;
  logger.info(`Levelhead proxy listening at ${location}`);
  logger.info(`Cache DB pool configured with min=${CACHE_DB_POOL_MIN} max=${CACHE_DB_POOL_MAX}.`);

  startAdaptiveTtlRefresh();

  void Promise.all([
    getRedisClient()?.ping().catch(() => {}),
    cachePool.query('SELECT 1').catch(() => {}),
  ]).then(() => logger.info('[startup] connections warmed'));
});

let shuttingDown = false;
let cacheClosePromise: Promise<void> | null = null;

function safeCloseCache(): Promise<void> {
  if (!cacheClosePromise) {
    cacheClosePromise = closeCache().catch((error) => {
      logger.error('Error closing cache database', error);
    });
  }

  return cacheClosePromise;
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  await stopGlobalLeaderElection().catch((error) => {
    logger.error('Error stopping global leader election during shutdown', error);
  });
  stopHistoryFlushInterval();
  stopAdaptiveTtlRefresh();
  stopResourceMetrics();

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
    // Flush history buffer before closing cache
    await flushHistoryBuffer().catch((error) => {
      logger.error('Error flushing history buffer during shutdown', error);
    });
    // Flush hypixel tracker buffer before closing cache
    await shutdownHypixelTracker().catch((error) => {
      logger.error('Error shutting down hypixel tracker during shutdown', error);
    });
    // Flush resource metrics before closing cache
    await flushResourceMetricsOnShutdown().catch(err => logger.error('Failed to flush resource metrics on shutdown', err));
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

// Best-effort cleanup; process.on('exit') is sync so async work may not complete.
// Proper shutdown should use the shutdown() signal handlers that await these.
process.on('exit', () => {
  void stopGlobalLeaderElection();
  void safeCloseCache();
});
