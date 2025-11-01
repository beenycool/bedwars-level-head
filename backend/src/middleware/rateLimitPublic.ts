import type { Request } from 'express';
import { PUBLIC_RATE_LIMIT_MAX, PUBLIC_RATE_LIMIT_WINDOW_MS } from '../config';
import { createRateLimitMiddleware, getClientIpAddress } from './rateLimit';

function getBucketKey(req: Request): string {
  const ip = getClientIpAddress(req);
  return `public:${ip}`;
}

export const enforcePublicRateLimit = createRateLimitMiddleware({
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_RATE_LIMIT_MAX,
  getBucketKey,
  metricLabel: 'public',
});
