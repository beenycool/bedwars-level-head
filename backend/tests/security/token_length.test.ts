import crypto from 'crypto';

// Mock config to ensure we have known keys to test against if needed,
// but for length check we rely on crypto spy.
jest.mock('../../src/config', () => ({
  ADMIN_API_KEYS: ['valid-admin-key'],
  CRON_API_KEYS: ['valid-cron-key'],
}));

describe('Token Length Validation (DoS Protection)', () => {
  let scryptSpy: jest.SpyInstance;

  let validateAdminToken: any;
  let validateCronToken: any;
  let initAdmin: any;
  let initCron: any;

  beforeAll(async () => {
    // Spy on crypto.scrypt to verify if it's called BEFORE importing module so we can spy on it properly!
    scryptSpy = jest.spyOn(crypto, 'scrypt');

    const adminAuth = await import('../../src/middleware/adminAuth');
    validateAdminToken = adminAuth.validateAdminToken;
    initAdmin = adminAuth.initAllowedKeyHashes;

    const cronAuth = await import('../../src/middleware/cronAuth');
    validateCronToken = cronAuth.validateCronToken;
    initCron = cronAuth.initAllowedKeyHashes;

    // NOTE: Need to initialize before testing, but want to clear spy afterwards!
    await initAdmin();
    await initCron();
    scryptSpy.mockClear();
  });

  afterEach(() => {
    scryptSpy.mockClear();
  });

  afterAll(() => {
    scryptSpy.mockRestore();
  });

  describe('validateAdminToken', () => {
    it('should process tokens within length limit', async () => {
      const validLengthToken = 'a'.repeat(128);
      await validateAdminToken(validLengthToken);
      expect(scryptSpy).toHaveBeenCalled();
    });

    it('should reject tokens exceeding length limit without hashing', async () => {
      const longToken = 'a'.repeat(129);
      const result = await validateAdminToken(longToken);
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });

    it('should reject empty tokens immediately', async () => {
      const result = await validateAdminToken('');
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateCronToken', () => {
    it('should process tokens within length limit', async () => {
      const validLengthToken = 'a'.repeat(128);
      await validateCronToken(validLengthToken);
      expect(scryptSpy).toHaveBeenCalled();
    });

    it('should reject tokens exceeding length limit without hashing', async () => {
      const longToken = 'a'.repeat(129);
      const result = await validateCronToken(longToken);
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });

    it('should reject empty tokens immediately', async () => {
      const result = await validateCronToken('');
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });
  });
});
