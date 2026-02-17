import { Pool, PoolConfig } from 'pg';
import { DatabaseAdapter, DatabaseType, QueryResult } from './adapter';

export class PostgresAdapter implements DatabaseAdapter {
  readonly type = DatabaseType.POSTGRESQL;
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
    this.pool.on('connect', () => { console.info('[database] connected to PostgreSQL'); });
    this.pool.on('error', (error: unknown) => { console.error('[database] unexpected PostgreSQL error', error); });
  }

  async query<T>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  async connect(): Promise<void> { await this.pool.query('SELECT 1'); }
  async close(): Promise<void> { await this.pool.end(); console.info('[database] PostgreSQL pool closed'); }
  getPool(): Pool { return this.pool; }

  getPlaceholder(index: number): string { return `$${index}`; }
  getMaxParameters(): number { return 65000; }
  getLimitOffsetSql(limit: number, offset?: number): string {
    return offset !== undefined ? `LIMIT ${limit} OFFSET ${offset}` : `LIMIT ${limit}`;
  }
  getTopSql(_limit: number): string { return ''; }
  getIlikeSql(column: string, placeholder: string): string { return `${column} ILIKE ${placeholder}`; }
  getNowSql(): string { return 'NOW()'; }
  getDateMinusIntervalSql(amount: number, unit: 'day' | 'hour' | 'minute'): string {
    return `NOW() - INTERVAL '${amount} ${unit}s'`;
  }
  getEpochMsSql(column: string | 'NOW'): string {
    const target = column === 'NOW' ? 'NOW()' : column;
    return `(EXTRACT(EPOCH FROM ${target}) * 1000)`;
  }
  getUpsertSql(table: string, columns: string[], conflictColumn: string, updateColumns: string[]): string {
    const cols = columns.join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updates = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');
    return `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updates}`;
  }
  getArrayInSql(column: string, _placeholders: string[]): string { return `${column} = ANY($1)`; }
  getCreateTableIfNotExistsSql(table: string, columns: string): string { return `CREATE TABLE IF NOT EXISTS ${table} (${columns})`; }
  getCreateIndexIfNotExistsSql(indexName: string, table: string, columns: string, unique?: boolean): string {
    return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${indexName} ON ${table} (${columns})`;
  }
  getSubstringAfterSql(column: string, char: string): string { return `split_part(${column}, '${char}', 2)`; }
}
