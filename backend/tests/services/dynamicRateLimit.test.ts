jest.mock('../../src/config', () => ({
  DYNAMIC_RATE_LIMIT_ENABLED: true,
  DYNAMIC_RATE_LIMIT_MIN: 20,
  DYNAMIC_RATE_LIMIT_MAX: 600,
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS: 10_000,
  HYPIXEL_HOURLY_QUOTA: 7_200,
  PUBLIC_RATE_LIMIT_MAX: 600,
  PUBLIC_REQUEST_LIMIT_MAX: 1_200,
}));

import {
  calculateDynamicLimit,
  dynamicRateLimitSnapshot,
  getDynamicPublicLimit,
  resetDynamicRateLimitCache,
} from '../../src/services/dynamicRateLimit';
import {
  lookupSignals,
  recordLookupSignals,
  resetLookupSignals,
} from '../../src/services/rateLimitSignals';
import type { LookupObservation } from '../../src/services/lookupTracking';

const NOW = Date.parse('2026-11-16T12:00:00Z');

function observation(source: 'cache' | 'network'): LookupObservation {
  return {
    identifier: '530fa96a303d42199b5a329d493a5573',
    username: 'Notch',
    bedwarsExperience: 12_345,
    nicked: false,
    source,
    status: 200,
    latencyMs: 10,
  };
}

function record(count: number, source: 'cache' | 'network', at: number = NOW): void {
  recordLookupSignals(
    Array.from({ length: count }, () => observation(source)),
    at,
  );
}

beforeEach(() => {
  resetLookupSignals();
  resetDynamicRateLimitCache();
});

describe('lookup signals', () => {
  it('aggregates the last hour and ignores older minutes', () => {
    record(2, 'cache');
    record(1, 'network');
    record(5, 'network', NOW - 61 * 60_000);

    expect(lookupSignals(NOW)).toEqual({
      totalLastHour: 3,
      cacheHitsLastHour: 2,
      networkLastHour: 1,
      identifiersLastMinute: 3,
      cacheHitRate: 2 / 3,
    });
  });

  it('reports no cache ratio until a lookup has been seen', () => {
    expect(lookupSignals(NOW).cacheHitRate).toBeNull();
  });
});

describe('calculateDynamicLimit', () => {
  it('starts at the full ceiling until traffic provides evidence', () => {
    // 7,200 calls/hour ÷ 60 ÷ 20% assumed miss rate = 600 identifiers/minute.
    expect(calculateDynamicLimit(1, NOW)).toBe(600);
  });

  it('widens when the cache absorbs most lookups', () => {
    record(600, 'cache');
    expect(calculateDynamicLimit(1, NOW)).toBe(600);
  });

  it('tightens when recent lookups are all cache misses', () => {
    record(300, 'network');
    // 6,900 calls left ÷ 60 = 115/minute; 300 lookups already demanded in this
    // minute, so the fair share is 115 ÷ (300 ÷ 115) ≈ 44.
    expect(calculateDynamicLimit(1, NOW)).toBe(44);
  });

  it('divides the budget between active clients', () => {
    expect(calculateDynamicLimit(10, NOW)).toBe(60);
  });

  it('falls back to the floor when the Hypixel quota is nearly exhausted', () => {
    record(7_100, 'network');
    expect(calculateDynamicLimit(1, NOW)).toBe(20);
  });

  it('never rises above the configured ceiling', () => {
    record(1_000, 'cache');
    expect(calculateDynamicLimit(1, NOW)).toBe(600);
  });
});

describe('getDynamicPublicLimit', () => {
  it('reuses the computed value for the cache window', () => {
    expect(getDynamicPublicLimit(1, NOW)).toBe(600);
    // A new client count is ignored until the ten-second cache expires.
    expect(getDynamicPublicLimit(10, NOW + 9_999)).toBe(600);
    expect(getDynamicPublicLimit(10, NOW + 10_000)).toBe(60);
  });

  it('does not recount clients while the cache is warm', () => {
    expect(getDynamicPublicLimit(1, NOW)).toBe(600);

    let calls = 0;
    const clients = () => {
      calls += 1;
      return 10;
    };

    expect(getDynamicPublicLimit(clients, NOW + 1_000)).toBe(600);
    expect(calls).toBe(0);

    expect(getDynamicPublicLimit(clients, NOW + 10_000)).toBe(60);
    expect(calls).toBe(1);
  });

  it('exposes the inputs behind the current budget', () => {
    record(120, 'cache');
    const snapshot = dynamicRateLimitSnapshot(3, NOW);

    expect(snapshot).toMatchObject({
      enabled: true,
      limit: 600,
      min: 20,
      max: 600,
      activeClients: 3,
      cacheHitRate: 1,
    });
    expect(snapshot.hypixelRemaining).toBe(7_200);
  });
});
