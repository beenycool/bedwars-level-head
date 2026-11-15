import type { Request, RequestHandler } from 'express';
import { PUBLIC_RATE_LIMIT_MAX, PUBLIC_RATE_LIMIT_WINDOW_MS } from '../config';
import { HttpError } from '../util/httpError';
import { logger } from '../util/logger';
import { MAX_BATCH_SIZE } from '../util/validationConstants';
import { extractBatchIdentifiersFromBody } from '../util/requestUtils';

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface TokenBucketOptions {
  /** Maximum tokens available in a full bucket (one token = one identifier). */
  capacity: number;
  /** Time to refill an empty bucket. */
  windowMs: number;
}

/**
 * Single-instance in-memory token bucket.
 *
 * A bucket refills continuously at `capacity / windowMs`, so a lobby-sized burst
 * (one batch of ~100 identifiers) is admitted immediately while a sustained client
 * is still held to the per-minute budget. No Redis, no database, no network calls.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly sweepAfter: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = Math.max(1, Math.floor(options.capacity));
    this.refillPerMs = this.capacity / Math.max(1, options.windowMs);
    this.sweepAfter = Math.max(1000, options.windowMs * 2);
  }

  consume(key: string, cost: number = 1, now: number = Date.now()): ConsumeResult {
    const amount = Number.isFinite(cost) && cost > 0 ? Math.ceil(cost) : 1;
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };

    if (now > bucket.updatedAt) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) * this.refillPerMs);
      bucket.updatedAt = now;
    }

    if (bucket.tokens >= amount) {
      bucket.tokens -= amount;
      this.buckets.set(key, bucket);
      this.sweepIfNeeded(now);
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }

    this.buckets.set(key, bucket);
    const deficit = amount - bucket.tokens;
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: Math.ceil(deficit / this.refillPerMs),
    };
  }

  /** Test/ops helper: drop all buckets. */
  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Prevents unbounded memory growth from one-off IPs. */
  private sweepIfNeeded(now: number): void {
    if (this.buckets.size <= 10_000) {
      return;
    }
    for (const [key, bucket] of this.buckets) {
      // Idle for two windows: the bucket would be full again anyway.
      if (now - bucket.updatedAt > this.sweepAfter) {
        this.buckets.delete(key);
      }
    }
  }
}

export const publicRateLimiter = new TokenBucketLimiter({
  capacity: PUBLIC_RATE_LIMIT_MAX,
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
});

export const adminRateLimiter = new TokenBucketLimiter({
  capacity: 60,
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
});

/**
 * Resolves the client IP address. Relies on Express `req.ip`, which honours the
 * `trust proxy` setting configured in app.ts.
 */
export function getClientIpAddress(req: Request): string {
  if (req.ip) {
    return req.ip;
  }
  const socketIp = req.socket.remoteAddress;
  if (socketIp) {
    return socketIp;
  }
  throw new HttpError(400, 'INVALID_REQUEST', 'Unable to identify client IP address');
}

interface RateLimitOptions {
  limiter: TokenBucketLimiter;
  getBucketKey(req: Request): string;
  getCost?(req: Request): number;
  label: string;
}

export function createRateLimitMiddleware({
  limiter,
  getBucketKey,
  getCost,
  label,
}: RateLimitOptions): RequestHandler {
  return (req, _res, next): void => {
    try {
      const key = getBucketKey(req);
      const result = limiter.consume(key, getCost ? getCost(req) : 1);

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        logger.warn(`[rate-limit] ${label} 429 ${key.substring(0, 24)} (retry ${retryAfterSeconds}s)`);
        next(
          new HttpError(
            429,
            'RATE_LIMIT',
            `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
            { 'Retry-After': String(retryAfterSeconds) },
          ),
        );
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Legacy `/api/player` routes share the public budget so they cannot bypass it. */
export const enforceRateLimit = createRateLimitMiddleware({
  limiter: publicRateLimiter,
  getBucketKey: (req) => `public:${getClientIpAddress(req)}`,
  label: 'legacy',
});

export const enforceAdminRateLimit = createRateLimitMiddleware({
  limiter: adminRateLimiter,
  getBucketKey: (req) => `admin:${getClientIpAddress(req)}`,
  label: 'admin',
});

/** Each identifier in a batch costs one token. */
export function resolveBatchCost(req: Request): number {
  const uuidsValue = extractBatchIdentifiersFromBody(req.body);
  if (!uuidsValue) {
    return 1;
  }
  const unique = new Set<string>();
  for (const value of uuidsValue) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
      }
    }
  }
  return Math.min(MAX_BATCH_SIZE, Math.max(1, unique.size));
}

export const enforceBatchRateLimit = createRateLimitMiddleware({
  limiter: publicRateLimiter,
  getBucketKey: (req) => `public:${getClientIpAddress(req)}`,
  getCost: resolveBatchCost,
  label: 'legacy_batch',
});
