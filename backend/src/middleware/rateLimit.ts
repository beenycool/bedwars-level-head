import type { Request, Response, NextFunction } from 'express';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '../config';
import { HttpError } from '../util/httpError';
import { rateLimitBlocksTotal } from '../services/metrics';

type Bucket = {
  count: number;
  windowStartedAt: number;
  lastUpdatedAt: number;
};

const buckets = new Map<string, Bucket>();
const BUCKET_TTL_MS = RATE_LIMIT_WINDOW_MS * 2;
const CLEANUP_INTERVAL_MS = RATE_LIMIT_WINDOW_MS;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastUpdatedAt > BUCKET_TTL_MS) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

function getBucketKey(req: Request): string {
  return req.installId;
}

export function enforceRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = getBucketKey(req);
  const bucket = buckets.get(key);

  if (!bucket) {
    buckets.set(key, { count: 1, windowStartedAt: now, lastUpdatedAt: now });
    next();
    return;
  }

  const elapsed = now - bucket.windowStartedAt;
  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStartedAt: now, lastUpdatedAt: now });
    next();
    return;
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((bucket.windowStartedAt + RATE_LIMIT_WINDOW_MS - now) / 1000);
    const retryAfterHeader = retryAfterSeconds.toString();
    res.set('Retry-After', retryAfterHeader);
    rateLimitBlocksTotal.inc();
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
}
