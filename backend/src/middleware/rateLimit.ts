import type { NextFunction, Request, RequestHandler, Response } from 'express';
import ipaddr from 'ipaddr.js';
import {
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_REQUIRE_REDIS,
  RATE_LIMIT_FALLBACK_MODE,
  TRUST_PROXY_ENABLED,
  TRUST_PROXY_CIDRS,
  ADMIN_RATE_LIMIT_WINDOW_MS,
  ADMIN_RATE_LIMIT_MAX,
} from '../config';
import { HttpError } from '../util/httpError';
import { isIPInCIDR } from '../util/requestUtils';


/**
 * Extracts the client IP from X-Forwarded-For when the direct connection
 * is from a trusted proxy. Uses the leftmost (original client) IP.
 * Returns null if the header is missing, malformed, or the direct connection
 * is not from a trusted proxy.
 */
function extractClientIpFromForwarded(req: Request): string | null {
  if (!TRUST_PROXY_ENABLED || TRUST_PROXY_CIDRS.length === 0) return null;

  const directRemote = req.socket.remoteAddress;
  if (!directRemote) return null;

  // Only trust X-Forwarded-For when the direct connection is from a trusted proxy
  const isFromTrustedProxy = TRUST_PROXY_CIDRS.some((cidr) => isIPInCIDR(directRemote, cidr));
  if (!isFromTrustedProxy) return null;

  const forwarded = req.header('x-forwarded-for');
  if (!forwarded || typeof forwarded !== 'string') return null;

  // X-Forwarded-For format: "client, proxy1, proxy2" - leftmost is original client
  const first = forwarded.split(',')[0]?.trim();
  if (!first || first.length === 0) return null;

  // Validate it's a parseable IP
  try {
    ipaddr.parse(first);
    return first;
  } catch {
    return null;
  }
}
import { rateLimitBlocksTotal } from '../services/metrics';
import {
  incrementRateLimit,
  trackGlobalStats,
  RATE_LIMIT_ALLOW_ALL,
  RATE_LIMIT_DENY_ALL,
  getRateLimitFallbackState,
  type RateLimitResult,
} from '../services/redis';
import { calculateDynamicRateLimit } from '../services/dynamicRateLimit';
import { logger } from '../util/logger';

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
      logger.error('Dynamic rate limit calculation failed:', error);
      // Fallback to static max on error to prevent unhandled rejections
      return RATE_LIMIT_MAX;
    });

  dynamicLimitCache.pendingPromise = calculationPromise;
  return await calculationPromise;
}

/**
 * Resolves the client IP address, handling proxy deployments correctly.
 * When TRUST_PROXY_ENABLED, explicitly parses X-Forwarded-For when the direct
 * connection is from a trusted proxy CIDR, avoiding reliance on Express req.ip
 * which may be wrong if trust proxy is misconfigured.
 */
export function getClientIpAddress(req: Request): string {
  let ip: string | undefined;

  if (TRUST_PROXY_ENABLED) {
    const forwarded = extractClientIpFromForwarded(req);
    if (forwarded) {
      ip = forwarded;
    }
  }

  if (!ip) {
    ip = req.socket.remoteAddress ?? undefined;
  }

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
      // Validate that cost is a finite positive number to prevent DoS attacks with Infinity/NaN
      const rawCost = getCost ? getCost(req) : 1;
      cost = Number.isFinite(rawCost) && rawCost > 0 ? Math.floor(rawCost) : 1;
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
          logger.error('Failed to compute dynamic rate limit; falling back to static value', dynamicError);
        }
      }

      const result: RateLimitResult = await incrementRateLimit(bucketKey, windowMs, cost);

      // Handle fallback mode results
      if (result === RATE_LIMIT_DENY_ALL) {
        // Fail closed - Redis unavailable and RATE_LIMIT_FALLBACK_MODE=deny
        next(
          new HttpError(
            503,
            'SERVICE_UNAVAILABLE',
            'Rate limiting service unavailable. Please try again later.',
            { 'Retry-After': '60' },
          ),
        );
        return;
      }

      if (result === RATE_LIMIT_ALLOW_ALL) {
        // Fail open dangerously - Redis unavailable and RATE_LIMIT_FALLBACK_MODE=allow
        // Fire-and-forget stats tracking
        void trackGlobalStats(clientIp).catch((err) => {
          logger.error('[rate-limit] trackGlobalStats failed', err);
        });
        next();
        return;
      }

      if (result === null) {
        // Unexpected null result - respect RATE_LIMIT_REQUIRE_REDIS
        logger.warn('[rate-limit] Unexpected null result from incrementRateLimit');
        void trackGlobalStats(clientIp).catch((err) => {
          logger.error('[rate-limit] trackGlobalStats failed', err);
        });
        if (RATE_LIMIT_REQUIRE_REDIS) {
          next(
            new HttpError(
              503,
              'SERVICE_UNAVAILABLE',
              'Rate limiting service unavailable. Please try again later.',
              { 'Retry-After': '60' },
            ),
          );
          return;
        }
        next();
        return;
      }

      // Normal rate limit result
      const { count, ttl } = result;

      const fallbackState = getRateLimitFallbackState();

      // Fire-and-forget stats tracking with raw client IP (not prefixed bucket key)
      void trackGlobalStats(clientIp).catch((err) => {
        logger.error('[rate-limit] trackGlobalStats failed', err);
      });

      if (count > effectiveMax) {
        const retryAfterSeconds = Math.max(1, Math.ceil(ttl / 1000));
        const retryAfterHeader = retryAfterSeconds.toString();
        const labelValue = metricLabel ?? 'unknown';
        rateLimitBlocksTotal.inc({ type: labelValue });

        // Compact single-line log for rate limit hits
        const retryMins = Math.ceil(retryAfterSeconds / 60);
        const retryStr = retryMins >= 60 ? `${Math.ceil(retryMins / 60)}h` : `${retryMins}m`;
        logger.warn(
          `[rate-limit] 429 ${bucketKey.substring(0, 12)}... ` +
            `(count: ${count}/${effectiveMax}, retry: ${retryStr}` +
            `${fallbackState.isInFallbackMode ? ', fallback' : ''})`
        );

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
      logger.error('[rate-limit] unexpected error', error);
      if (RATE_LIMIT_REQUIRE_REDIS) {
        next(
          new HttpError(
            503,
            'SERVICE_UNAVAILABLE',
            'Rate limiting service unavailable. Please try again later.',
            { 'Retry-After': '60' },
          ),
        );
        return;
      }
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

// Stricter rate limiter for administrative endpoints
export const enforceAdminRateLimit = createRateLimitMiddleware({
  windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
  max: ADMIN_RATE_LIMIT_MAX,
  getBucketKey(req: Request) {
    return `admin:${getClientIpAddress(req)}`;
  },
  metricLabel: 'admin',
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
    // Count unique, non-empty strings in a single pass
    const uniqueIdentifiers = new Set<string>();
    for (const value of body.uuids) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          uniqueIdentifiers.add(trimmed);
        }
      }
    }
    return Math.max(1, uniqueIdentifiers.size); // Minimum cost of 1
  },
  metricLabel: 'batch',
  getDynamicMax: resolveDynamicLimitValue,
});
