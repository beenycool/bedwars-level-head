
// Mock config before imports
jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  REDIS_URL: 'redis://mock',
  REDIS_STATS_FLUSH_INTERVAL_MS: 1000,
  REDIS_MAX_STATS_BUFFER_SIZE: 10,
}));

import { trackGlobalStats, closeRedis } from '../../src/services/redis';
import { logger } from '../../src/util/logger';

// Mock Redis client
const mockEval = jest.fn().mockResolvedValue(1);
const mockQuit = jest.fn().mockResolvedValue('OK');
let isRedisReady = true;

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    eval: mockEval,
    get status() { return isRedisReady ? 'ready' : 'closed'; },
    on: jest.fn(),
    quit: mockQuit,
  }));
});

// Mock logger
jest.mock('../../src/util/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

describe('Redis Stats Buffering', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockEval.mockClear();
    mockQuit.mockClear();
    (logger.warn as jest.Mock).mockClear();
    (logger.error as jest.Mock).mockClear();
    isRedisReady = true;
  });

  afterEach(async () => {
    // Must close first to clear interval
    await closeRedis();
    jest.useRealTimers();
  });

  it('should buffer stats and flush periodically', async () => {
    await trackGlobalStats('127.0.0.1');
    await trackGlobalStats('127.0.0.2');
    await trackGlobalStats('127.0.0.1'); // Duplicate IP

    expect(mockEval).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1100);
    // Flush promise queue
    await Promise.resolve();

    expect(mockEval).toHaveBeenCalledTimes(1);
    const callArgs = mockEval.mock.calls[0];
    const countArg = callArgs[5];
    const ipsArgs = callArgs.slice(6);

    expect(countArg).toBe("3");
    expect(ipsArgs.length).toBe(2);
  });

  it('should flush immediately when buffer is full (size-based flush)', async () => {
    // Max size is mocked to 10
    // Add 9 unique IPs
    for (let i = 0; i < 9; i++) {
        await trackGlobalStats(`127.0.0.${i}`);
    }
    expect(mockEval).not.toHaveBeenCalled();

    // Add 10th unique IP -> should trigger flush
    await trackGlobalStats('127.0.0.10');

    // Size check happens synchronously after add, but flush is async.
    // Since we await trackGlobalStats, if it awaits flushGlobalStats, this should be immediate.
    // However, trackGlobalStats awaits flushGlobalStats only if size limit hit.

    expect(mockEval).toHaveBeenCalledTimes(1);

    // Verify buffer was cleared by checking next call doesn't trigger immediate flush
    mockEval.mockClear();
    await trackGlobalStats('127.0.0.11');
    expect(mockEval).not.toHaveBeenCalled();
  });

  it('should flush pending stats on closeRedis', async () => {
    await trackGlobalStats('127.0.0.1');
    expect(mockEval).not.toHaveBeenCalled();

    await closeRedis();

    expect(mockEval).toHaveBeenCalledTimes(1);
    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it('should drop stats and log warning when Redis is unavailable', async () => {
    isRedisReady = false;

    await trackGlobalStats('127.0.0.1');

    // Force flush
    jest.advanceTimersByTime(1100);
    await Promise.resolve();

    expect(mockEval).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis unavailable, dropping 1 stats requests'));
  });
});
