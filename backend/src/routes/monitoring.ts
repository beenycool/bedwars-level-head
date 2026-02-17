import { Router } from 'express';
import { pool as cachePool } from '../services/cache';
import { checkHypixelReachability, getCircuitBreakerState } from '../services/hypixel';
import { getRateLimitFallbackState } from '../services/redis';
import { registry } from '../services/metrics';
import { enforceAdminRateLimit } from '../middleware/rateLimit';
import { enforceMonitoringAuth, isAuthorizedMonitoring } from '../middleware/monitoringAuth';

const router = Router();

type HealthStatus = 'ok' | 'degraded' | 'unhealthy';

interface HealthCheckResponse {
  status: HealthStatus;
  timestamp: string;
  circuitBreaker?: {
    state: string;
    failureCount: number;
    lastFailureAt?: string;
    nextRetryAt?: string;
  };
  rateLimit?: {
    requireRedis: boolean;
    fallbackMode: string;
    isInFallbackMode: boolean;
    activatedAt?: string;
  };
  checks?: {
    database: boolean;
    hypixel: boolean;
  };
}

router.get('/healthz', enforceAdminRateLimit, async (req, res) => {
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
  let status: HealthStatus = healthy
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

  const response: HealthCheckResponse = {
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

router.get('/metrics', enforceAdminRateLimit, enforceMonitoringAuth, async (_req, res) => {
  res.locals.metricsRoute = '/metrics';
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

export default router;
