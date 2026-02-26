import { pool } from '../../src/services/cache';
import * as redisService from '../../src/services/redis';

// We need to use require/resetModules for test isolation because the module has internal state
let hypixelTracker: typeof import('../../src/services/hypixelTracker');

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
    jest.resetModules();
    jest.clearAllMocks();

    // We need to re-mock imports because resetModules clears the cache
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

    // Mock redis service functions before requiring the module
    const rs = require('../../src/services/redis');
    rs.getRedisClient.mockReturnValue(mockRedis);
    rs.isRedisAvailable.mockReturnValue(true); // Default to true

    // Re-import the module to get fresh internal state (arrays)
    hypixelTracker = require('../../src/services/hypixelTracker');
  });

  afterAll(async () => {
    if (hypixelTracker) {
        await hypixelTracker.shutdown();
    }
  });

  it('should use Redis for counting when available', async () => {
    // Redefine mock behavior for this specific test
    const rs = require('../../src/services/redis');
    rs.isRedisAvailable.mockReturnValue(true);
    mockRedis.zcount.mockResolvedValue(5);

    const count = await hypixelTracker.getHypixelCallCount();

    expect(count).toBe(5);
    expect(mockRedis.zcount).toHaveBeenCalledWith('hypixel_api_calls_rolling', expect.any(Number), '+inf');
  });

  it('should record calls in Redis when available using pipeline', async () => {
    const rs = require('../../src/services/redis');
    rs.isRedisAvailable.mockReturnValue(true);

    await hypixelTracker.recordHypixelApiCall('test-uuid');

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
    const rs = require('../../src/services/redis');
    rs.isRedisAvailable.mockReturnValue(false);

    // We need to re-require cache pool because jest.resetModules clears mocks too if not carefully handled
    // Or we can rely on the fact that we mocked it in beforeEach's inline require (implied by jest.mock hoisting usually, but resetModules makes it tricky)

    // Let's grab the mock directly from the re-required module
    const { pool: mockPool } = require('../../src/services/cache');
    mockPool.query.mockResolvedValue({ rows: [{ count: 10 }] });

    const count = await hypixelTracker.getHypixelCallCount();

    expect(count).toBe(10);
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*)'), expect.any(Array));
  });

  it('should correctly count inflight items during partial flush', async () => {
    const rs = require('../../src/services/redis');
    rs.isRedisAvailable.mockReturnValue(false);

    const { pool: mockPool } = require('../../src/services/cache');
    mockPool.query.mockResolvedValue({ rows: [{ count: 0 }] });

    // Add multiple items to the buffer
    await hypixelTracker.recordHypixelApiCall('uuid-1');
    await hypixelTracker.recordHypixelApiCall('uuid-2');
    await hypixelTracker.recordHypixelApiCall('uuid-3');

    // Simulate a scenario where flush has started and moved items to inflightBatch,
    // but DB insertion hasn't finished or offset hasn't updated yet.
    // However, recordHypixelApiCall triggers flush asynchronously.
    // We can rely on getHypixelCallCount to check the sum of DB + buffer + inflight.

    // With test isolation, we know exactly 3 items were added.
    const count = await hypixelTracker.getHypixelCallCount();

    // We added 3 items.
    // DB reports 0 (mocked).
    // Buffer/Inflight should account for exactly 3.
    expect(count).toBe(3);
  });
});
