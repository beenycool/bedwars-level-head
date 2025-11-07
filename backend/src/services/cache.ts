import { Pool } from 'pg';
import { CACHE_DB_URL, CACHE_DB_POOL_MAX, CACHE_DB_POOL_MIN } from '../config';
import { recordCacheHit, recordCacheMiss } from './metrics';

interface CacheRow {
  payload: string;
  expires_at: number | string;
  etag: string | null;
  last_modified: number | string | null;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  etag: string | null;
  lastModified: number | null;
}

export interface CacheMetadata {
  etag?: string | null;
  lastModified?: number | null;
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

const initialization = pool
  .query(
    `CREATE TABLE IF NOT EXISTS player_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      etag TEXT,
      last_modified BIGINT
    )`,
  )
  .then(() => {
    console.info('[cache] player_cache table is ready');
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize cache table', error);
    throw error;
  });

async function ensureInitialized(): Promise<void> {
  await initialization;
}

export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();
  const result = await pool.query('DELETE FROM player_cache WHERE expires_at <= $1', [now]);
  const purged = result.rowCount ?? 0;
  if (purged > 0) {
    console.info(`[cache] purged ${purged} expired entries`);
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

  return {
    value: JSON.parse(row.payload) as T,
    expiresAt,
    etag: row.etag,
    lastModified,
  };
}

export async function getCacheEntry<T>(key: string, includeExpired = false): Promise<CacheEntry<T> | null> {
  await ensureInitialized();
  const result = await pool.query<CacheRow>(
    'SELECT payload, expires_at, etag, last_modified FROM player_cache WHERE cache_key = $1',
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
    `INSERT INTO player_cache (cache_key, payload, expires_at, etag, last_modified)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cache_key) DO UPDATE
     SET payload = EXCLUDED.payload,
         expires_at = EXCLUDED.expires_at,
         etag = EXCLUDED.etag,
         last_modified = EXCLUDED.last_modified`,
    [key, payload, expiresAt, metadata.etag ?? null, metadata.lastModified ?? null],
  );
  const expiresIso = new Date(expiresAt).toISOString();
  const lastModifiedIso =
    typeof metadata.lastModified === 'number' ? new Date(metadata.lastModified).toISOString() : metadata.lastModified;
  console.info(
    `[cache] stored key=${key} expires_at=${expiresIso} etag=${metadata.etag ?? 'null'} last_modified=${lastModifiedIso ?? 'null'}`,
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
