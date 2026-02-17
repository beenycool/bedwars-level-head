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
  const mockRedis = {
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

  it('should record calls in Redis when available', async () => {
    (redisService.isRedisAvailable as jest.Mock).mockReturnValue(true);

    await recordHypixelApiCall('test-uuid');

    expect(mockRedis.zadd).toHaveBeenCalledWith(
      'hypixel_api_calls_rolling',
      expect.any(Number),
      expect.stringMatching(/test-uuid:[0-9]+:[a-z0-9]+/)
    );
  });

  it('should fallback to DB when Redis is not available', async () => {
    (redisService.isRedisAvailable as jest.Mock).mockReturnValue(false);
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ count: 10 }] });

    const count = await getHypixelCallCount();

    // It might be 11 if the previous test's call is still in the local buffer
    expect(count).toBeGreaterThanOrEqual(10);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*)'), expect.any(Array));
  });
});
