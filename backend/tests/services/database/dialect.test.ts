import { getDatabaseType, parseMssqlConfig, DatabaseType } from '../../../src/services/database/db';

describe('Database Configuration Parsers', () => {
  describe('getDatabaseType', () => {
    it('correctly identifies PostgreSQL', () => {
      expect(getDatabaseType('postgresql://user:pass@localhost:5432/test')).toBe(DatabaseType.POSTGRESQL);
      expect(getDatabaseType('postgres://user:pass@localhost/test')).toBe(DatabaseType.POSTGRESQL);
    });

    it('correctly identifies Azure SQL / MSSQL URLs', () => {
      expect(getDatabaseType('mssql://user:pass@db.example.com:1433/levelhead')).toBe(DatabaseType.AZURE_SQL);
      expect(getDatabaseType('sqlserver://user:pass@db.example.com')).toBe(DatabaseType.AZURE_SQL);
    });

    it('correctly identifies ODBC-style strings', () => {
      expect(getDatabaseType('Server=localhost;Database=test;User Id=sa;Password=pass')).toBe(DatabaseType.AZURE_SQL);
      expect(getDatabaseType('Data Source=server;Initial Catalog=test')).toBe(DatabaseType.AZURE_SQL);
    });

    it('defaults to PostgreSQL for unknown formats', () => {
      expect(getDatabaseType('mysql://user:pass@localhost/test')).toBe(DatabaseType.POSTGRESQL);
    });
  });

  describe('parseMssqlConfig', () => {
    it('parses URL-style connection strings', () => {
      const parsed = parseMssqlConfig('mssql://user:pass@db.example.com:1433/levelhead?encrypt=true');
      expect(parsed).not.toBeNull();
      expect(parsed.server).toBe('db.example.com');
      expect(parsed.port).toBe(1433);
      expect(parsed.database).toBe('levelhead');
      expect(parsed.user).toBe('user');
      expect(parsed.password).toBe('pass');
      expect(parsed.options.encrypt).toBe(true);
    });

    it('parses ODBC-style connection strings', () => {
      const parsed = parseMssqlConfig('server=localhost,1433;database=test;user=sa;password=pass;encrypt=true');
      expect(parsed).not.toBeNull();
      expect(parsed.server).toBe('localhost');
      expect(parsed.port).toBe(1433);
      expect(parsed.database).toBe('test');
      expect(parsed.user).toBe('sa');
      expect(parsed.password).toBe('pass');
      expect(parsed.options.encrypt).toBe(true);
    });

    it('handles azure sql username fix', () => {
      const parsed = parseMssqlConfig('server=mydb.database.windows.net;database=test;user=admin;password=pass');
      expect(parsed.user).toBe('admin@mydb');
    });
  });
});
