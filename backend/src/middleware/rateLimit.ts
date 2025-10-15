import type { Request, Response, NextFunction } from 'express';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '../config';
import { HttpError } from '../util/httpError';

type Bucket = {
  count: number;
  windowStartedAt: number;
};

const buckets = new Map<string, Bucket>();

function getBucketKey(req: Request): string {
  if (req.installId) {
    return req.installId;
  }

  return req.ip || 'unknown';
}

export function enforceRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = getBucketKey(req);
  const bucket = buckets.get(key);

  if (!bucket) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    next();
    return;
  }

  const elapsed = now - bucket.windowStartedAt;
  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    next();
    return;
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((bucket.windowStartedAt + RATE_LIMIT_WINDOW_MS - now) / 1000);
    res.set('Retry-After', retryAfterSeconds.toString());
    throw new HttpError(429, 'RATE_LIMIT', `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`);
  }

  bucket.count += 1;
  next();
}
