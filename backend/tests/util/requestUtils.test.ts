import { parseAndValidateBatchIdentifiers } from '../../src/util/requestUtils';

const UUID = 'abcdef0123456789abcdef0123456789';
const DASHED = 'ABCDEF01-2345-6789-ABCD-EF0123456789';

describe('parseAndValidateBatchIdentifiers', () => {
  it('normalizes case and dashes before deduplicating', () => {
    expect(parseAndValidateBatchIdentifiers([DASHED, ` ${UUID.toUpperCase()} `, UUID])).toEqual({
      uniqueUuids: [UUID],
      hasInvalid: false,
    });
  });

  it('marks usernames, non-strings and over-length values invalid', () => {
    expect(parseAndValidateBatchIdentifiers([UUID, 'Notch'])).toEqual({
      uniqueUuids: [UUID],
      hasInvalid: true,
    });
    expect(parseAndValidateBatchIdentifiers([42, '', 'x'.repeat(65)])).toEqual({
      uniqueUuids: [],
      hasInvalid: true,
    });
  });

  it('returns an empty, valid result for an empty batch', () => {
    expect(parseAndValidateBatchIdentifiers([])).toEqual({ uniqueUuids: [], hasInvalid: false });
  });
});
