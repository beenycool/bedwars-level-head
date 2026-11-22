import {
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS,
  DYNAMIC_RATE_LIMIT_ENABLED,
  DYNAMIC_RATE_LIMIT_MAX,
  HYPIXEL_HOURLY_QUOTA,
  PUBLIC_RATE_LIMIT_MAX,
} from '../config';
import { lookupSignals } from './rateLimitSignals';
import { getUpstreamQuota } from './hypixel';

const DEFAULT_CACHE_HIT_RATE = 0.8;
/** Even a perfect cache still hits the network occasionally; never divide by zero. */
const MIN_CACHE_MISS_RATE = 0.05;
const MATERIAL_CLIENT_CHANGE_MIN = 2;
const MATERIAL_CLIENT_CHANGE_RATIO = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const activeClientSources = new Map<string, () => number>();

export function registerActiveClientSource(pool: string, source: () => number): void {
  activeClientSources.set(pool, source);
}

/** Active clients across every public pool, since they all spend one shared quota. */
export function combinedActiveClientCount(): number {
  let total = 0;
  for (const source of activeClientSources.values()) {
    total += source();
  }
  return total;
}

export function calculateDynamicLimit(
  activeClients: number,
  now: number,
  min: number,
  combinedClients: number = combinedActiveClientCount(),
): number {
  if (!DYNAMIC_RATE_LIMIT_ENABLED) {
    return PUBLIC_RATE_LIMIT_MAX;
  }

  const signals = lookupSignals(now);
  const cacheHitRate = signals.cacheHitRate ?? DEFAULT_CACHE_HIT_RATE;
  const cacheMissRate = Math.max(1 - cacheHitRate, MIN_CACHE_MISS_RATE);

  const remainingCalls = Math.max(0, HYPIXEL_HOURLY_QUOTA - signals.networkLastHour);
  let availablePerMinute = remainingCalls / 60 / cacheMissRate;

  // Hypixel enforces a 5-minute window; the hourly figure above is only an
  // average. When a header reading is available, never hand out more than the
  // remaining window can absorb.
  const quota = getUpstreamQuota();
  if (quota && quota.resetAt > now) {
    const secondsLeft = Math.max(1, (quota.resetAt - now) / 1000);
    const upstreamPerMinute = quota.remaining / (secondsLeft / 60);
    availablePerMinute = Math.min(availablePerMinute, upstreamPerMinute / cacheMissRate);
  }

  // If the last minute already asked for more than the quota can absorb, shrink the
  // per-client budget further instead of waiting for the hourly window to drain.
  const demandPressure = Math.max(
    1,
    signals.identifiersLastMinute / Math.max(availablePerMinute, 1),
  );

  const own = Math.max(1, Math.floor(activeClients));
  const total = Math.max(own, Math.floor(combinedClients));
  // Both pools draw from the same Hypixel quota, so each may only spend its
  // proportional slice of it. Dividing that slice by the pool's own clients keeps
  // the two limits from summing to roughly twice the shared allowance.
  const poolAllowance = availablePerMinute * (own / total);

  const fairShare = poolAllowance / own / demandPressure;
  return clamp(Math.round(fairShare), min, DYNAMIC_RATE_LIMIT_MAX);
}

interface CachedLimit {
  limit: number;
  computedAt: number;
  combinedClients: number;
}

const cached = new Map<string, CachedLimit>();

function resolveCount(
  value: number | (() => number) | undefined,
  fallback: () => number,
): number {
  if (value === undefined) {
    return fallback();
  }
  return typeof value === 'function' ? value() : value;
}

function materiallyChanged(previous: number, next: number): boolean {
  const delta = Math.abs(next - previous);
  return delta >= Math.max(MATERIAL_CLIENT_CHANGE_MIN, previous * MATERIAL_CLIENT_CHANGE_RATIO);
}

export function getDynamicPublicLimit(
  pool: string,
  activeClients: number | (() => number),
  now: number,
  min: number,
  combinedActiveClients?: number | (() => number),
): number {
  if (!DYNAMIC_RATE_LIMIT_ENABLED) {
    return PUBLIC_RATE_LIMIT_MAX;
  }

  const combinedClients = resolveCount(combinedActiveClients, combinedActiveClientCount);
  const hit = cached.get(pool);
  if (
    hit &&
    now - hit.computedAt < DYNAMIC_RATE_LIMIT_CACHE_TTL_MS &&
    !materiallyChanged(hit.combinedClients, combinedClients)
  ) {
    return hit.limit;
  }

  const clients = resolveCount(activeClients, () => 0);
  const limit = calculateDynamicLimit(clients, now, min, combinedClients);
  cached.set(pool, { limit, computedAt: now, combinedClients });
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
  combinedActiveClients?: number | (() => number),
): DynamicRateLimitSnapshot {
  const signals = lookupSignals(now);
  const combinedClients = resolveCount(combinedActiveClients, combinedActiveClientCount);
  const limit = getDynamicPublicLimit(pool, activeClients, now, min, combinedClients);

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
