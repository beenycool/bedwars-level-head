import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock dependencies BEFORE importing statsCache
const mockMGet = jest.fn();
const mockSetEx = jest.fn();
const mockGet = jest.fn();
const mockQuery = jest.fn();

// Create mock functions for metrics
const mockRecordCacheHit = jest.fn();
const mockRecordCacheTierHit = jest.fn();
const mockRecordCacheSourceHit = jest.fn();
const mockRecordCacheMiss = jest.fn();
const mockRecordCacheTierMiss = jest.fn();
const mockRecordCacheRefresh = jest.fn();

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
  recordCacheHit: mockRecordCacheHit,
  recordCacheTierHit: mockRecordCacheTierHit,
  recordCacheSourceHit: mockRecordCacheSourceHit,
  recordCacheMiss: mockRecordCacheMiss,
  recordCacheTierMiss: mockRecordCacheTierMiss,
  recordCacheRefresh: mockRecordCacheRefresh,
}));

jest.mock('../src/services/cache', () => ({
  ensureInitialized: jest.fn(),
  shouldReadFromDb: jest.fn().mockReturnValue(true), // Allow DB reads
  markDbAccess: jest.fn(),
  pool: {
    query: mockQuery,
    type: 'POSTGRESQL', // Default to Postgres for testing
  },
}));

jest.mock('../src/services/hypixel', () => ({
  fetchHypixelPlayer: jest.fn(),
  extractMinimalStats: jest.fn(),
}));

import { getManyPlayerStatsFromCacheWithSWR } from '../src/services/statsCache';

describe('getManyPlayerStatsFromCacheWithSWR (L2 Batch)', () => {
  beforeEach(() => {
    mockMGet.mockReset();
    mockQuery.mockReset();
    mockSetEx.mockReset();
    mockRecordCacheMiss.mockClear();
    mockRecordCacheTierMiss.mockClear();
  });

  it('should fetch from L2 (DB) when L1 (Redis) misses', async () => {
    const identifiers = [
      { key: 'p1', uuid: 'uuid1' },
      { key: 'p2', uuid: 'uuid2' },
    ];

    // L1 Miss for both
    mockMGet.mockResolvedValue([null, null]);

    // L2 Hit for p1
    const now = Date.now();
    const dbRow = {
      cache_key: 'p1',
      payload: JSON.stringify({ displayname: 'Player1' }),
      expires_at: now + 60000,
      cached_at: now,
      etag: 'tag1',
      last_modified: now,
      source: 'hypixel'
    };

    mockQuery.mockResolvedValue({
      rows: [dbRow],
      rowCount: 1,
    });

    const result = await getManyPlayerStatsFromCacheWithSWR(identifiers);

    // Verify L1 check
    expect(mockMGet).toHaveBeenCalledWith('cache:p1', 'cache:p2');

    // Verify L2 check - this is what we expect to FAIL initially
    // The implementation currently does NOT call pool.query
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const queryCall = mockQuery.mock.calls[0];
    const sql = queryCall[0] as string;
    const params = queryCall[1] as any[];

    expect(sql).toContain('SELECT');
    expect(sql).toContain('player_stats_cache');
    // For Postgres it should use ANY
    expect(sql).toContain('ANY($1)');
    expect(params[0]).toEqual(expect.arrayContaining(['p1', 'p2']));

    // Verify result
    expect(result.size).toBe(1);
    const p1 = result.get('p1');
    expect(p1).toBeDefined();
    expect(p1?.value).toEqual({ displayname: 'Player1' });
    expect(p1?.source).toBe('hypixel');

    // Verify L1 backfill
    expect(mockSetEx).toHaveBeenCalled();
    const setExKey = mockSetEx.mock.calls[0][0];
    expect(setExKey).toBe('cache:p1');
  });

  it('should record misses for keys not found in L2', async () => {
    const identifiers = [
      { key: 'p1', uuid: 'uuid1' },
      { key: 'p2', uuid: 'uuid2' },
    ];

    // L1 Miss for both
    mockMGet.mockResolvedValue([null, null]);

    // L2 Empty (both miss)
    mockQuery.mockResolvedValue({
      rows: [],
      rowCount: 0,
    });

    const result = await getManyPlayerStatsFromCacheWithSWR(identifiers);

    expect(result.size).toBe(0);

    // Verify metrics per key
    // recordCacheMiss('absent') called for each missing key
    expect(mockRecordCacheMiss).toHaveBeenCalledTimes(2);
    expect(mockRecordCacheMiss).toHaveBeenCalledWith('absent');

    // recordCacheTierMiss('l1', 'absent') called for each missing key (not strictly checked here but implied)
    // recordCacheTierMiss('l2', 'absent') called for each missing key
    expect(mockRecordCacheTierMiss).toHaveBeenCalledWith('l2', 'absent');
    // Total tier misses: 2 (L1) + 2 (L2) = 4 (approx, depends on impl detail of L1 miss recording in getManyPlayerStatsFromCacheWithSWR)
    // Actually, L1 miss recording is implicit or explicit?
    // In getManyPlayerStatsFromCacheWithSWR:
    // It doesn't seem to record L1 miss per key explicitly in the loop?
    // Let's check statsCache.ts source again for L1 miss recording.
  });
});
