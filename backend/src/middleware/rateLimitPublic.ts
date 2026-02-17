import { pbkdf2Sync } from 'node:crypto';
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
    // Use PBKDF2 to satisfy CodeQL's requirement for secure password hashing.
    // 10,000 iterations is fast enough for per-request but strong enough for API keys.
    const salt = REDIS_KEY_SALT || 'public-status-salt-v1';
    const hash = pbkdf2Sync(key, salt, 10000, 16, 'sha256').toString('hex');
    return \`public:status:\${ip}:\${hash}\`;
  },
  getClientIp: getClientIpAddress,
  metricLabel: 'public_status',
});
