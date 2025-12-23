import { Pool } from 'pg';
import {
  CACHE_DB_URL,
  CACHE_DB_POOL_MAX,
  CACHE_DB_POOL_MIN,
  HYPIXEL_API_CALL_WINDOW_MS,
  CACHE_DB_SIZE_LIMIT_BYTES,
} from '../config';
import { recordCacheHit, recordCacheMiss } from './metrics';

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
}

interface CacheRow {
  payload: unknown; // JSONB - pg driver parses it automatically
  expires_at: number | string;
  etag: string | null;
  last_modified: number | string | null;
  source: string | null;
}

export type CacheSource = 'hypixel' | 'community_verified' | 'community_unverified';

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  etag: string | null;
  lastModified: number | null;
  source: CacheSource | null;
}

export interface CacheMetadata {
  etag?: string | null;
  lastModified?: number | null;
  source?: CacheSource | null;
}

export const pool = new Pool({
  connectionString: CACHE_DB_URL,
  min: CACHE_DB_POOL_MIN,
  max: CACHE_DB_POOL_MAX,
});

pool.on('connect', () => {
  console.info('[cache] connected to PostgreSQL');
});

pool.on('error', (error: unknown) => {
  console.error('[cache] unexpected database error', error);
});

async function ensureRateLimitTable(): Promise<void> {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count BIGINT NOT NULL,
        window_start BIGINT NOT NULL
      )`,
    );
  } catch (error) {
    const dbError = error as DatabaseError | undefined;
    if (dbError?.code !== '42P07') {
      throw error;
    }
  }

  const columnInfo = await pool.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'rate_limits' AND table_schema = current_schema() AND column_name = 'count'`,
  );
  const dataType = columnInfo.rows[0]?.data_type;
  if (dataType && dataType.toLowerCase() !== 'bigint') {
    await pool.query('ALTER TABLE rate_limits ALTER COLUMN count TYPE BIGINT USING count::BIGINT');
    console.info('[cache] migrated rate_limits.count column to BIGINT');
  }
}

const initialization = pool
  .query(
    `CREATE TABLE IF NOT EXISTS player_cache (
      cache_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      expires_at BIGINT NOT NULL,
      etag TEXT,
      last_modified BIGINT
    )`,
  )
  .then(async () => {
    console.info('[cache] player_cache table is ready');

    await ensureRateLimitTable();
    console.info('[cache] rate_limits table is ready');

    const alterStatements: Array<{ column: string; query: string }> = [
      { column: 'etag', query: 'ALTER TABLE player_cache ADD COLUMN IF NOT EXISTS etag TEXT' },
      {
        column: 'last_modified',
        query: 'ALTER TABLE player_cache ADD COLUMN IF NOT EXISTS last_modified BIGINT',
      },
      {
        column: 'source',
        query: 'ALTER TABLE player_cache ADD COLUMN IF NOT EXISTS source TEXT',
      },
    ];

    for (const { column, query } of alterStatements) {
      try {
        const result = await pool.query(query);
        if (result.command === 'ALTER') {
          console.info(`[cache] ensured column ${column} exists on player_cache`);
        }
      } catch (error) {
        const dbError = error as DatabaseError | undefined;
        if (dbError?.code === '42701') {
          console.info(`[cache] column ${column} already exists (concurrent migration handled)`);
          continue;
        }
        console.error(`[cache] failed to ensure column ${column} exists`, error);
        throw error;
      }
    }
    await pool.query(
      `CREATE TABLE IF NOT EXISTS hypixel_api_calls (
        id BIGSERIAL PRIMARY KEY,
        called_at BIGINT NOT NULL,
        uuid TEXT NOT NULL
      )`,
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_hypixel_calls_time ON hypixel_api_calls (called_at)',
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_player_cache_expires ON player_cache (expires_at)',
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start)',
    );
    console.info('[cache] hypixel_api_calls table is ready');
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize cache table', error);
    throw error;
  });

export async function ensureInitialized(): Promise<void> {
  await initialization;
}

