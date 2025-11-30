import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  TRUST_PROXY_ENABLED,
} from '../config';
import { HttpError } from '../util/httpError';
import { rateLimitBlocksTotal } from '../services/metrics';
import { pool } from '../services/cache';
import { calculateDynamicRateLimit } from '../services/dynamicRateLimit';

interface DynamicLimitCacheEntry {
  value: number | null;
  expiresAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  getBucketKey(req: Request): string;
  metricLabel?: string;
  getDynamicMax?: () => Promise<number>;
}

interface RateLimitRow {
  count: number;
  window_start: number | string;
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

  const computed = await calculateDynamicRateLimit();
  dynamicLimitCache.value = computed;
  dynamicLimitCache.expiresAt = now + DYNAMIC_RATE_LIMIT_CACHE_TTL_MS;

  return computed;
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
    const now = Date.now();

    let key: string;
    try {
      key = getBucketKey(req);
    } catch (error) {
      next(error);
      return;
    }

    try {
      const windowStartCutoff = now - windowMs;
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
      const result = await pool.query<RateLimitRow>(
        `
        INSERT INTO rate_limits (key, count, window_start)
        VALUES ($1, 1, $2)
        ON CONFLICT (key) DO UPDATE
        SET
          count = CASE
            WHEN rate_limits.window_start < $3 THEN 1
            ELSE rate_limits.count + 1
          END,
          window_start = CASE
            WHEN rate_limits.window_start < $3 THEN $2
            ELSE rate_limits.window_start
          END
        RETURNING count, window_start
        `,
        [key, now, windowStartCutoff],
      );

      const row = result.rows[0];
      const count = row.count;
      const windowStartRaw = row.window_start;
      const windowStart =
        typeof windowStartRaw === 'string' ? Number.parseInt(windowStartRaw, 10) : windowStartRaw;

      console.info('[rate-limit] upsert', {
        key,
        count,
        windowStart: new Date(windowStart).toISOString(),
        windowMs,
        max: effectiveMax,
      });

      if (count > effectiveMax) {
        const retryAfterSeconds = Math.ceil((windowStart + windowMs - now) / 1000);
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
      next(error);
    }
  };
}

export const enforceRateLimit = createRateLimitMiddleware({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  getBucketKey(req: Request) {
    const ip = getClientIpAddress(req);
    return `private:${ip}`;
  },
  metricLabel: 'private',
  getDynamicMax: resolveDynamicLimitValue,
});
