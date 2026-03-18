import type { Request } from 'express';
import { PUBLIC_RATE_LIMIT_MAX, PUBLIC_RATE_LIMIT_WINDOW_MS } from '../config';
import { createRateLimitMiddleware, getClientIpAddress, resolveBatchCost } from './rateLimit';

function getBucketKey(req: Request): string {
  const ip = getClientIpAddress(req);
  return `public:${ip}`;
}

export const enforcePublicRateLimit = createRateLimitMiddleware({
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_RATE_LIMIT_MAX,
  getBucketKey,
  getClientIp: getClientIpAddress, // Pass raw IP for global stats tracking
  metricLabel: 'public',
});

// Cost-based rate limiter for public batch endpoints
export const enforcePublicBatchRateLimit = createRateLimitMiddleware({
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_RATE_LIMIT_MAX,
  getBucketKey,
  getClientIp: getClientIpAddress,
  getCost: resolveBatchCost,
  metricLabel: 'public_batch',
});
