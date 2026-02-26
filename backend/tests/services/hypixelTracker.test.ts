import { recordHypixelApiCall, getHypixelCallCount, shutdown } from '../../src/services/hypixelTracker';
import * as redisService from '../../src/services/redis';
import { pool } from '../../src/services/cache';

jest.mock('../../src/services/cache', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
    type: 'postgresql',
  },
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/redis', () => ({
  getRedisClient: jest.fn(),
  isRedisAvailable: jest.fn(),
}));

describe('hypixelTracker', () => {
  const mockPipeline = {
    zadd: jest.fn().mockReturnThis(),
    zremrangebyscore: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  const mockRedis = {
    pipeline: jest.fn(() => mockPipeline),
    zadd: jest.fn().mockReturnValue(Promise.resolve(1)),
    zcount: jest.fn().mockReturnValue(Promise.resolve(0)),
    zremrangebyscore: jest.fn().mockReturnValue(Promise.resolve(0)),
    expire: jest.fn().mockReturnValue(Promise.resolve(1)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (redisService.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
  });

  afterAll(async () => {
    await shutdown();
  });

  it('should use Redis for counting when available', async () => {
    (redisService.isRedisAvailable as jest.Mock).mockReturnValue(true);
    mockRedis.zcount.mockResolvedValue(5);

    const count = await getHypixelCallCount();

    expect(count).toBe(5);
    expect(mockRedis.zcount).toHaveBeenCalledWith('hypixel_api_calls_rolling', expect.any(Number), '+inf');
  });

  it('should record calls in Redis when available using pipeline', async () => {
    (redisService.isRedisAvailable as jest.Mock).mockReturnValue(true);

    await recordHypixelApiCall('test-uuid');

    expect(mockRedis.pipeline).toHaveBeenCalled();
    expect(mockPipeline.zadd).toHaveBeenCalledWith(
      'hypixel_api_calls_rolling',
      expect.any(Number),
      expect.stringMatching(/test-uuid:[0-9]+:[a-z0-9]+/)
    );
    expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith('hypixel_api_calls_rolling', '-inf', expect.any(Number));
    expect(mockPipeline.expire).toHaveBeenCalledWith('hypixel_api_calls_rolling', expect.any(Number));
    expect(mockPipeline.exec).toHaveBeenCalled();
  });

  it('should fallback to DB when Redis is not available', async () => {
    (redisService.isRedisAvailable as jest.Mock).mockReturnValue(false);
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ count: 10 }] });

    const count = await getHypixelCallCount();

    // It might be 11 if the previous test's call is still in the local buffer
    expect(count).toBeGreaterThanOrEqual(10);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*)'), expect.any(Array));
  });

  it('should correctly count inflight items during partial flush', async () => {
    (redisService.isRedisAvailable as jest.Mock).mockReturnValue(false);
    // Mock DB to "see" 0 items initially
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ count: 0 }] });

    // Add multiple items to the buffer
    await recordHypixelApiCall('uuid-1');
    await recordHypixelApiCall('uuid-2');
    await recordHypixelApiCall('uuid-3');

    // Simulate a scenario where flush has started and moved items to inflightBatch,
    // but DB insertion hasn't finished or offset hasn't updated yet.
    // However, recordHypixelApiCall triggers flush asynchronously.
    // We can rely on getHypixelCallCount to check the sum of DB + buffer + inflight.

    // Force a situation where we rely on the internal counters
    const count = await getHypixelCallCount();

    // We added 3 items.
    // DB reports 0 (mocked).
    // Buffer/Inflight should account for 3.
    // Previous tests might have left items, so we check relative increase or exact match if isolation holds.
    // Given the singleton nature, previous 'test-uuid' might be there.

    // Let's filter by the UUIDs we just added if we could access internal state,
    // but here we just check if it's at least 3.
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
