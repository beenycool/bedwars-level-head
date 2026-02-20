
import { storeApiKey } from '../../src/services/apiKeyManager';
import { getRedisClient } from '../../src/services/redis';
import { pbkdf2Sync } from 'node:crypto';
import * as config from '../../src/config';

// Mock Redis to avoid needing a real connection
jest.mock('../../src/services/redis', () => ({
  getRedisClient: jest.fn(),
}));

describe('API Key Hashing Security', () => {
  const mockRedis = {
    setex: jest.fn().mockResolvedValue('OK'),
    status: 'ready',
  };

  const originalSalt = config.REDIS_KEY_SALT;

  beforeEach(() => {
    (getRedisClient as jest.Mock).mockReturnValue(mockRedis);
    mockRedis.setex.mockClear();
    // Reset salt
    Object.defineProperty(config, 'REDIS_KEY_SALT', {
      value: originalSalt,
      configurable: true
    });
  });

  afterAll(() => {
    Object.defineProperty(config, 'REDIS_KEY_SALT', {
      value: originalSalt,
      configurable: true
    });
  });

  it('should use the configured REDIS_KEY_SALT and produce a 32-char hash', async () => {
    const key = '55555555-4444-3333-2222-111111111111';
    const testSalt = 'custom-test-salt-for-security-check';

    // Set the config salt
    Object.defineProperty(config, 'REDIS_KEY_SALT', {
      value: testSalt,
      configurable: true
    });

    // Calculate expected hash with the NEW salt and length
    const iterations = 100_000;
    const keylen = 32;
    const digest = 'sha256';
    const derived = pbkdf2Sync(key, testSalt, iterations, keylen, digest);
    const expectedHash = derived.toString('hex').slice(0, 32);

    // Assert that we are expecting a longer hash now (16 bytes = 32 hex chars)
    expect(expectedHash).toHaveLength(32);

    await storeApiKey(key);

    // Verify that the Redis key contains the hash generated with the CUSTOM salt
    // keyHash is used in getRedisKey which prefixes "apikey:"
    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringContaining(`apikey:${expectedHash}`),
      expect.any(Number),
      expect.any(String)
    );
  });

  it('should fallback to default salt if REDIS_KEY_SALT is empty (dev mode)', async () => {
    const key = '55555555-4444-3333-2222-111111111111';
    const defaultDevSalt = 'hypixel-apikey-hash-v1';

    // Set the config salt to empty string (simulating dev environment without env var)
    Object.defineProperty(config, 'REDIS_KEY_SALT', {
      value: '',
      configurable: true
    });

    const iterations = 100_000;
    const keylen = 32;
    const digest = 'sha256';
    const derived = pbkdf2Sync(key, defaultDevSalt, iterations, keylen, digest);
    const expectedHash = derived.toString('hex').slice(0, 32);

    await storeApiKey(key);

    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringContaining(`apikey:${expectedHash}`),
      expect.any(Number),
      expect.any(String)
    );
  });
});
