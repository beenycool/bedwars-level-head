import {
  IDENTIFIER_PATTERN,
  isUuid,
  normalizeIdentifier,
  normalizeUuid,
} from '../../src/util/validationConstants';

const UUID = '530fa96a303d42199b5a329d493a5573';
const DASHED = '530fa96a-303d-4219-9b5a-329d493a5573';

describe('IDENTIFIER_PATTERN', () => {
  it('accepts UUIDs with or without dashes, in any case', () => {
    expect(IDENTIFIER_PATTERN.test(UUID)).toBe(true);
    expect(IDENTIFIER_PATTERN.test(DASHED)).toBe(true);
    expect(IDENTIFIER_PATTERN.test(DASHED.toUpperCase())).toBe(true);
  });

  it('rejects Minecraft usernames and malformed UUIDs', () => {
    expect(IDENTIFIER_PATTERN.test('Notch')).toBe(false);
    expect(IDENTIFIER_PATTERN.test('_abcdefghijklmnop')).toBe(false);
    expect(IDENTIFIER_PATTERN.test(UUID.slice(0, 31))).toBe(false);
    expect(IDENTIFIER_PATTERN.test(`${UUID}0`)).toBe(false);
    expect(IDENTIFIER_PATTERN.test(`${UUID.slice(0, 8)}--${UUID.slice(9)}`)).toBe(false);
    expect(IDENTIFIER_PATTERN.test('z'.repeat(32))).toBe(false);
  });
});

describe('normalizeIdentifier', () => {
  it('lowercases and strips every dash', () => {
    expect(normalizeIdentifier(DASHED.toUpperCase())).toBe(UUID);
    expect(normalizeIdentifier(UUID)).toBe(UUID);
    expect(normalizeIdentifier('Not-ch')).toBe('notch');
  });
});

describe('normalizeUuid', () => {
  it('returns the canonical undashed UUID for both forms', () => {
    expect(normalizeUuid(DASHED)).toBe(UUID);
    expect(normalizeUuid(DASHED.toUpperCase())).toBe(UUID);
    expect(normalizeUuid(UUID)).toBe(UUID);
  });

  it('returns null for usernames and malformed values', () => {
    expect(normalizeUuid('Notch')).toBeNull();
    expect(normalizeUuid('')).toBeNull();
    expect(normalizeUuid('z'.repeat(32))).toBeNull();
    // Dashes are only accepted at the canonical positions, not removed blindly.
    expect(normalizeUuid(`${UUID.slice(0, 8)}--${UUID.slice(8)}`)).toBeNull();
    expect(normalizeUuid(`${UUID.slice(0, 4)}-${UUID.slice(4)}`)).toBeNull();
    expect(isUuid(normalizeIdentifier(DASHED))).toBe(true);
  });
});
