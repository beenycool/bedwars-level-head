import {
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS,
  DYNAMIC_RATE_LIMIT_ENABLED,
  DYNAMIC_RATE_LIMIT_MAX,
  DYNAMIC_RATE_LIMIT_MIN,
  HYPIXEL_HOURLY_QUOTA,
  PUBLIC_RATE_LIMIT_MAX,
} from '../config';
import { lookupSignals } from './rateLimitSignals';

/**
 * Restores the pre-rewrite dynamic per-client budget without Redis or extra tables.
 *
 * The old implementation asked PostgreSQL for active users, request counts and
 * Hypixel calls every ten seconds. The current process already has all of that in
 * memory: the token-bucket map knows how many clients are active, and lookup
 * tracking sees whether each resolution was a cache hit or a network call.
 */

/**
 * Until the first lookup arrives, assume the cache is warm enough to use the full
 * ceiling. That matches the old fixed budget; evidence from real traffic can only
 * tighten it from there.
 */
const DEFAULT_CACHE_HIT_RATE = 0.8;
/** Even a perfect cache still hits the network occasionally; never divide by zero. */
const MIN_CACHE_MISS_RATE = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function calculateDynamicLimit(activeClients: number, now: number = Date.now()): number {
  if (!DYNAMIC_RATE_LIMIT_ENABLED) {
    return PUBLIC_RATE_LIMIT_MAX;
  }

  const signals = lookupSignals(now);
  const cacheHitRate = signals.cacheHitRate ?? DEFAULT_CACHE_HIT_RATE;
  const cacheMissRate = Math.max(1 - cacheHitRate, MIN_CACHE_MISS_RATE);

  // Cached lookups do not spend Hypixel quota, so the same remaining quota covers
  // more lookups when the cache is warm.
  const remainingCalls = Math.max(0, HYPIXEL_HOURLY_QUOTA - signals.networkLastHour);
  const availablePerMinute = remainingCalls / 60 / cacheMissRate;

  // If the last minute already asked for more than the quota can absorb, shrink the
  // per-client budget further instead of waiting for the hourly window to drain.
  const demandPressure = Math.max(
    1,
    signals.identifiersLastMinute / Math.max(availablePerMinute, 1),
  );

  const fairShare = availablePerMinute / Math.max(1, activeClients) / demandPressure;
  return clamp(Math.round(fairShare), DYNAMIC_RATE_LIMIT_MIN, DYNAMIC_RATE_LIMIT_MAX);
}

let cached: { limit: number; computedAt: number } | null = null;

/** Ten-second cache: the formula is cheap, but every request does not need to run it. */
export function getDynamicPublicLimit(
  activeClients: number | (() => number),
  now: number = Date.now(),
): number {
  if (!DYNAMIC_RATE_LIMIT_ENABLED) {
    return PUBLIC_RATE_LIMIT_MAX;
  }
  if (cached && now - cached.computedAt < DYNAMIC_RATE_LIMIT_CACHE_TTL_MS) {
    return cached.limit;
  }

  const clients = typeof activeClients === 'function' ? activeClients() : activeClients;
  const limit = calculateDynamicLimit(clients, now);
  cached = { limit, computedAt: now };
  return limit;
}

export interface DynamicRateLimitSnapshot {
  enabled: boolean;
  limit: number;
  min: number;
  max: number;
  activeClients: number;
  networkCallsLastHour: number;
  cacheHitRate: number | null;
  hypixelRemaining: number;
  computedAt: Date;
}

export function dynamicRateLimitSnapshot(
  activeClients: number,
  now: number = Date.now(),
): DynamicRateLimitSnapshot {
  const signals = lookupSignals(now);
  const limit = getDynamicPublicLimit(activeClients, now);

  return {
    enabled: DYNAMIC_RATE_LIMIT_ENABLED,
    limit,
    min: DYNAMIC_RATE_LIMIT_MIN,
    max: DYNAMIC_RATE_LIMIT_MAX,
    activeClients,
    networkCallsLastHour: signals.networkLastHour,
    cacheHitRate: signals.cacheHitRate,
    hypixelRemaining: Math.max(0, HYPIXEL_HOURLY_QUOTA - signals.networkLastHour),
    computedAt: new Date(cached?.computedAt ?? now),
  };
}

/** Tests only. */
export function resetDynamicRateLimitCache(): void {
  cached = null;
}
