import { PostgresAdapter } from '../../../src/services/database/postgresAdapter';
import { AzureSqlAdapter } from '../../../src/services/database/azureSqlAdapter';
import { DatabaseType } from '../../../src/services/database/adapter';

describe('Database Dialect Abstraction', () => {
  const pgAdapter = new PostgresAdapter({});
  const azureAdapter = new AzureSqlAdapter('server=localhost;database=test;user=sa;password=pass');

  describe('PostgresAdapter', () => {
    it('implements the DatabaseAdapter contract', () => {
      expect(pgAdapter.type).toBe(DatabaseType.POSTGRESQL);
      expect(typeof pgAdapter.query).toBe('function');
      expect(typeof pgAdapter.connect).toBe('function');
      expect(typeof pgAdapter.close).toBe('function');
      expect(typeof pgAdapter.getPool).toBe('function');
    });

    it('returns a pg pool-like object', () => {
      const pool = pgAdapter.getPool() as any;
      expect(pool).toBeDefined();
      expect(typeof pool.query).toBe('function');
      expect(typeof pool.end).toBe('function');
    });
  });

  describe('AzureSqlAdapter', () => {
    it('implements the DatabaseAdapter contract', () => {
      expect(azureAdapter.type).toBe(DatabaseType.AZURE_SQL);
      expect(typeof azureAdapter.query).toBe('function');
      expect(typeof azureAdapter.connect).toBe('function');
      expect(typeof azureAdapter.close).toBe('function');
      expect(typeof azureAdapter.getPool).toBe('function');
    });

    it('parses URL-style connection strings', () => {
      const parsed = (azureAdapter as any).parseUrlFormat('mssql://user:pass@db.example.com:1433/levelhead?encrypt=true');
      expect(parsed).not.toBeNull();
      expect(parsed.server).toBe('db.example.com');
      expect(parsed.port).toBe(1433);
      expect(parsed.database).toBe('levelhead');
      expect(parsed.user).toBe('user');
      expect(parsed.password).toBe('pass');
      expect(parsed.options.encrypt).toBe(true);
    });

    it('returns an mssql pool-like object', () => {
      const pool = azureAdapter.getPool() as any;
      expect(pool).toBeDefined();
      expect(typeof pool.request).toBe('function');
      expect(typeof pool.connect).toBe('function');
      expect(typeof pool.close).toBe('function');
    });
  });
});
