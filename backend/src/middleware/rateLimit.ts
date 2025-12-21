import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  TRUST_PROXY_ENABLED,
} from '../config';
import { HttpError } from '../util/httpError';
import { rateLimitBlocksTotal } from '../services/metrics';
import { incrementRateLimit, trackGlobalStats } from '../services/redis';
import { calculateDynamicRateLimit } from '../services/dynamicRateLimit';

interface DynamicLimitCacheEntry {
  value: number | null;
  expiresAt: number;
  pendingPromise?: Promise<number>;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  getBucketKey(req: Request): string;
  getClientIp?(req: Request): string; // Optional: used for global stats tracking, defaults to getBucketKey
  getCost?(req: Request): number; // Optional: cost per request for token-bucket limiting, defaults to 1
  metricLabel?: string;
  getDynamicMax?: () => Promise<number>;
}

const dynamicLimitCache: DynamicLimitCacheEntry = {
  value: null,
  expiresAt: 0,
};

async function resolveDynamicLimitValue(): Promise<number> {
  const now = Date.now();
  if (dynamicLimitCache.value !== null && now < dynamicLimitCache.expiresAt) {
    return dynamicLimitCache.value;
  }

  // If there's already a pending calculation, wait for it
  if (dynamicLimitCache.pendingPromise) {
    return await dynamicLimitCache.pendingPromise;
  }

  // Start a new calculation
  const calculationPromise = calculateDynamicRateLimit()
    .then((computed) => {
      dynamicLimitCache.value = computed;
      dynamicLimitCache.expiresAt = Date.now() + DYNAMIC_RATE_LIMIT_CACHE_TTL_MS;
      dynamicLimitCache.pendingPromise = undefined;
      return computed;
    })
    .catch((error) => {
      dynamicLimitCache.pendingPromise = undefined;
      console.error('Dynamic rate limit calculation failed:', error);
      // Fallback to static max on error to prevent unhandled rejections
      return RATE_LIMIT_MAX;
    });

  dynamicLimitCache.pendingPromise = calculationPromise;
  return await calculationPromise;
}

export function getClientIpAddress(req: Request): string {
  const ip = TRUST_PROXY_ENABLED ? req.ip : req.socket.remoteAddress ?? '';
  if (!ip) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Unable to identify client IP address');
  }

  return ip;
}

export function createRateLimitMiddleware({
  windowMs,
  max,
  getBucketKey,
  getClientIp,
  getCost,
  metricLabel,
  getDynamicMax,
}: RateLimitOptions): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    let bucketKey: string;
    let clientIp: string;
    let cost: number;
    try {
      bucketKey = getBucketKey(req);
      // Use getClientIp for global stats tracking if provided, otherwise extract from bucketKey
      clientIp = getClientIp ? getClientIp(req) : bucketKey;
      // Use getCost if provided, otherwise default to 1
      cost = getCost ? Math.max(1, getCost(req)) : 1;
    } catch (error) {
      next(error);
      return;
    }

    // Note: We always enforce rate limiting using incrementRateLimit() which has
    // built-in in-memory fallback when Redis is unavailable. This ensures rate
    // limiting remains effective even during Redis outages.

    try {
      let effectiveMax = max;
      if (getDynamicMax) {
        try {
          const dynamicValue = await getDynamicMax();
          if (Number.isFinite(dynamicValue) && dynamicValue > 0) {
            effectiveMax = Math.max(1, Math.floor(dynamicValue));
          }
        } catch (dynamicError) {
          console.error('Failed to compute dynamic rate limit; falling back to static value', dynamicError);
        }
      }

      const result = await incrementRateLimit(bucketKey, windowMs, cost);

      // If Redis operation failed, fail open
      if (result === null) {
        console.warn('[rate-limit] Redis increment failed, failing open');
        // Fire-and-forget stats tracking with raw client IP (not prefixed bucket key)
        void trackGlobalStats(clientIp).catch((err) => {
          console.error('[rate-limit] trackGlobalStats failed', err);
        });
        next();
        return;
      }

      const { count, ttl } = result;

      console.info('[rate-limit] check', {
        ip: bucketKey.substring(0, 8) + '...', // Log partial bucket key for privacy
        count,
        cost,
        ttl,
        max: effectiveMax,
      });

      // Fire-and-forget stats tracking with raw client IP (not prefixed bucket key)
      void trackGlobalStats(clientIp).catch((err) => {
        console.error('[rate-limit] trackGlobalStats failed', err);
      });

      if (count > effectiveMax) {
        const retryAfterSeconds = Math.max(1, Math.ceil(ttl / 1000));
        const retryAfterHeader = retryAfterSeconds.toString();
        const labelValue = metricLabel ?? 'unknown';
        rateLimitBlocksTotal.inc({ type: labelValue });
        next(
          new HttpError(
            429,
            'RATE_LIMIT',
            `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
            { 'Retry-After': retryAfterHeader },
          ),
        );
        return;
      }

      next();
    } catch (error) {
      // On any error, fail open
      console.error('[rate-limit] unexpected error, failing open', error);
      next();
    }
  };
}

export const enforceRateLimit = createRateLimitMiddleware({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  getBucketKey(req: Request) {
    return getClientIpAddress(req);
  },
  metricLabel: 'private',
  getDynamicMax: resolveDynamicLimitValue,
});

// Cost-based rate limiter for batch endpoint
// Each identifier in the batch counts as one token toward the rate limit
export const enforceBatchRateLimit = createRateLimitMiddleware({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  getBucketKey(req: Request) {
    return getClientIpAddress(req);
  },
  getCost(req: Request) {
    // Cost is the number of UUIDs in the batch request
    const body = req.body as { uuids?: unknown } | undefined;
    if (!body || !Array.isArray(body.uuids)) {
      return 1; // Minimum cost for invalid/empty requests
    }
    // Filter to unique, non-empty strings and count them
    const normalizedInput = body.uuids
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0);
    const uniqueCount = new Set(normalizedInput).size;
    return Math.max(1, uniqueCount); // Minimum cost of 1
  },
  metricLabel: 'batch',
  getDynamicMax: resolveDynamicLimitValue,
});
