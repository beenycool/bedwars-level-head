
import { performance } from 'perf_hooks';
import crypto from 'crypto';

describe('Auth KDF Benchmark', () => {
  const iterations = 1000;
  const key = 'test-api-key-12345';
  const salt = crypto.randomBytes(16);

  function bench(name: string, fn: () => void) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      fn();
    }
    const end = performance.now();
    const avg = (end - start) / iterations;
    console.log(`${name}: ${avg.toFixed(5)}ms per call`);
  }

  test('Run benchmarks', () => {
    bench('HMAC-SHA256', () => {
      crypto.createHmac('sha256', salt).update(key).digest();
    });

    bench('PBKDF2-1', () => {
      crypto.pbkdf2Sync(key, salt, 1, 32, 'sha256');
    });

    bench('PBKDF2-10', () => {
      crypto.pbkdf2Sync(key, salt, 10, 32, 'sha256');
    });

    bench('PBKDF2-100', () => {
      crypto.pbkdf2Sync(key, salt, 100, 32, 'sha256');
    });

    bench('PBKDF2-1000', () => {
      crypto.pbkdf2Sync(key, salt, 1000, 32, 'sha256');
    });

    bench('Scrypt-Min (N=2, r=1, p=1)', () => {
      // Very low cost for API keys
      crypto.scryptSync(key, salt, 32, { N: 2, r: 1, p: 1 });
    });

    bench('Scrypt-Low (N=16, r=1, p=1)', () => {
      crypto.scryptSync(key, salt, 32, { N: 16, r: 1, p: 1 });
    });

    bench('Scrypt-Med (N=1024, r=1, p=1)', () => {
      crypto.scryptSync(key, salt, 32, { N: 1024, r: 1, p: 1 });
    });
  });
});
