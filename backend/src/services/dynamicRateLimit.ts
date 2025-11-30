import {
  DYNAMIC_RATE_LIMIT_ENABLED,
  DYNAMIC_RATE_LIMIT_MAX,
  DYNAMIC_RATE_LIMIT_MIN,
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS,
  HYPIXEL_API_QUOTA,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from '../config';
import { getActivePrivateUserCount, getPrivateRequestCount } from './cache';
import {
  activeUsersGauge,
  dynamicRateLimitGauge,
  getCacheHitRatio,
  hypixelApiCallsGauge,
  hypixelRemainingQuotaGauge,
} from './metrics';
import { getHypixelCallCount } from './hypixelTracker';

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue);
}

export async function calculateDynamicRateLimit(): Promise<number> {
  if (!DYNAMIC_RATE_LIMIT_ENABLED) {
    return RATE_LIMIT_MAX;
  }

  const now = Date.now();
  const windowCutoff = now - RATE_LIMIT_WINDOW_MS;
  const activeUsers = await getActivePrivateUserCount(windowCutoff);
  const requestCount = await getPrivateRequestCount(windowCutoff);
  const hypixelCalls = await getHypixelCallCount();
  const remainingQuota = Math.max(0, HYPIXEL_API_QUOTA - hypixelCalls);
  const cacheHitRatio = getCacheHitRatio();
  const cacheMissRate = Math.max(1 - cacheHitRatio, Number.EPSILON);
  const availableForNewRequests = remainingQuota / cacheMissRate;

  const demandPressure =
    availableForNewRequests > 0
      ? Math.max(1, requestCount / Math.max(availableForNewRequests, 1))
      : 1;

  const perIpLimitUnclamped =
    availableForNewRequests > 0
      ? availableForNewRequests / Math.max(activeUsers, 1) / demandPressure
      : DYNAMIC_RATE_LIMIT_MIN;

  const clampedLimit = clamp(perIpLimitUnclamped, DYNAMIC_RATE_LIMIT_MIN, DYNAMIC_RATE_LIMIT_MAX);

  activeUsersGauge.set(activeUsers);
  hypixelApiCallsGauge.set(hypixelCalls);
  hypixelRemainingQuotaGauge.set(remainingQuota);
  dynamicRateLimitGauge.set(clampedLimit);

  return Number.isFinite(clampedLimit) ? clampedLimit : DYNAMIC_RATE_LIMIT_MIN;
}

let refreshInterval: NodeJS.Timeout | null = null;

async function refreshDynamicRateLimit(): Promise<void> {
  try {
    await calculateDynamicRateLimit();
  } catch (error) {
    console.error('Failed to refresh dynamic rate limit', error);
  }
}

export async function initializeDynamicRateLimitService(): Promise<void> {
  if (!DYNAMIC_RATE_LIMIT_ENABLED || refreshInterval) {
    return;
  }

  await refreshDynamicRateLimit();
  refreshInterval = setInterval(() => {
    void refreshDynamicRateLimit();
  }, DYNAMIC_RATE_LIMIT_CACHE_TTL_MS);
  refreshInterval.unref();
}

export function stopDynamicRateLimitService(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
