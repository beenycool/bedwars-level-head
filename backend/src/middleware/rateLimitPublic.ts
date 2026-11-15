import type { Request } from 'express';
import { createRateLimitMiddleware, getClientIpAddress, publicRateLimiter, resolveBatchCost } from './rateLimit';

/** All public surfaces share one per-IP bucket. */
function getBucketKey(req: Request): string {
  return `public:${getClientIpAddress(req)}`;
}

export const enforcePublicRateLimit = createRateLimitMiddleware({
  limiter: publicRateLimiter,
  getBucketKey,
  label: 'public',
});

export const enforcePublicBatchRateLimit = createRateLimitMiddleware({
  limiter: publicRateLimiter,
  getBucketKey,
  getCost: resolveBatchCost,
  label: 'public_batch',
});
