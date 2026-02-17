import { PostgresAdapter } from '../../../src/services/database/postgresAdapter';
import { AzureSqlAdapter } from '../../../src/services/database/azureSqlAdapter';

describe('Database Dialect Abstraction', () => {
  const pgAdapter = new PostgresAdapter({});
  const azureAdapter = new AzureSqlAdapter('server=localhost;database=test;user=sa;password=pass');

  describe('PostgresAdapter', () => {
    it('should generate correct placeholders', () => {
      expect(pgAdapter.getPlaceholder(1)).toBe('$1');
    });
    it('should generate correct pagination SQL', () => {
      expect(pgAdapter.getLimitOffsetSql(10)).toBe('LIMIT 10');
      expect(pgAdapter.getLimitOffsetSql(10, 20)).toBe('LIMIT 10 OFFSET 20');
    });
    it('should generate correct date minus interval SQL', () => {
      expect(pgAdapter.getDateMinusIntervalSql(30, 'day')).toBe("NOW() - INTERVAL '30 days'");
    });
    it('should generate correct upsert SQL', () => {
      const sql = pgAdapter.getUpsertSql('t', ['a', 'b'], 'a', ['b']);
      expect(sql).toContain('INSERT INTO t (a, b)');
      expect(sql).toContain('ON CONFLICT (a) DO UPDATE SET b = EXCLUDED.b');
    });
    it('should generate correct array IN SQL', () => {
      expect(pgAdapter.getArrayInSql('c', ['$1'])).toBe('c = ANY($1)');
    });
    it('should generate correct substring SQL', () => {
      expect(pgAdapter.getSubstringAfterSql('k', ':')).toBe("split_part(k, ':', 2)");
    });
  });

  describe('AzureSqlAdapter', () => {
    it('should generate correct placeholders', () => {
      expect(azureAdapter.getPlaceholder(1)).toBe('@p1');
    });
    it('should generate correct pagination SQL', () => {
      expect(azureAdapter.getLimitOffsetSql(10, 20)).toBe('OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY');
    });
    it('should generate correct date minus interval SQL', () => {
      expect(azureAdapter.getDateMinusIntervalSql(30, 'day')).toBe('DATEADD(day, -30, GETUTCDATE())');
    });
    it('should generate correct upsert SQL', () => {
      const sql = azureAdapter.getUpsertSql('t', ['a', 'b'], 'a', ['b']);
      expect(sql).toContain('MERGE t AS target');
      expect(sql).toContain('USING (SELECT @p1 AS a, @p2 AS b) AS source');
      expect(sql).toContain('ON (target.a = source.a)');
      expect(sql).toContain('UPDATE SET target.b = source.b');
    });
    it('should generate correct array IN SQL', () => {
      expect(azureAdapter.getArrayInSql('c', ['@p1'])).toBe('c IN (@p1)');
    });
    it('should generate correct substring SQL', () => {
      expect(azureAdapter.getSubstringAfterSql('k', ':')).toBe("SUBSTRING(k, CHARINDEX(':', k) + 1, LEN(k))");
    });
  });
});
