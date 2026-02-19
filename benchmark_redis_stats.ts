
import { trackGlobalStats, closeRedis, getRedisClient } from './backend/src/services/redis';

// Mock Redis client to count calls
const mockEval = jest.fn().mockResolvedValue(1);
const mockQuit = jest.fn().mockResolvedValue('OK');

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    eval: mockEval,
    status: 'ready',
    on: jest.fn(),
    quit: mockQuit,
  }));
});

async function runBenchmark() {
  console.log('Starting benchmark...');
  const start = process.hrtime.bigint();
  const ITERATIONS = 10000;

  for (let i = 0; i < ITERATIONS; i++) {
    await trackGlobalStats('127.0.0.1');
  }

  const end = process.hrtime.bigint();
  const duration = Number(end - start) / 1_000_000; // ms

  console.log(`Executed ${ITERATIONS} calls in ${duration.toFixed(2)}ms`);
  console.log(`Redis EVAL calls: ${mockEval.mock.calls.length}`);
}

runBenchmark();
