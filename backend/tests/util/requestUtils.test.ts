
import { sanitizeSearchQuery } from '../../src/util/requestUtils';

describe('sanitizeSearchQuery', () => {
  it('should return empty string for non-string inputs', () => {
    expect(sanitizeSearchQuery(null)).toBe('');
    expect(sanitizeSearchQuery(undefined)).toBe('');
    expect(sanitizeSearchQuery(123)).toBe('');
    expect(sanitizeSearchQuery({})).toBe('');
  });

  it('should trim whitespace', () => {
    expect(sanitizeSearchQuery('  test  ')).toBe('test');
    expect(sanitizeSearchQuery('test  ')).toBe('test');
    expect(sanitizeSearchQuery('  test')).toBe('test');
  });

  it('should truncate strings longer than maxLength', () => {
    const longString = 'a'.repeat(150);
    const result = sanitizeSearchQuery(longString, 100);
    expect(result.length).toBe(100);
    expect(result).toBe('a'.repeat(100));
  });

  it('should use default maxLength of 100', () => {
    const longString = 'a'.repeat(150);
    const result = sanitizeSearchQuery(longString);
    expect(result.length).toBe(100);
  });

  it('should support custom maxLength', () => {
    const longString = 'a'.repeat(150);
    const result = sanitizeSearchQuery(longString, 10);
    expect(result.length).toBe(10);
    expect(result).toBe('aaaaaaaaaa');
  });

  it('should handle strings equal to maxLength', () => {
    const str = 'a'.repeat(100);
    const result = sanitizeSearchQuery(str, 100);
    expect(result).toBe(str);
  });

  it('should handle empty strings', () => {
    expect(sanitizeSearchQuery('')).toBe('');
    expect(sanitizeSearchQuery('   ')).toBe('');
  });
});
