
import { performance } from 'perf_hooks';

// We need to mock the config module before importing the auth middleware
// because the middleware reads the config at the top level to initialize hashes.
jest.mock('../../src/config', () => ({
  ADMIN_API_KEYS: ['test-admin-key-1', 'test-admin-key-2'],
  CRON_API_KEYS: ['test-cron-key-1', 'test-cron-key-2'],
}));

import { validateAdminToken } from '../../src/middleware/adminAuth';
import { validateCronToken } from '../../src/middleware/cronAuth';

describe('Auth Middleware Performance Benchmark', () => {
  const iterations = 100;

  test('validateAdminToken performance', () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      validateAdminToken('test-admin-key-1');
      validateAdminToken('invalid-key');
    }
    const end = performance.now();
    const duration = end - start;
    const avg = duration / (iterations * 2); // *2 because we do valid + invalid

    console.log(`[Benchmark] validateAdminToken avg time: ${avg.toFixed(4)}ms per call (total: ${duration.toFixed(2)}ms for ${iterations * 2} calls)`);

    // Safety check: Ensure logic is correct
    expect(validateAdminToken('test-admin-key-1')).toBe(true);
    expect(validateAdminToken('invalid-key')).toBe(false);

    // Regression check: Ensure performance is within acceptable limits (e.g. < 1ms)
    expect(avg).toBeLessThan(1);
  });

  test('validateCronToken performance', () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      validateCronToken('test-cron-key-1');
      validateCronToken('invalid-key');
    }
    const end = performance.now();
    const duration = end - start;
    const avg = duration / (iterations * 2);

    console.log(`[Benchmark] validateCronToken avg time: ${avg.toFixed(4)}ms per call (total: ${duration.toFixed(2)}ms for ${iterations * 2} calls)`);

    // Safety check
    expect(validateCronToken('test-cron-key-1')).toBe(true);
    expect(validateCronToken('invalid-key')).toBe(false);

    // Regression check: Ensure performance is within acceptable limits (e.g. < 1ms)
    expect(avg).toBeLessThan(1);
  });
});
