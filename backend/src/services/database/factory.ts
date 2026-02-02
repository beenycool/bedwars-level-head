import { CACHE_DB_URL, CACHE_DB_POOL_MIN, CACHE_DB_POOL_MAX } from '../../config';
import { DatabaseAdapter, DatabaseType } from './adapter';
import { PostgresAdapter } from './postgresAdapter';
import { AzureSqlAdapter } from './azureSqlAdapter';

export function getDatabaseType(connectionString: string): DatabaseType {
  const normalized = connectionString.trim();
  if (normalized.startsWith('postgresql://') || normalized.startsWith('postgres://')) {
    return DatabaseType.POSTGRESQL;
  }
  if (normalized.startsWith('sqlserver://') || normalized.startsWith('mssql://')) {
    return DatabaseType.AZURE_SQL;
  }
  if (/^(server|data source)\s*=/i.test(normalized) || /;\s*(initial catalog|user id)\s*=/i.test(normalized)) {
    return DatabaseType.AZURE_SQL;
  }
  // Default to PostgreSQL if unsure, but log a warning
  console.warn(`[database] Unknown database type in connection string, defaulting to PostgreSQL: ${normalized.split(':')[0]}...`);
  return DatabaseType.POSTGRESQL;
}

export function createAdapter(connectionString: string): DatabaseAdapter {
  const type = getDatabaseType(connectionString);

  if (type === DatabaseType.AZURE_SQL) {
    return new AzureSqlAdapter(connectionString);
  }

  return new PostgresAdapter({
    connectionString,
    min: CACHE_DB_POOL_MIN,
    max: CACHE_DB_POOL_MAX,
  });
}


// Singleton instance
export const database = createAdapter(CACHE_DB_URL);