export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();
  const result = await pool.query('DELETE FROM player_cache WHERE expires_at <= $1', [now]);
  const purged = result.rowCount ?? 0;
  if (purged > 0) {
    console.info(`[cache] purged ${purged} expired entries`);
  }

  await enforceDbSizeLimit();

  const historyResult = await pool.query(
    "DELETE FROM player_query_history WHERE requested_at < NOW() - INTERVAL '30 days'",
  );
  const purgedHistory = historyResult.rowCount ?? 0;
  if (purgedHistory > 0) {
    console.info(`[cache] purged ${purgedHistory} historical query entries older than 30 days`);
  }

  const staleRateLimitThreshold = now - 60 * 60 * 1000;
  const rateLimitResult = await pool.query('DELETE FROM rate_limits WHERE window_start <= $1', [
    staleRateLimitThreshold,
  ]);
  const purgedBuckets = rateLimitResult.rowCount ?? 0;
  if (purgedBuckets > 0) {
    console.info(`[cache] purged ${purgedBuckets} expired rate limit entries`);
  }
  const hypixelCutoff = now - HYPIXEL_API_CALL_WINDOW_MS;
  const hypixelResult = await pool.query('DELETE FROM hypixel_api_calls WHERE called_at <= $1', [
    hypixelCutoff,
  ]);
  const purgedCalls = hypixelResult.rowCount ?? 0;
  if (purgedCalls > 0) {
    console.info(`[cache] purged ${purgedCalls} expired hypixel_api_calls entries`);
  }
}

function mapRow<T>(row: CacheRow): CacheEntry<T> {
  const expiresAtRaw = row.expires_at;
  const expiresAt = typeof expiresAtRaw === 'string' ? Number.parseInt(expiresAtRaw, 10) : expiresAtRaw;
  const lastModifiedRaw = row.last_modified;
  const lastModified =
    lastModifiedRaw === null
      ? null
      : typeof lastModifiedRaw === 'string'
        ? Number.parseInt(lastModifiedRaw, 10)
        : lastModifiedRaw;

  // payload may be JSONB (already parsed) or legacy TEXT containing JSON; handle both
  let parsedPayload: unknown = row.payload;
  if (typeof row.payload === 'string') {
    parsedPayload = JSON.parse(row.payload);
  }

  // Validate source is a known value, default to null for legacy entries
  const source = row.source as CacheSource | null;
  const validSource = source === 'hypixel' || source === 'community_verified' || source === 'community_unverified'
    ? source
    : null;

  return {
    value: parsedPayload as T,
    expiresAt,
    etag: row.etag,
    lastModified,
    source: validSource,
  };
}

