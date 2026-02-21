import { pbkdf2Sync } from 'node:crypto';

// Mock Redis
const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  get: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  ttl: jest.fn().mockResolvedValue(300),
  status: 'ready',
};

jest.mock('../../src/services/redis', () => ({
  getRedisClient: jest.fn(() => mockRedis),
}));

// Mock Logger
const mockLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
};
jest.mock('../../src/util/logger', () => ({
  logger: mockLogger,
}));

describe('API Key Hashing Security', () => {
  const DEFAULT_SALT = 'hypixel-apikey-hash-v1';

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockRedis.ttl.mockResolvedValue(300);
  });

  it('should use the configured REDIS_KEY_SALT and produce a 32-char hash', async () => {
    const TEST_SALT = 'custom-test-salt-for-security-check';

    // Mock config dynamically
    jest.doMock('../../src/config', () => ({
      ...jest.requireActual('../../src/config'),
      REDIS_KEY_SALT: TEST_SALT,
    }));

    // Re-require the module under test
    const { storeApiKey } = require('../../src/services/apiKeyManager');

    const key = '55555555-4444-3333-2222-111111111111';

    // Calculate expected hash
    const iterations = 100_000;
    const keylen = 16;
    const digest = 'sha256';
    const derived = pbkdf2Sync(key, TEST_SALT, iterations, keylen, digest);
    const expectedHash = derived.toString('hex'); // 32 chars

    expect(expectedHash).toHaveLength(32);

    await storeApiKey(key);

    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringContaining(`apikey:${expectedHash}`),
      expect.any(Number),
      expect.any(String)
    );
  });

  it('should fallback to default salt if REDIS_KEY_SALT is empty and log warning only once', async () => {
    // Mock config with empty salt
    jest.doMock('../../src/config', () => ({
      ...jest.requireActual('../../src/config'),
      REDIS_KEY_SALT: '',
    }));

    const { storeApiKey } = require('../../src/services/apiKeyManager');

    const key = '55555555-4444-3333-2222-111111111111';

    const iterations = 100_000;
    const keylen = 16;
    const digest = 'sha256';
    const derived = pbkdf2Sync(key, DEFAULT_SALT, iterations, keylen, digest);
    const expectedHash = derived.toString('hex');

    // First call - should log warning
    await storeApiKey(key);

    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringContaining(`apikey:${expectedHash}`),
      expect.any(Number),
      expect.any(String)
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('REDIS_KEY_SALT is not set'));

    // Reset mock to check if it's called again
    mockLogger.warn.mockClear();

    // Second call - should NOT log warning
    await storeApiKey(key);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should migrate legacy keys on cache miss and preserve TTL', async () => {
     const TEST_SALT = 'migration-test-salt';

    // Mock config
    jest.doMock('../../src/config', () => ({
      ...jest.requireActual('../../src/config'),
      REDIS_KEY_SALT: TEST_SALT,
    }));

    const { getApiKeyValidation } = require('../../src/services/apiKeyManager');
    const key = '55555555-4444-3333-2222-111111111111';

    // Compute new hash
    const newHash = pbkdf2Sync(key, TEST_SALT, 100_000, 16, 'sha256').toString('hex');
    const newRedisKey = `apikey:${newHash}`;

    // Compute legacy hash: keylen=32, slice(0,16) -> 16 chars
    const legacyHash = pbkdf2Sync(key, DEFAULT_SALT, 100_000, 32, 'sha256').toString('hex').slice(0, 16);
    const legacyRedisKey = `apikey:${legacyHash}`;

    // Setup Redis mocks
    mockRedis.get.mockImplementation((k) => {
        if (k === newRedisKey) return Promise.resolve(null); // Miss new key
        if (k === legacyRedisKey) return Promise.resolve(JSON.stringify({
            validationStatus: 'valid',
            validatedCount: 5,
            lastValidatedAt: 12345,
            errorMessage: null,
            createdAt: 10000
        })); // Hit legacy key
        return Promise.resolve(null);
    });

    // Mock TTL response
    const REMAINING_TTL = 9876;
    mockRedis.ttl.mockResolvedValue(REMAINING_TTL);

    await getApiKeyValidation(key);

    // Verify migration
    expect(mockRedis.get).toHaveBeenCalledWith(newRedisKey);
    expect(mockRedis.get).toHaveBeenCalledWith(legacyRedisKey);
    expect(mockRedis.ttl).toHaveBeenCalledWith(legacyRedisKey);

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Migrating API key'));

    // Should write to new key with preserved TTL
    expect(mockRedis.setex).toHaveBeenCalledWith(
        newRedisKey,
        REMAINING_TTL,
        expect.stringContaining('"validationStatus":"valid"')
    );

    // Should delete old key
    expect(mockRedis.del).toHaveBeenCalledWith(legacyRedisKey);
  });
});
