import express from 'express';
import compression from 'compression';
import playerRouter from './routes/player';
import playerPublicRouter from './routes/playerPublic';
import apikeyPublicRouter from './routes/apikeyPublic';
import { HttpError } from './util/httpError';
import { TRUST_PROXY_CIDRS, CRON_API_KEYS } from './config';
import { pool as cachePool } from './services/cache';
import { observeRequest, registry } from './services/metrics';
import { checkHypixelReachability, getCircuitBreakerState } from './services/hypixel';
import { getRateLimitFallbackState } from './services/redis';
import adminRouter from './routes/admin';
import apikeyRouter from './routes/apikey';
import statsRouter from './routes/stats';
import configRouter from './routes/config';
import cronRouter from './routes/cron';
import helmet from 'helmet';
import crypto from 'crypto';
import { enforceAdminRateLimit } from './middleware/rateLimit';
import { sanitizeUrlForLogs, isIPInCIDR } from './util/requestUtils';

export function createApp(): express.Express {
  const app = express();

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

  app.set('trust proxy', (ip: string) => {
    return TRUST_PROXY_CIDRS.some((cidr) => isIPInCIDR(ip, cidr));
  });

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

  app.get('/healthz', enforceAdminRateLimit, async (_req, res) => {
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
      if (circuitBreaker.state === 'open') {
        status = 'degraded';
      }
      if (fallbackState.isInFallbackMode && fallbackState.requireRedis) {
        status = 'degraded';
      }
    }

    res.status(healthy ? 200 : 503).json({
      status,
      circuitBreaker: {
        state: circuitBreaker.state,
        failureCount: circuitBreaker.failureCount,
        ...(circuitBreaker.lastFailureAt ? { lastFailureAt: new Date(circuitBreaker.lastFailureAt).toISOString() } : {}),
        ...(circuitBreaker.nextRetryAt ? { nextRetryAt: new Date(circuitBreaker.nextRetryAt).toISOString() } : {}),
      },
      rateLimit: {
        requireRedis: fallbackState.requireRedis,
        fallbackMode: fallbackState.fallbackMode,
        isInFallbackMode: fallbackState.isInFallbackMode,
        ...(fallbackState.activatedAt ? { activatedAt: fallbackState.activatedAt } : {}),
      },
      checks: {
        database: dbHealthy,
        hypixel: hypixelHealthy,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/metrics', enforceAdminRateLimit, async (_req, res) => {
    res.locals.metricsRoute = '/metrics';
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
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

  return app;
}
