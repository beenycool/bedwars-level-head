import {
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS,
  DYNAMIC_RATE_LIMIT_ENABLED,
  DYNAMIC_RATE_LIMIT_MAX,
  HYPIXEL_HOURLY_QUOTA,
  PUBLIC_RATE_LIMIT_MAX,
} from '../config';
import { lookupSignals } from './rateLimitSignals';

const DEFAULT_CACHE_HIT_RATE = 0.8;
/** Even a perfect cache still hits the network occasionally; never divide by zero. */
const MIN_CACHE_MISS_RATE = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function calculateDynamicLimit(
  activeClients: number,
  now: number,
  min: number,
): number {
  if (!DYNAMIC_RATE_LIMIT_ENABLED) {
    return PUBLIC_RATE_LIMIT_MAX;
  }

  const signals = lookupSignals(now);
  const cacheHitRate = signals.cacheHitRate ?? DEFAULT_CACHE_HIT_RATE;
  const cacheMissRate = Math.max(1 - cacheHitRate, MIN_CACHE_MISS_RATE);

  const remainingCalls = Math.max(0, HYPIXEL_HOURLY_QUOTA - signals.networkLastHour);
  const availablePerMinute = remainingCalls / 60 / cacheMissRate;

  // If the last minute already asked for more than the quota can absorb, shrink the
  // per-client budget further instead of waiting for the hourly window to drain.
  const demandPressure = Math.max(
    1,
    signals.identifiersLastMinute / Math.max(availablePerMinute, 1),
  );

  const fairShare = availablePerMinute / Math.max(1, activeClients) / demandPressure;
  return clamp(Math.round(fairShare), min, DYNAMIC_RATE_LIMIT_MAX);
}

// One cache entry per pool: single and batch limiters have their own active-client
// counts, so they must not read each other's computed limit.
const cached = new Map<string, { limit: number; computedAt: number }>();

export function getDynamicPublicLimit(
  pool: string,
  activeClients: number | (() => number),
  now: number,
  min: number,
): number {
  if (!DYNAMIC_RATE_LIMIT_ENABLED) {
    return PUBLIC_RATE_LIMIT_MAX;
  }
  const hit = cached.get(pool);
  if (hit && now - hit.computedAt < DYNAMIC_RATE_LIMIT_CACHE_TTL_MS) {
    return hit.limit;
  }

  const clients = typeof activeClients === 'function' ? activeClients() : activeClients;
  const limit = calculateDynamicLimit(clients, now, min);
  cached.set(pool, { limit, computedAt: now });
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
}

export function dynamicRateLimitSnapshot(
  pool: string,
  activeClients: number,
  now: number,
  min: number,
): DynamicRateLimitSnapshot {
  const signals = lookupSignals(now);
  const limit = getDynamicPublicLimit(pool, activeClients, now, min);

  return {
    enabled: DYNAMIC_RATE_LIMIT_ENABLED,
    limit,
    min,
    max: DYNAMIC_RATE_LIMIT_MAX,
    activeClients,
    networkCallsLastHour: signals.networkLastHour,
    cacheHitRate: signals.cacheHitRate,
    hypixelRemaining: Math.max(0, HYPIXEL_HOURLY_QUOTA - signals.networkLastHour),
  };
}

export function resetDynamicRateLimitCache(): void {
  cached.clear();
}
