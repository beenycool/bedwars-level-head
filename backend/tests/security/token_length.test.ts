
import crypto from 'crypto';
import { validateAdminToken } from '../../src/middleware/adminAuth';
import { validateCronToken } from '../../src/middleware/cronAuth';

// Mock config to ensure we have known keys to test against if needed,
// but for length check we rely on crypto spy.
jest.mock('../../src/config', () => ({
  ADMIN_API_KEYS: ['valid-admin-key'],
  CRON_API_KEYS: ['valid-cron-key'],
}));

describe('Token Length Validation (DoS Protection)', () => {
  let scryptSpy: jest.SpyInstance;

  beforeAll(() => {
    // Spy on crypto.scryptSync to verify if it's called
    scryptSpy = jest.spyOn(crypto, 'scryptSync');
  });

  afterEach(() => {
    scryptSpy.mockClear();
  });

  afterAll(() => {
    scryptSpy.mockRestore();
  });

  describe('validateAdminToken', () => {
    it('should process tokens within length limit', () => {
      const validLengthToken = 'a'.repeat(128);
      validateAdminToken(validLengthToken);
      expect(scryptSpy).toHaveBeenCalled();
    });

    it('should reject tokens exceeding length limit without hashing', () => {
      const longToken = 'a'.repeat(129);
      const result = validateAdminToken(longToken);
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });

    it('should reject empty tokens immediately', () => {
      const result = validateAdminToken('');
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateCronToken', () => {
    it('should process tokens within length limit', () => {
      const validLengthToken = 'a'.repeat(128);
      validateCronToken(validLengthToken);
      expect(scryptSpy).toHaveBeenCalled();
    });

    it('should reject tokens exceeding length limit without hashing', () => {
      const longToken = 'a'.repeat(129);
      const result = validateCronToken(longToken);
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });

    it('should reject empty tokens immediately', () => {
      const result = validateCronToken('');
      expect(result).toBe(false);
      expect(scryptSpy).not.toHaveBeenCalled();
    });
  });
});
