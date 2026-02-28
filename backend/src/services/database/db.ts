import { Kysely, PostgresDialect, MssqlDialect } from 'kysely';
import { Pool } from 'pg';
import * as mssql from 'mssql';
import { Database } from './schema';
import { DatabaseType } from './adapter'; // Reusing the enum from adapter
import { logger } from '../../util/logger';
import { AzureSqlAdapter } from './azureSqlAdapter'; // We need to reuse the parsing logic or adapter instance if possible

// We need to determine the database type from environment variables, similar to config.ts or cache.ts
const connectionString = process.env.DATABASE_URL;
const isPostgres = connectionString ? connectionString.startsWith('postgres') : false;
export const dbType = isPostgres ? DatabaseType.POSTGRESQL : DatabaseType.AZURE_SQL;

let db: Kysely<Database>;

if (dbType === DatabaseType.POSTGRESQL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for PostgreSQL');
  }

  const pool = new Pool({
    connectionString,
    max: 20, // Adjust based on your needs
    idleTimeoutMillis: 30000,
  });

  db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool,
    }),
    log: (event) => {
      if (event.level === 'error') {
        logger.error({ err: event.error, sql: event.query.sql, params: event.query.parameters }, '[db] Query Error');
      }
    },
  });

  logger.info('[db] Kysely initialized with PostgreSQL');

} else {
  // Azure SQL / MSSQL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for Azure SQL');
  }

  // To avoid code duplication and handle complex connection strings, we use the AzureSqlAdapter temporarily to get a configured pool.
  const tempAdapter = new AzureSqlAdapter(connectionString);
  const pool = tempAdapter.getPool(); // This pool is created but not connected yet

  db = new Kysely<Database>({
    dialect: new MssqlDialect({
      tarn: {
        options: {
          min: 0,
          max: 10,
        },
      },
      // Pass the configured pool factory
      pool: async () => pool,
    }),
    log: (event) => {
      if (event.level === 'error') {
        logger.error({ err: event.error, sql: event.query.sql, params: event.query.parameters }, '[db] Query Error');
      }
    },
  });

  logger.info('[db] Kysely initialized with Azure SQL');
}

export { db };
