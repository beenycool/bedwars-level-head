import type { LookupObservation } from './lookupTracking';

/**
 * Rolling, in-memory demand signals for the dynamic rate limiter.
 *
 * Keeping one tiny bucket per minute avoids a database query on the hot path and
 * survives the database being unavailable. The counters reset on restart, which is
 * fine: the limiter starts at a conservative budget and fills in as traffic arrives.
 */
const WINDOW_MINUTES = 60;
const RECENT_CACHE_MINUTES = 5;

interface MinuteBucket {
  total: number;
  cacheHits: number;
  network: number;
}

const buckets = new Map<number, MinuteBucket>();

function minuteOf(now: number): number {
  return Math.floor(now / 60_000);
}

export function recordLookupSignals(observations: LookupObservation[], now: number = Date.now()): void {
  if (observations.length === 0) {
    return;
  }

  const minute = minuteOf(now);
  const bucket = buckets.get(minute) ?? { total: 0, cacheHits: 0, network: 0 };

  for (const observation of observations) {
    bucket.total += 1;
    if (observation.source === 'cache') {
      bucket.cacheHits += 1;
    } else {
      bucket.network += 1;
    }
  }

  buckets.set(minute, bucket);

  if (buckets.size > WINDOW_MINUTES + 10) {
    for (const key of buckets.keys()) {
      if (key < minute - WINDOW_MINUTES) {
        buckets.delete(key);
      }
    }
  }
}

export interface LookupSignals {
  totalLastHour: number;
  cacheHitsLastHour: number;
  networkLastHour: number;
  identifiersLastMinute: number;
  cacheHitRate: number | null;
}

export function lookupSignals(now: number = Date.now()): LookupSignals {
  const currentMinute = minuteOf(now);
  const oldestMinute = currentMinute - WINDOW_MINUTES;

  let totalLastHour = 0;
  let cacheHitsLastHour = 0;
  let networkLastHour = 0;
  let identifiersLastMinute = 0;
  let recentTotal = 0;
  let recentCacheHits = 0;

  for (const [minute, bucket] of buckets) {
    if (minute < oldestMinute || minute > currentMinute) {
      continue;
    }
    totalLastHour += bucket.total;
    cacheHitsLastHour += bucket.cacheHits;
    networkLastHour += bucket.network;
    if (minute === currentMinute) {
      identifiersLastMinute += bucket.total;
    }
    if (minute >= currentMinute - RECENT_CACHE_MINUTES + 1) {
      recentTotal += bucket.total;
      recentCacheHits += bucket.cacheHits;
    }
  }

  return {
    totalLastHour,
    cacheHitsLastHour,
    networkLastHour,
    identifiersLastMinute,
    cacheHitRate: recentTotal > 0 ? recentCacheHits / recentTotal : null,
  };
}

export function resetLookupSignals(): void {
  buckets.clear();
}
