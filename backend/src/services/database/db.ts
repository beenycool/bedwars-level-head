import { Kysely, PostgresDialect } from 'kysely';
import { Pool, type PoolConfig } from 'pg';
import { Database } from './schema';
import { CACHE_DB_URL } from '../../config';
import { logger } from '../../util/logger';

export const isDatabaseConfigured = CACHE_DB_URL.length > 0;

const rawPoolMax = process.env.DB_POOL_MAX ?? process.env.CACHE_DB_POOL_MAX;
const parsedPoolMax = rawPoolMax ? Number.parseInt(rawPoolMax, 10) : 10;
const poolMax = Number.isFinite(parsedPoolMax) && parsedPoolMax > 0 ? parsedPoolMax : 10;

const poolConfig: PoolConfig = {
  // `pg` accepts a placeholder and only dials on first query, so an unconfigured
  // deployment never opens a socket: cache.ts short-circuits on isDatabaseConfigured.
  connectionString: CACHE_DB_URL || 'postgres://localhost/levelhead',
  max: poolMax,
  idleTimeoutMillis: 30000,
};

// DB_TRUST_SERVER_CERTIFICATE=true skips TLS certificate validation (self-signed/managed DBs).
if (process.env.DB_TRUST_SERVER_CERTIFICATE === 'true') {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
  log: (event) => {
    if (event.level === 'error') {
      logger.error({ err: event.error, sql: event.query.sql }, '[db] query failed');
    }
  },
});

if (isDatabaseConfigured) {
  logger.info(`[db] PostgreSQL cache configured (pool max: ${poolMax})`);
} else {
  logger.warn('[db] CACHE_DB_URL is not set; running with the in-process cache only');
}
