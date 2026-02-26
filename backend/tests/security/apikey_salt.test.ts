import { pbkdf2Sync, scryptSync } from 'node:crypto';

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

// Mock axios for validation
jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({ status: 200, data: { success: true } }),
  isAxiosError: jest.fn().mockReturnValue(false),
}));

describe('API Key Hashing Security', () => {
  const DEFAULT_SALT = 'hypixel-apikey-hash-v1';

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockRedis.ttl.mockResolvedValue(300);
  });

  it('should use the configured REDIS_KEY_SALT with Scrypt (N=16) and produce a 32-char hash', async () => {
    const TEST_SALT = 'custom-test-salt-for-security-check';

    // Mock config dynamically
    jest.doMock('../../src/config', () => ({
      ...jest.requireActual('../../src/config'),
      REDIS_KEY_SALT: TEST_SALT,
    }));

    // Re-require the module under test
    const { storeApiKey } = require('../../src/services/apiKeyManager');

    const key = '55555555-4444-3333-2222-111111111111';

    // Calculate expected Scrypt hash
    const keylen = 16;
    const derived = scryptSync(key, TEST_SALT, keylen, { N: 16, r: 1, p: 1 });
    const expectedHash = derived.toString('hex'); // 32 chars (16 bytes hex encoded)

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

    // Expected Scrypt hash with default salt
    const keylen = 16;
    const derived = scryptSync(key, DEFAULT_SALT, keylen, { N: 16, r: 1, p: 1 });
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

  it('should migrate legacy PBKDF2 keys on validation success (Gen 2 -> Gen 3)', async () => {
     const TEST_SALT = 'migration-test-salt';

    // Mock config
    jest.doMock('../../src/config', () => ({
      ...jest.requireActual('../../src/config'),
      REDIS_KEY_SALT: TEST_SALT,
    }));

    const { validateApiKey } = require('../../src/services/apiKeyManager');
    const key = '55555555-4444-3333-2222-111111111111';

    // Compute new Scrypt hash (Gen 3)
    const newHash = scryptSync(key, TEST_SALT, 16, { N: 16, r: 1, p: 1 }).toString('hex');
    const newRedisKey = `apikey:${newHash}`;

    // Compute legacy PBKDF2 hash (Gen 2): 100k iter, 16 bytes
    const legacyHash = pbkdf2Sync(key, TEST_SALT, 100_000, 16, 'sha256').toString('hex');
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

    await validateApiKey(key);

    // Verify migration logic
    // 1. Should check new key first
    expect(mockRedis.get).toHaveBeenCalledWith(newRedisKey);

    // 2. After validation success (axios mock), it should attempt migration
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

  it('should NOT migrate legacy keys on GET status (DoS protection)', async () => {
    const TEST_SALT = 'dos-protection-salt';

   // Mock config
   jest.doMock('../../src/config', () => ({
     ...jest.requireActual('../../src/config'),
     REDIS_KEY_SALT: TEST_SALT,
   }));

   const { getApiKeyValidation } = require('../../src/services/apiKeyManager');
   const key = '55555555-4444-3333-2222-111111111111';

   // Compute new Scrypt hash (Gen 3)
   const newHash = scryptSync(key, TEST_SALT, 16, { N: 16, r: 1, p: 1 }).toString('hex');
   const newRedisKey = `apikey:${newHash}`;

   // Compute legacy PBKDF2 hash (Gen 2)
   const legacyHash = pbkdf2Sync(key, TEST_SALT, 100_000, 16, 'sha256').toString('hex');
   const legacyRedisKey = `apikey:${legacyHash}`;

   // Setup Redis mocks - Miss on new key, Hit on old key
   mockRedis.get.mockImplementation((k) => {
       if (k === newRedisKey) return Promise.resolve(null);
       if (k === legacyRedisKey) return Promise.resolve(JSON.stringify({ some: 'data' }));
       return Promise.resolve(null);
   });

   const result = await getApiKeyValidation(key);

   // Verify behavior
   expect(mockRedis.get).toHaveBeenCalledWith(newRedisKey);
   // Should NOT check legacy key (which requires slow PBKDF2)
   expect(mockRedis.get).not.toHaveBeenCalledWith(legacyRedisKey);

   // Should return null (not found)
   expect(result).toBeNull();
 });
});
