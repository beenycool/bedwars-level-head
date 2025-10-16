import { Pool } from 'pg';
import { CACHE_DB_URL } from '../config';

interface CacheEntry {
  payload: string;
  expires_at: number | string;
}

const pool = new Pool({ connectionString: CACHE_DB_URL });

const initialization = pool
  .query(
    `CREATE TABLE IF NOT EXISTS player_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
  )
  .catch((error: unknown) => {
    console.error('Failed to initialize cache table', error);
    throw error;
  });

async function ensureInitialized(): Promise<void> {
  await initialization;
}

export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();
  await pool.query('DELETE FROM player_cache WHERE expires_at <= $1', [now]);
}

export async function getCachedPayload<T>(key: string): Promise<T | null> {
  await ensureInitialized();
  const result = await pool.query<CacheEntry>('SELECT payload, expires_at FROM player_cache WHERE cache_key = $1', [key]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const expiresAt = typeof row.expires_at === 'string' ? Number.parseInt(row.expires_at, 10) : row.expires_at;
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await pool.query('DELETE FROM player_cache WHERE cache_key = $1', [key]);
    return null;
  }

  try {
    return JSON.parse(row.payload) as T;
  } catch (error) {
    await pool.query('DELETE FROM player_cache WHERE cache_key = $1', [key]);
    return null;
  }
}

export async function setCachedPayload<T>(key: string, value: T, ttlMs: number): Promise<void> {
  await ensureInitialized();
  const expiresAt = Date.now() + ttlMs;
  const payload = JSON.stringify(value);
  await pool.query(
    `INSERT INTO player_cache (cache_key, payload, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
    [key, payload, expiresAt],
  );
}

export async function closeCache(): Promise<void> {
  await ensureInitialized();
  await pool.end();
}
