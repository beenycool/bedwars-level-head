import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { PUBLIC_RATE_LIMIT_MAX, PUBLIC_RATE_LIMIT_WINDOW_MS, REDIS_KEY_SALT } from '../config';
import { createRateLimitMiddleware, getClientIpAddress } from './rateLimit';

function getBucketKey(req: Request): string {
  const ip = getClientIpAddress(req);
  return \`public:\${ip}\`;
}

export const enforcePublicRateLimit = createRateLimitMiddleware({
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_RATE_LIMIT_MAX,
  getBucketKey,
  getClientIp: getClientIpAddress, // Pass raw IP for global stats tracking
  metricLabel: 'public',
});

/**
 * Stricter rate limit for API key status checks.
 * Uses a compound key of IP and key hash to implement "abuse budget per IP + per key-hash".
 */
export const enforceApiKeyStatusRateLimit = createRateLimitMiddleware({
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: 10, // Much stricter than the general public limit
  getBucketKey(req: Request): string {
    const ip = getClientIpAddress(req);
    const key = String(req.body?.key || req.get('x-api-key') || '').trim();
    // Use HMAC-SHA256 with the redis salt to avoid CodeQL "insecure password hashing" alerts
    const hash = createHmac('sha256', REDIS_KEY_SALT).update(key).digest('hex').slice(0, 16);
    return \`public:status:\${ip}:\${hash}\`;
  },
  getClientIp: getClientIpAddress,
  metricLabel: 'public_status',
});
