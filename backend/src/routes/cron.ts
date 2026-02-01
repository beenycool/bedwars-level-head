import { Router } from 'express';
import { enforceCronAuth } from '../middleware/cronAuth';
import { createRateLimitMiddleware, getClientIpAddress } from '../middleware/rateLimit';
import { CRON_RATE_LIMIT_MAX, CRON_RATE_LIMIT_WINDOW_MS } from '../config';

const router = Router();

const enforceCronRateLimit = createRateLimitMiddleware({
  windowMs: CRON_RATE_LIMIT_WINDOW_MS,
  max: CRON_RATE_LIMIT_MAX,
  getBucketKey: (req) => `cron:${getClientIpAddress(req)}`,
  metricLabel: 'cron',
});

router.post('/ping', enforceCronAuth, enforceCronRateLimit, (_req, res) => {
  res.locals.metricsRoute = '/api/cron/ping';
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

export default router;
