import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '../config';
import { HttpError } from '../util/httpError';
import { rateLimitBlocksTotal } from '../services/metrics';

type Bucket = {
  count: number;
  windowStartedAt: number;
  lastUpdatedAt: number;
};

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  getBucketKey(req: Request): string;
  metricLabel?: string;
}

export function createRateLimitMiddleware({
  windowMs,
  max,
  getBucketKey,
  metricLabel,
}: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const bucketTtlMs = windowMs * 2;
  const cleanupIntervalMs = windowMs;

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastUpdatedAt > bucketTtlMs) {
        buckets.delete(key);
      }
    }
  }, cleanupIntervalMs);

  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();

    let key: string;
    try {
      key = getBucketKey(req);
    } catch (error) {
      next(error);
      return;
    }

    const bucket = buckets.get(key);

    if (!bucket) {
      buckets.set(key, { count: 1, windowStartedAt: now, lastUpdatedAt: now });
      next();
      return;
    }

    const elapsed = now - bucket.windowStartedAt;
    if (elapsed >= windowMs) {
      buckets.set(key, { count: 1, windowStartedAt: now, lastUpdatedAt: now });
      next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.ceil((bucket.windowStartedAt + windowMs - now) / 1000);
      const retryAfterHeader = retryAfterSeconds.toString();
      const labelValue = metricLabel ?? 'unknown';
      rateLimitBlocksTotal.inc({ type: labelValue });
      throw new HttpError(
        429,
        'RATE_LIMIT',
        `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
        { 'Retry-After': retryAfterHeader },
      );
    }

    bucket.count += 1;
    bucket.lastUpdatedAt = now;
    next();
  };
}

export const enforceRateLimit = createRateLimitMiddleware({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  getBucketKey(req: Request) {
    if (!req.installId) {
      throw new Error('installId is required for authenticated rate limiting');
    }
    return req.installId;
  },
  metricLabel: 'authenticated',
});
