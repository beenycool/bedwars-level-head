
import { trackGlobalStats, closeRedis } from '../../src/services/redis';

// Mock Redis client
const mockEval = jest.fn().mockResolvedValue(1);
const mockPipeline = jest.fn().mockReturnThis();
const mockExec = jest.fn().mockResolvedValue([]);
const mockQuit = jest.fn().mockResolvedValue('OK');

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    eval: mockEval,
    pipeline: jest.fn(() => ({
      eval: mockEval, // If using pipeline
      exec: mockExec,
    })),
    status: 'ready',
    on: jest.fn(),
    quit: mockQuit,
  }));
});

describe('Redis Stats Buffering', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockEval.mockClear();
    mockExec.mockClear();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await closeRedis();
  });

  it('should buffer stats and flush periodically', async () => {
    // 1. Call trackGlobalStats multiple times
    await trackGlobalStats('127.0.0.1');
    await trackGlobalStats('127.0.0.2');
    await trackGlobalStats('127.0.0.1'); // Duplicate IP

    // 2. Assert no immediate Redis calls (buffering)
    // This confirms buffering is working!
    expect(mockEval).not.toHaveBeenCalled();

    // 3. Advance time to trigger flush (assuming 1000ms interval)
    jest.advanceTimersByTime(1100);

    // 4. Assert Redis call happened
    // We expect 1 call to eval
    expect(mockEval).toHaveBeenCalledTimes(1);

    // 5. Verify arguments
    // Arg 0: script
    // Arg 1: numKeys (2)
    // Arg 2: reqKey
    // Arg 3: hllKey
    // Arg 4: ttl
    // Arg 5: count (should be "3")
    // Arg 6+: ips (should have 2 unique IPs)

    const callArgs = mockEval.mock.calls[0];
    const countArg = callArgs[5];
    const ipsArgs = callArgs.slice(6);

    expect(countArg).toBe("3");
    expect(ipsArgs.length).toBe(2);
  });
});
