import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { ServerResponse } from 'node:http';
import playerRouter from './routes/player';
import playerPublicRouter from './routes/playerPublic';
import adminRouter from './routes/admin';
import { HttpError } from './util/httpError';
import { ADMIN_API_KEYS, TRUST_PROXY_CIDRS, TRUST_SINGLE_PROXY_HOP } from './config';
import { checkDatabaseHealth } from './services/cache';
import { checkHypixelReachability, getCircuitBreakerState } from './services/hypixel';
import { sanitizeUrlForLogs, isIPInCIDR } from './util/requestUtils';
import { requestId } from './middleware/requestId';
import { logger } from './util/logger';

export function createApp(): express.Express {
  const app = express();

  app.use(requestId);

  // Browser CORS is not needed by the mod (no Origin header), so only same-origin
  // and header-less requests are allowed.
  app.use(cors((req, callback) => {
    const origin = req.headers.origin;
    const serverOrigin = `${req.protocol}://${req.get('host')}`;
    if (!origin || origin === serverOrigin) {
      callback(null, { origin: true });
      return;
    }
    callback(new Error('Not allowed by CORS'));
  }));

  app.use(helmet({
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }));

  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), browsing-topics=()');
    next();
  });

  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.id,
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: sanitizeUrlForLogs(req.url) }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }));

  if (TRUST_PROXY_CIDRS.length > 0) {
    app.set('trust proxy', (ip: string) => TRUST_PROXY_CIDRS.some((cidr) => isIPInCIDR(ip, cidr)));
  } else {
    // On Render/Cloudflare there is exactly one proxy hop in front of the process.
    // Without this every client would share the proxy's IP and one rate-limit bucket.
    app.set('trust proxy', TRUST_SINGLE_PROXY_HOP ? 1 : false);
  }

  app.use(compression());
  app.use(express.json({ limit: '16kb' }));

  app.use('/api/public/player', playerPublicRouter);
  app.use('/api/player', playerRouter);

  if (ADMIN_API_KEYS.length > 0) {
    app.use('/api/admin', adminRouter);
  }

  /** Liveness probe: no auth, no rate limiter, always reachable. */
  app.get('/healthz', async (_req, res) => {
    const [dbHealthy, hypixelHealthy] = await Promise.all([
      checkDatabaseHealth(),
      checkHypixelReachability(),
    ]);
    const circuitBreaker = getCircuitBreakerState();
    const healthy = dbHealthy;
    const status: 'ok' | 'degraded' | 'unhealthy' = !healthy
      ? 'unhealthy'
      : hypixelHealthy && circuitBreaker.state !== 'open'
        ? 'ok'
        : 'degraded';

    res.status(healthy ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      checks: { database: dbHealthy, hypixel: hypixelHealthy },
      circuitBreaker: { state: circuitBreaker.state },
    });
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
        const retryAfterSeconds = Number.parseInt(err.headers['Retry-After'], 10);
        if (!Number.isNaN(retryAfterSeconds)) {
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

  return app;
}
