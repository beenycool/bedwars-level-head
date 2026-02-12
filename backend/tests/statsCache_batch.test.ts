import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock dependencies BEFORE importing statsCache
const mockMGet = jest.fn();
const mockSetEx = jest.fn();
const mockGet = jest.fn();

jest.mock('../src/services/redis', () => ({
  getRedisClient: () => ({
    status: 'ready',
    mget: mockMGet,
    setex: mockSetEx,
    get: mockGet,
  }),
  isRedisAvailable: () => true,
}));

jest.mock('../src/config', () => ({
  SWR_ENABLED: true,
  SWR_STALE_TTL_MS: 10000,
  PLAYER_L1_TTL_FALLBACK_MS: 60000,
  PLAYER_L1_TTL_MIN_MS: 1000,
  PLAYER_L1_TTL_MAX_MS: 300000,
  REDIS_CACHE_MAX_BYTES: 1000000,
  PLAYER_L1_TARGET_UTILIZATION: 0.8,
  PLAYER_L1_SAFETY_FACTOR: 0.9,
  PLAYER_L1_INFO_REFRESH_MS: 10000,
  PLAYER_L2_TTL_MS: 3600000,
  REDIS_KEY_SALT: 'test-salt',
  REDIS_STATS_BUCKET_SIZE_MS: 60000,
  RATE_LIMIT_WINDOW_MS: 60000,
}));

jest.mock('../src/services/metrics', () => ({
  recordCacheHit: jest.fn(),
  recordCacheTierHit: jest.fn(),
  recordCacheSourceHit: jest.fn(),
  recordCacheMiss: jest.fn(),
  recordCacheTierMiss: jest.fn(),
  recordCacheRefresh: jest.fn(),
}));

jest.mock('../src/services/cache', () => ({
  ensureInitialized: jest.fn(),
  shouldReadFromDb: jest.fn().mockReturnValue(false),
  markDbAccess: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('../src/services/hypixel', () => ({
  fetchHypixelPlayer: jest.fn(),
  extractMinimalStats: jest.fn(),
}));

import { getManyPlayerStatsFromCacheWithSWR } from '../src/services/statsCache';

describe('getManyPlayerStatsFromCacheWithSWR', () => {
  beforeEach(() => {
    mockMGet.mockReset();
  });

  it('should return empty map for empty input', async () => {
    const result = await getManyPlayerStatsFromCacheWithSWR([]);
    expect(result.size).toBe(0);
    expect(mockMGet).not.toHaveBeenCalled();
  });

  it('should use mget to fetch multiple keys', async () => {
    const identifiers = [
      { key: 'p1', uuid: 'uuid1' },
      { key: 'p2', uuid: 'uuid2' },
    ];

    // Mock redis return values
    const now = Date.now();
    const entry1 = {
      payload: { displayname: 'Player1' },
      expires_at: now + 60000,
      cached_at: now,
      etag: 'tag1',
      last_modified: now,
      source: 'hypixel'
    };

    mockMGet.mockResolvedValue([
      JSON.stringify(entry1),
      null // Cache miss for p2
    ]);

    const result = await getManyPlayerStatsFromCacheWithSWR(identifiers);

    expect(mockMGet).toHaveBeenCalledTimes(1);
    expect(mockMGet).toHaveBeenCalledWith('cache:p1', 'cache:p2');

    expect(result.size).toBe(1);
    const p1 = result.get('p1');
    expect(p1).toBeDefined();
    expect(p1?.value).toEqual({ displayname: 'Player1' });
    expect(p1?.isStale).toBe(false);

    expect(result.get('p2')).toBeUndefined();
  });
});
