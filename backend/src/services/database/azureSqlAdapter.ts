import * as mssql from 'mssql';
import { DatabaseAdapter, DatabaseType, QueryResult } from './adapter';

export class AzureSqlAdapter implements DatabaseAdapter {
  readonly type = DatabaseType.AZURE_SQL;
  private pool: mssql.ConnectionPool;

  constructor(connectionString: string) {
    // mssql expects connection string or config object
    this.pool = new mssql.ConnectionPool(connectionString);
  }

  async connect(): Promise<void> {
    if (!this.pool.connected) {
      await this.pool.connect();
      console.info('[database] connected to Azure SQL');
    }
  }

  async query<T>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    await this.connect();
    
    let convertedSql = sql;
    const request = this.pool.request();

    if (params && params.length > 0) {
      // Convert $1, $2 to @p1, @p2 and register them in the request
      params.forEach((value, index) => {
        const paramName = `p${index + 1}`;
        convertedSql = convertedSql.replace(new RegExp(`\\$${index + 1}(?![0-9])`, 'g'), `@${paramName}`);
        request.input(paramName, value);
      });
    }

    // Basic transformations for common PG to SQL Server differences
    // This is a minimal set; more complex migrations are handled in the service layers
    convertedSql = convertedSql
      .replace(/CREATE TABLE IF NOT EXISTS (\w+) \(/g, (match, tableName) => {
        return `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${tableName}]') AND type in (N'U')) CREATE TABLE ${tableName} (`;
      })
      .replace(/INSERT INTO (\w+) (.+) ON CONFLICT \((.+)\) DO UPDATE SET (.+)/g, (match: string, table: string, cols: string, conflictCol: string, updateSet: string) => {
        // Simple UPSERT transformation for PG 'ON CONFLICT'
        // This is a very basic regex and might need refinement for complex cases
        // For our specific use cases in player_cache, it's usually enough
        return `
          MERGE ${table} AS target
          USING (SELECT ${cols.replace(/\((.+)\) VALUES \((.+)\)/, (m: string, c: string, v: string) => {
            const cArray = c.split(',').map((s: string) => s.trim());
            const vArray = v.split(',').map((s: string) => s.trim());
            return cArray.map((col: string, i: number) => `${vArray[i]} AS ${col}`).join(', ');
          })}) AS source
          ON (target.${conflictCol} = source.${conflictCol})
          WHEN MATCHED THEN
            UPDATE SET ${updateSet.replace(/EXCLUDED\./g, 'source.')}
          WHEN NOT MATCHED THEN
            INSERT (${cols.replace(/\((.+)\) VALUES \((.+)\)/, '$1')})
            VALUES (${cols.replace(/\((.+)\) VALUES \((.+)\)/, '$2').replace(/@p(\d+)/g, 'source.@p$1')});
        `;
      });

    try {
      const result = await request.query(convertedSql);
      return {
        rows: result.recordset as T[],
        rowCount: result.rowsAffected[0] || 0,
      };
    } catch (error) {
      console.error('[database] Azure SQL query error:', error);
      console.error('SQL:', convertedSql);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.close();
    console.info('[database] Azure SQL pool closed');
  }

  getPool(): mssql.ConnectionPool {
    return this.pool;
  }
}

