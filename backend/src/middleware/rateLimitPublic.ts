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
  getClientIp: getClientIpAddress, // Pass raw IP for global stats tracking
  metricLabel: 'public',
});

// Cost-based rate limiter for public batch endpoint
// Each identifier in the batch counts as one token toward the rate limit
export const enforcePublicBatchRateLimit = createRateLimitMiddleware({
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_RATE_LIMIT_MAX,
  getBucketKey,
  getClientIp: getClientIpAddress,
  getCost(req: Request) {
    // Cost is the number of UUIDs in the batch request
    const body = req.body as { uuids?: unknown } | undefined;
    if (!body || !Array.isArray(body.uuids)) {
      return 1; // Minimum cost for invalid/empty requests
    }
    // Count unique, non-empty strings in a single pass
    const uniqueIdentifiers = new Set<string>();
    for (const value of body.uuids) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          uniqueIdentifiers.add(trimmed);
        }
      }
    }
    return Math.max(1, uniqueIdentifiers.size); // Minimum cost of 1
  },
  metricLabel: 'public_batch',
});
