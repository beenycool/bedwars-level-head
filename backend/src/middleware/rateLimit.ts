import type { Request, RequestHandler } from 'express';
import {
  PUBLIC_BATCH_RATE_LIMIT_MIN,
  PUBLIC_RATE_LIMIT_MAX,
  PUBLIC_RATE_LIMIT_WINDOW_MS,
  PUBLIC_REQUEST_LIMIT_MAX,
  PUBLIC_SINGLE_RATE_LIMIT_MIN,
} from '../config';
import { getDynamicPublicLimit, registerActiveClientSource } from '../services/dynamicRateLimit';
import { HttpError } from '../util/httpError';
import { logger } from '../util/logger';

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  /** Last allowed request. Drives the sweep and the active-client count. */
  updatedAt: number;
  /** Last token refill. A rejected request refreshes this but never `updatedAt`. */
  refilledAt: number;
}

const MAX_BUCKETS = 20_000;
/** Drain this far below the cap so the eviction sort is amortised, not per-request. */
const EVICTION_TARGET_RATIO = 0.9;
const SWEEP_INTERVAL_MS = 5_000;
const ACTIVE_CLIENTS_TTL_MS = 1_000;

export interface TokenBucketOptions {
  capacity: number;
  windowMs: number;
  getCapacity?: (activeClients: () => number, now: number) => number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxCapacity: number;
  private readonly windowMs: number;
  private readonly getCapacity: TokenBucketOptions['getCapacity'];
  private readonly sweepAfter: number;
  private lastSweepAt = 0;
  private activeCache: { at: number; count: number } | null = null;

  constructor(options: TokenBucketOptions) {
    this.maxCapacity = Math.max(1, Math.floor(options.capacity));
    this.windowMs = Math.max(1, options.windowMs);
    this.getCapacity = options.getCapacity;
    this.sweepAfter = Math.max(1000, options.windowMs * 2);
  }

  consume(key: string, cost: number = 1, now: number = Date.now()): ConsumeResult {
    const capacity = this.resolveCapacity(now);
    const refillPerMs = capacity / this.windowMs;
    const amount = Number.isFinite(cost) && cost > 0 ? Math.ceil(cost) : 1;
    const bucket = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now, refilledAt: now };

    if (now > bucket.refilledAt) {
      bucket.tokens = Math.min(
        capacity,
        bucket.tokens + (now - bucket.refilledAt) * refillPerMs,
      );
      bucket.refilledAt = now;
    } else if (bucket.tokens > capacity) {
      bucket.tokens = capacity;
    }

    if (bucket.tokens >= amount) {
      bucket.tokens -= amount;
      bucket.updatedAt = now;
      this.buckets.set(key, bucket);
      this.maintain(now);
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }

    this.buckets.set(key, bucket);
    this.maintain(now);
    const deficit = amount - bucket.tokens;
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: Math.ceil(deficit / refillPerMs),
    };
  }

  /**
   * Returns tokens after a cache hit. The identifier budget should only pay for
   * upstream work, so a request that never touched Hypixel gets its cost back.
   */
  refund(key: string, amount: number = 1, now: number = Date.now()): void {
    const tokens = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
    if (tokens === 0) {
      return;
    }

    const capacity = this.resolveCapacity(now);
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return;
    }

    if (now > bucket.refilledAt) {
      bucket.tokens = Math.min(
        capacity,
        bucket.tokens + (now - bucket.refilledAt) * (capacity / this.windowMs),
      );
      bucket.refilledAt = now;
    } else if (bucket.tokens > capacity) {
      bucket.tokens = capacity;
    }

    bucket.tokens = Math.min(capacity, bucket.tokens + tokens);
  }

  activeClients(now: number = Date.now()): number {
    const cache = this.activeCache;
    if (cache && now >= cache.at && now - cache.at < ACTIVE_CLIENTS_TTL_MS) {
      return cache.count;
    }
    const cutoff = now - this.windowMs;
    let active = 0;
    for (const bucket of this.buckets.values()) {
      if (bucket.updatedAt >= cutoff) {
        active += 1;
      }
    }
    this.activeCache = { at: now, count: active };
    return active;
  }

  private resolveCapacity(now: number): number {
    if (!this.getCapacity) {
      return this.maxCapacity;
    }
    const dynamic = this.getCapacity(() => this.activeClients(now), now);
    if (!Number.isFinite(dynamic)) {
      return this.maxCapacity;
    }
    return Math.min(this.maxCapacity, Math.max(1, Math.floor(dynamic)));
  }

  reset(): void {
    this.buckets.clear();
    this.activeCache = null;
  }

  get size(): number {
    return this.buckets.size;
  }

  private maintain(now: number): void {
    if (now < this.lastSweepAt || now - this.lastSweepAt >= SWEEP_INTERVAL_MS) {
      this.lastSweepAt = now;
      this.sweep(now);
    }
    if (this.buckets.size > MAX_BUCKETS) {
      this.evictOverflow();
    }
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > this.sweepAfter) {
        this.buckets.delete(key);
      }
    }
    this.activeCache = null;
  }

  private evictOverflow(): void {
    const target = Math.floor(MAX_BUCKETS * EVICTION_TARGET_RATIO);
    const entries = Array.from(this.buckets.entries()).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    for (let index = 0; index < entries.length && this.buckets.size > target; index += 1) {
      this.buckets.delete(entries[index][0]);
    }
    this.activeCache = null;
  }
}

