import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  TRUST_PROXY_ENABLED,
} from '../config';
import { HttpError } from '../util/httpError';
import { rateLimitBlocksTotal } from '../services/metrics';
import { incrementRateLimit, trackGlobalStats, isRedisAvailable } from '../services/redis';
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
  metricLabel,
  getDynamicMax,
}: RateLimitOptions): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    let ip: string;
    try {
      ip = getBucketKey(req);
    } catch (error) {
      next(error);
      return;
    }

    // If Redis is not available, fail open (allow request)
    if (!isRedisAvailable()) {
      console.warn('[rate-limit] Redis unavailable, failing open');
      next();
      return;
    }

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

      const result = await incrementRateLimit(ip, windowMs);

      // If Redis operation failed, fail open
      if (result === null) {
        console.warn('[rate-limit] Redis increment failed, failing open');
        // Fire-and-forget stats tracking (with catch to prevent unhandled rejection)
        void trackGlobalStats(ip).catch((err) => {
          console.error('[rate-limit] trackGlobalStats failed', err);
        });
        next();
        return;
      }

      const { count, ttl } = result;

      console.info('[rate-limit] check', {
        ip: ip.substring(0, 8) + '...', // Log partial IP for privacy
        count,
        ttl,
        max: effectiveMax,
      });

      // Fire-and-forget stats tracking (with catch to prevent unhandled rejection)
      void trackGlobalStats(ip).catch((err) => {
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
