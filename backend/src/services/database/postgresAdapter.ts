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
    // pg.Pool connects lazily or we can check with a simple query
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
    console.info('[database] PostgreSQL pool closed');
  }

  getPool(): Pool {
    return this.pool;
  }
}

