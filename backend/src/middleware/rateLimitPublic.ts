import type { Request } from 'express';
import { PUBLIC_RATE_LIMIT_MAX, PUBLIC_RATE_LIMIT_WINDOW_MS } from '../config';
import { HttpError } from '../util/httpError';
import { createRateLimitMiddleware } from './rateLimit';

function getBucketKey(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || '';
  if (!ip) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Unable to identify client IP address');
  }
  return `public:${ip}`;
}

export const enforcePublicRateLimit = createRateLimitMiddleware({
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_RATE_LIMIT_MAX,
  getBucketKey,
  metricLabel: 'public',
});
