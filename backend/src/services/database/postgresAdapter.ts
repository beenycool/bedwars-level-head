import { Pool, PoolConfig } from 'pg';
import { DatabaseAdapter, DatabaseType, QueryResult } from './adapter';

export class PostgresAdapter implements DatabaseAdapter {
  readonly type = DatabaseType.POSTGRESQL;
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);

    this.pool.on('connect', () => {
      console.info('[database] connected to PostgreSQL');
    });

    this.pool.on('error', (error: unknown) => {
      console.error('[database] unexpected PostgreSQL error', error);
    });
  }

  async query<T>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
    };
  }

  async connect(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
    console.info('[database] PostgreSQL pool closed');
  }

  getPool(): Pool {
    return this.pool;
  }

  getPaginationFragment(limit: number | string, offset?: number | string): string {
    const limitPart = `LIMIT ${limit}`;
    const offsetPart = offset !== undefined ? `OFFSET ${offset}` : "";
    return `${limitPart} ${offsetPart}`.trim();
  }

  getIlikeFragment(column: string, placeholder: string): string {
    return `${column} ILIKE ${placeholder}`;
  }

  formatInClause(column: string, values: any[], startIndex: number): { sql: string; params: any[] } {
    return {
      sql: `${column} = ANY($${startIndex})`,
      params: [values],
    };
  }

  getUpsertQuery(table: string, columns: string[], conflictColumn: string, updateColumns: string[]): string {
    const colList = columns.join(', ');
    const valList = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateList = updateColumns.map((col) => `${col} = EXCLUDED.${col}`).join(', ');

    return `
      INSERT INTO ${table} (${colList})
      VALUES (${valList})
      ON CONFLICT (${conflictColumn}) DO UPDATE
      SET ${updateList}
    `;
  }

  getMaxParameters(): number {
    return 65000;
  }

  getPurgeSql(table: string, column: string, days: number): string {
    return `DELETE FROM ${table} WHERE ${column} < NOW() - INTERVAL '${days} days'`;
  }

  getRecentApiCallsSql(intervalMs: number): string {
    const seconds = Math.floor(intervalMs / 1000);
    return `SELECT count(*) as count FROM hypixel_api_calls WHERE called_at >= (EXTRACT(EPOCH FROM NOW() - INTERVAL '${seconds} seconds') * 1000)`;
  }

  getActivePrivateUserCountSql(sincePlaceholder: string): string {
    return `SELECT COUNT(DISTINCT split_part(key, ':', 2)) AS count FROM rate_limits WHERE key LIKE 'private:%' AND window_start >= ${sincePlaceholder}`;
  }

  getPrivateRequestCountSql(sincePlaceholder: string): string {
    return `SELECT COALESCE(SUM(count), 0) AS total FROM rate_limits WHERE key LIKE 'private:%' AND window_start >= ${sincePlaceholder}`;
  }
}
