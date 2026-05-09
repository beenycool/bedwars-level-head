import crypto from 'crypto';
// Initialize spy before dynamically importing module
const scryptSpy = jest.spyOn(crypto, 'scrypt');

jest.mock('../../src/config', () => ({
  ADMIN_API_KEYS: ['valid-admin-key'],
  CRON_API_KEYS: ['valid-cron-key'],
}));

import { validateAdminToken, initAllowedKeyHashes as initAdmin } from '../../src/middleware/adminAuth';
import { validateCronToken, initAllowedKeyHashes as initCron } from '../../src/middleware/cronAuth';

describe('Token Length Validation (DoS Protection)', () => {
  beforeAll(async () => {
    await initAdmin();
    await initCron();
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
