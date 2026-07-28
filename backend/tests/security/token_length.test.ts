import crypto from 'crypto';
import { validateAdminToken, initAllowedKeyHashes as initAdminKeyHashes } from '../../src/middleware/adminAuth';
import { validateCronToken, initAllowedKeyHashes as initCronKeyHashes } from '../../src/middleware/cronAuth';

// Mock config to ensure we have known keys to test against if needed,
// but for length check we rely on crypto spy.
jest.mock('../../src/config', () => ({
  ADMIN_API_KEYS: ['valid-admin-key'],
  CRON_API_KEYS: ['valid-cron-key'],
}));

describe('Token Length Validation (DoS Protection)', () => {
  let scryptSpy: jest.SpyInstance;

  beforeAll(async () => {
    await Promise.all([initAdminKeyHashes(), initCronKeyHashes()]);
    // Spy on crypto.scrypt to verify if it's called
    scryptSpy = jest.spyOn(crypto, 'scrypt').mockImplementation((...args) => {
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
            cb(null, Buffer.alloc(32));
        }
        return undefined as any;
    });
  });

  afterEach(() => {
    scryptSpy.mockClear();
  });

  afterAll(() => {
    scryptSpy.mockRestore();
  });

  describe.each([
    { name: 'validateAdminToken', validateFn: validateAdminToken },
    { name: 'validateCronToken', validateFn: validateCronToken },
  ])('$name', ({ validateFn }) => {
    it('should process tokens within length limit', async () => {
      const validLengthToken = 'a'.repeat(128);
      await validateFn(validLengthToken);
      expect(scryptSpy).toHaveBeenCalled();
    });

    it('should reject tokens exceeding length limit without hashing', async () => {
      const longToken = 'a'.repeat(129);
      const result = await validateFn(longToken);
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });

    it('should reject empty tokens immediately', async () => {
      const result = await validateFn('');
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });
  });
});