export async function getCacheEntry<T>(key: string, includeExpired = false): Promise<CacheEntry<T> | null> {
  await ensureInitialized();
  const result = await pool.query<CacheRow>(
    'SELECT payload, expires_at, etag, last_modified, source FROM player_cache WHERE cache_key = $1',
    [key],
  );
  const row = result.rows[0];
  if (!row) {
    recordCacheMiss('absent');
    console.info(`[cache] miss key=${key} reason=not_found`);
    return null;
  }

  let entry: CacheEntry<T>;
  try {
    entry = mapRow<T>(row);
  } catch (error) {
    if (!includeExpired) {
      await pool.query('DELETE FROM player_cache WHERE cache_key = $1', [key]);
    }
    recordCacheMiss('deserialization');
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[cache] miss key=${key} reason=deserialization error=${errorMessage}`);
    return null;
  }
  const now = Date.now();
  if (Number.isNaN(entry.expiresAt) || entry.expiresAt <= now) {
    if (!includeExpired) {
      await pool.query('DELETE FROM player_cache WHERE cache_key = $1', [key]);
    }
    recordCacheMiss('expired');
    if (includeExpired) {
      console.info(`[cache] miss key=${key} reason=expired returning_stale`);
    } else {
      console.info(`[cache] miss key=${key} reason=expired`);
    }
    return includeExpired ? entry : null;
  }

  recordCacheHit();
  console.info(
    `[cache] hit key=${key} expires_at=${new Date(entry.expiresAt).toISOString()} etag=${entry.etag ?? 'null'}`,
  );
  return entry;
}

export async function setCachedPayload<T>(
  key: string,
  value: T,
  ttlMs: number,
  metadata: CacheMetadata = {},
): Promise<void> {
  await ensureInitialized();
  const expiresAt = Date.now() + ttlMs;
  const payload = JSON.stringify(value);
  await pool.query(
    `INSERT INTO player_cache (cache_key, payload, expires_at, etag, last_modified, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cache_key) DO UPDATE
     SET payload = EXCLUDED.payload,
         expires_at = EXCLUDED.expires_at,
         etag = EXCLUDED.etag,
         last_modified = EXCLUDED.last_modified,
         source = EXCLUDED.source`,
    [key, payload, expiresAt, metadata.etag ?? null, metadata.lastModified ?? null, metadata.source ?? null],
  );
  const expiresIso = new Date(expiresAt).toISOString();
  const lastModifiedIso =
    typeof metadata.lastModified === 'number' ? new Date(metadata.lastModified).toISOString() : metadata.lastModified;
  console.info(
    `[cache] stored key=${key} expires_at=${expiresIso} etag=${metadata.etag ?? 'null'} last_modified=${lastModifiedIso ?? 'null'} source=${metadata.source ?? 'null'}`,
  );
}

export async function clearAllCacheEntries(): Promise<number> {
  await ensureInitialized();
  const result = await pool.query('DELETE FROM player_cache');
  const cleared = result.rowCount ?? 0;
  if (cleared > 0) {
    console.warn(`[cache] cleared ${cleared} cached entries`);
  }
  return result.rowCount ?? 0;
}

export async function deleteCacheEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  await ensureInitialized();
  const result = await pool.query('DELETE FROM player_cache WHERE cache_key = ANY($1)', [keys]);
  const deleted = result.rowCount ?? 0;
  if (deleted > 0) {
    console.info(`[cache] deleted ${deleted} cache entries for requested keys`);
  }
  return result.rowCount ?? 0;
}

export async function closeCache(): Promise<void> {
  await ensureInitialized();
  await pool.end();
  console.info('[cache] PostgreSQL pool closed');
}

export async function enforceDbSizeLimit(): Promise<void> {
  if (CACHE_DB_SIZE_LIMIT_BYTES <= 0) return;

  await ensureInitialized();

  try {
    const sizeResult = await pool.query('SELECT pg_database_size(current_database()) as size');
    const currentSize = parseInt(sizeResult.rows[0].size, 10);

    if (currentSize > CACHE_DB_SIZE_LIMIT_BYTES) {
      console.warn(
        `[cache] DB size ${currentSize} exceeds limit ${CACHE_DB_SIZE_LIMIT_BYTES}. Evicting entries...`,
      );
      // Delete oldest 1000 entries
      const deleteResult = await pool.query(`
        DELETE FROM player_cache
        WHERE cache_key IN (
            SELECT cache_key FROM player_cache
            ORDER BY last_modified ASC NULLS FIRST
            LIMIT 1000
        )
      `);
      const deleted = deleteResult.rowCount ?? 0;
      if (deleted > 0) {
        console.info(`[cache] Evicted ${deleted} entries to free space.`);
      }
    }
  } catch (err) {
    console.error('[cache] Failed to enforce DB size limit', err);
  }
}

export async function getActivePrivateUserCount(since: number): Promise<number> {
  await ensureInitialized();
  const result = await pool.query<{ count: string }>(
    `
    SELECT COUNT(DISTINCT split_part(key, ':', 2)) AS count
    FROM rate_limits
    WHERE key LIKE 'private:%' AND window_start >= $1
    `,
    [since],
  );
  const raw = result.rows[0]?.count ?? '0';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getPrivateRequestCount(since: number): Promise<number> {
  await ensureInitialized();
  const result = await pool.query<{ total: string | null }>(
    `
    SELECT COALESCE(SUM(count), 0) AS total
    FROM rate_limits
    WHERE key LIKE 'private:%' AND window_start >= $1
    `,
    [since],
  );
  const raw = result.rows[0]?.total ?? '0';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
