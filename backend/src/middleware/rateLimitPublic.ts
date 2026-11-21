import type { Request } from 'express';
import {
  createRateLimitMiddleware,
  getClientIpAddress,
  publicBatchRateLimiter,
  publicRateLimiter,
  resolveBatchCost,
} from './rateLimit';

export const enforcePublicRateLimit = createRateLimitMiddleware({
  limiter: publicRateLimiter,
  getBucketKey: (req) => `public:${getClientIpAddress(req)}`,
  label: 'public',
});

export const enforcePublicBatchRateLimit = createRateLimitMiddleware({
  limiter: publicBatchRateLimiter,
  getBucketKey: (req) => `batch:${getClientIpAddress(req)}`,
  getCost: resolveBatchCost,
  label: 'public_batch',
});
