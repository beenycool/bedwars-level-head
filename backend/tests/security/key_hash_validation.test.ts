import { isValidKeyHashFormat } from '../../src/services/apiKeyManager';

describe('isValidKeyHashFormat', () => {
  it('should accept valid legacy 16-character hex hashes', () => {
    const legacyHash = '0123456789abcdef';
    expect(isValidKeyHashFormat(legacyHash)).toBe(true);
  });

  it('should accept valid new 32-character hex hashes', () => {
    const newHash = '0123456789abcdef0123456789abcdef';
    expect(isValidKeyHashFormat(newHash)).toBe(true);
  });

  it('should reject hashes with invalid characters', () => {
    const invalidHash = '0123456789abcdeg'; // 'g' is not hex
    expect(isValidKeyHashFormat(invalidHash)).toBe(false);
  });

  it('should reject hashes with incorrect length (too short)', () => {
    const shortHash = '0123456789abcde'; // 15 chars
    expect(isValidKeyHashFormat(shortHash)).toBe(false);
  });

  it('should reject hashes with incorrect length (too long)', () => {
    const longHash = '0123456789abcdef0'; // 17 chars
    expect(isValidKeyHashFormat(longHash)).toBe(false);
  });

  it('should reject hashes with incorrect length (between 16 and 32)', () => {
    const midHash = '0123456789abcdef0123'; // 20 chars
    expect(isValidKeyHashFormat(midHash)).toBe(false);
  });

  it('should reject empty strings', () => {
    expect(isValidKeyHashFormat('')).toBe(false);
  });
});
