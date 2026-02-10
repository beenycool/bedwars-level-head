import { buildSearchClause } from '../src/services/history';
import { pool } from '../src/services/cache';
import { DatabaseType } from '../src/services/database/adapter';

jest.mock('../src/services/cache', () => ({
  pool: {
    type: 'POSTGRESQL',
    query: jest.fn().mockResolvedValue({ rows: [] })
  },
  ensureInitialized: jest.fn().mockResolvedValue(undefined)
}));

describe('buildSearchClause', () => {
  it('should generate correct SQL for PostgreSQL', () => {
    (pool as any).type = DatabaseType.POSTGRESQL;
    const result = buildSearchClause('test', 1);
    // ESCAPE '\\' in JS source means the string contains ESCAPE \
    expect(result.clause).toContain("ESCAPE '\\'");
  });

  it('should generate correct SQL for Azure SQL', () => {
    (pool as any).type = DatabaseType.AZURE_SQL;
    const result = buildSearchClause('test', 1);
    expect(result.clause).toContain("ESCAPE '\\'");
  });

  it('should escape special characters in search term', () => {
    const result = buildSearchClause('a%b_c\\d', 1);
    expect(result.params[0]).toBe('%a\\%b\\_c\\\\d%');
  });
});
