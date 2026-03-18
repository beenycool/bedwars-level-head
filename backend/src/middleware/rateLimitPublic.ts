import type { Request } from 'express';
import { PUBLIC_RATE_LIMIT_MAX, PUBLIC_RATE_LIMIT_WINDOW_MS } from '../config';
import { createRateLimitMiddleware, getClientIpAddress } from './rateLimit';
import { MAX_BATCH_SIZE } from '../util/validationConstants';

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
  getCost(req: Request) {
    const body = req.body as { uuids?: unknown } | undefined;
    if (!body || !Array.isArray(body.uuids)) {
      return 1;
    }
    const uniqueIdentifiers = new Set<string>();
    for (const value of body.uuids) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          uniqueIdentifiers.add(trimmed);
        }
      }
    }
    return Math.min(MAX_BATCH_SIZE, Math.max(1, uniqueIdentifiers.size));
  },
  metricLabel: 'public_batch',
});
