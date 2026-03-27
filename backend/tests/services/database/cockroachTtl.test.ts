import { quoteSqlIdentifier } from '../../../src/services/database/cockroachTtl';

describe('quoteSqlIdentifier', () => {
  it('correctly quotes a simple identifier', () => {
    expect(quoteSqlIdentifier('users')).toBe('"users"');
  });

  it('correctly quotes a schema-qualified identifier', () => {
    expect(quoteSqlIdentifier('public.users')).toBe('"public"."users"');
  });

  it('correctly escapes double quotes in identifier', () => {
    expect(quoteSqlIdentifier('my"table')).toBe('"my""table"');
  });

  it('prevents SQL injection attempts', () => {
    expect(quoteSqlIdentifier('users; DROP TABLE users--')).toBe('"users; DROP TABLE users--"');
    expect(quoteSqlIdentifier('users" OR "1"="1')).toBe('"users"" OR ""1""=""1"');
  });

  it('handles identifiers with multiple dots', () => {
    expect(quoteSqlIdentifier('schema.table.column')).toBe('"schema"."table"."column"');
  });

  it('handles empty string edge case', () => {
    expect(quoteSqlIdentifier('')).toBe('""');
  });
});
