
import { createHmac } from 'crypto';

// Use a mock salt that matches the test expectation
const MOCK_SALT = 'test-salt-12345678901234567890123456789012';

// Mock dependencies with correct relative paths
jest.mock('../../src/config', () => ({
  REDIS_URL: 'redis://localhost:6379',
  REDIS_COMMAND_TIMEOUT: 1000,
  REDIS_KEY_SALT: 'test-salt-12345678901234567890123456789012',
  REDIS_STATS_BUCKET_SIZE_MS: 1000,
  REDIS_STATS_CACHE_TTL_MS: 1000,
  REDIS_STATS_FLUSH_INTERVAL_MS: 1000,
  REDIS_MAX_STATS_BUFFER_SIZE: 100,
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_REQUIRE_REDIS: false,
  RATE_LIMIT_FALLBACK_MODE: 'memory',
}));

jest.mock('../../src/util/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
import { hashIp } from '../../src/services/redis';

describe('hashIp', () => {
  it('should return a 32-character hex string', () => {
    const ip = '127.0.0.1';
    const hash = hashIp(ip);
    expect(hash).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should return the same hash for the same IP', () => {
    const ip = '192.168.1.1';
    const hash1 = hashIp(ip);
    const hash2 = hashIp(ip);
    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different IPs', () => {
    const ip1 = '10.0.0.1';
    const ip2 = '10.0.0.2';
    const hash1 = hashIp(ip1);
    const hash2 = hashIp(ip2);
    expect(hash1).not.toBe(hash2);
  });

  it('should be consistent with standard HMAC-SHA256 (first 32 chars)', () => {
    const ip = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';

    // Calculate expected hash using the same logic as the original implementation
    // but using the MOCK_SALT we defined above
    const expected = createHmac('sha256', MOCK_SALT).update(ip).digest('hex').slice(0, 32);
    const actual = hashIp(ip);

    expect(actual).toBe(expected);
  });
});