function totalPublicActiveClients(now: number): number {
  return publicRateLimiter.activeClients(now) + publicBatchRateLimiter.activeClients(now);
}

/** Single-identifier lookups (legacy clients, whois). */
export const publicRateLimiter = new TokenBucketLimiter({
  capacity: PUBLIC_RATE_LIMIT_MAX,
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  getCapacity: (activeClients, now) =>
    getDynamicPublicLimit(
      'single',
      activeClients,
      now,
      PUBLIC_SINGLE_RATE_LIMIT_MIN,
      () => totalPublicActiveClients(now),
    ),
});

/** Batched lookups. Separate bucket so a lobby-sized batch cannot starve singles. */
export const publicBatchRateLimiter = new TokenBucketLimiter({
  capacity: PUBLIC_RATE_LIMIT_MAX,
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  getCapacity: (activeClients, now) =>
    getDynamicPublicLimit(
      'batch',
      activeClients,
      now,
      PUBLIC_BATCH_RATE_LIMIT_MIN,
      () => totalPublicActiveClients(now),
    ),
});

registerActiveClientSource('single', () => publicRateLimiter.activeClients());
registerActiveClientSource('batch', () => publicBatchRateLimiter.activeClients());

export const requestRateLimiter = new TokenBucketLimiter({
  capacity: Number.isFinite(PUBLIC_REQUEST_LIMIT_MAX) ? PUBLIC_REQUEST_LIMIT_MAX : 1_200,
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

export type PublicPool = 'single' | 'batch';

export function refundPublicTokens(
  req: Request,
  count: number,
  pool: PublicPool = 'single',
): void {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }
  const ip = getClientIpAddress(req);
  const limiter = pool === 'batch' ? publicBatchRateLimiter : publicRateLimiter;
  limiter.refund(`${pool === 'batch' ? 'batch' : 'public'}:${ip}`, Math.floor(count));
}

/**
 * Charge up to `count` identifiers, returning how many the bucket could actually
 * afford. Batch lookups use this after the cache warmup so cached players cost
 * nothing and a nearly-empty bucket still serves the hits it can.
 */
export function consumePublicTokens(
  req: Request,
  count: number,
  pool: PublicPool = 'single',
): number {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  const ip = getClientIpAddress(req);
  const limiter = pool === 'batch' ? publicBatchRateLimiter : publicRateLimiter;
  const key = `${pool === 'batch' ? 'batch' : 'public'}:${ip}`;

  const first = limiter.consume(key, count);
  if (first.allowed) {
    return count;
  }
  const available = Math.max(0, first.remaining);
  if (available === 0) {
    return 0;
  }
  const second = limiter.consume(key, available);
  return second.allowed ? available : 0;
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
      const cost = getCost ? getCost(req) : 1;
      const result = limiter.consume(key, cost);

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        logger.warn({
          label,
          bucket: key.substring(0, 24),
          session: req.header('x-levelhead-session') ?? 'none',
          install: req.header('x-levelhead-install') ?? 'none',
          ip: getClientIpAddress(req),
          cost,
          remaining: result.remaining,
          retryAfterMs: result.retryAfterMs,
        }, `[rate-limit] ${label} 429 (retry ${retryAfterSeconds}s)`);
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

export const enforceRequestRateLimit = createRateLimitMiddleware({
  limiter: requestRateLimiter,
  getBucketKey: (req) => `request:${getClientIpAddress(req)}`,
  label: 'request',
});

export const enforceAdminRateLimit = createRateLimitMiddleware({
  limiter: adminRateLimiter,
  getBucketKey: (req) => `admin:${getClientIpAddress(req)}`,
  label: 'admin',
});

export const enforceBatchRateLimit = createRateLimitMiddleware({
  limiter: publicBatchRateLimiter,
  getBucketKey: (req) => `batch:${getClientIpAddress(req)}`,
  label: 'legacy_batch',
});
