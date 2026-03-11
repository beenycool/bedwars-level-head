import { Router } from 'express';
import { enforceCronAuth } from '../middleware/cronAuth';
import { createRateLimitMiddleware, getClientIpAddress } from '../middleware/rateLimit';
import { CRON_RATE_LIMIT_MAX, CRON_RATE_LIMIT_WINDOW_MS } from '../config';
import { listApiKeys } from '../services/apiKeyManager';

const router = Router();

const enforceCronRateLimit = createRateLimitMiddleware({
  windowMs: CRON_RATE_LIMIT_WINDOW_MS,
  max: CRON_RATE_LIMIT_MAX,
  getBucketKey: (req) => `cron:${getClientIpAddress(req)}`,
  metricLabel: 'cron',
});

router.post('/ping', enforceCronRateLimit, enforceCronAuth, (_req, res) => {
  res.locals.metricsRoute = '/api/cron/ping';
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/cron/apikey-status
 * Returns status of all stored API keys for monitoring
 */
router.get('/apikey-status', enforceCronRateLimit, enforceCronAuth, async (_req, res, next) => {
  res.locals.metricsRoute = '/api/cron/apikey-status';

  try {
    const keys = await listApiKeys();
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // ⚡ Bolt: Avoid O(N) memory allocation from Array.filter().length
    const summary = {
      total: keys.length,
      valid: 0,
      invalid: 0,
      pending: 0,
      unknown: 0,
      stale: 0,
    };

    for (const k of keys) {
      if (k.validationStatus === 'valid') summary.valid++;
      else if (k.validationStatus === 'invalid') summary.invalid++;
      else if (k.validationStatus === 'pending') summary.pending++;
      else if (k.validationStatus === 'unknown') summary.unknown++;

      if (k.lastValidatedAt && now - k.lastValidatedAt > oneHour) {
        summary.stale++;
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary,
      keys: keys.map((key) => ({
        keyHash: key.keyHash,
        validationStatus: key.validationStatus,
        lastValidatedAt: key.lastValidatedAt,
        validatedCount: key.validatedCount,
        ...(key.errorMessage && { error: key.errorMessage }),
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
