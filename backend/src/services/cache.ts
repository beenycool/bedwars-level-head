import { sql } from 'kysely';
import { db, isDatabaseConfigured } from './database/db';
import { logger } from '../util/logger';

/** A cached player-stats row as the rest of the service sees it. */
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

/** Re-export the pool for the `/healthz` database probe. */
export { db as pool };

let dbReady = false;
let initialization: Promise<boolean> | null = null;
let nextAttemptAt = 0;
const RETRY_INTERVAL_MS = 60_000;

async function createTables(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS player_stats_cache (
      cache_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      expires_at BIGINT NOT NULL,
      cached_at BIGINT,
      etag TEXT,
      last_modified BIGINT,
      source TEXT DEFAULT 'hypixel',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`.execute(db);
  await sql`ALTER TABLE player_stats_cache ADD COLUMN IF NOT EXISTS cached_at BIGINT`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_player_stats_expires ON player_stats_cache (expires_at)`.execute(db);
}

/**
 * Creates the cache table on first use. Safe to call on every request: the work
 * happens once and failures degrade to the in-process cache instead of throwing.
 */
export async function ensureInitialized(): Promise<void> {
  if (!isDatabaseConfigured || dbReady) {
    return;
  }
  if (!initialization && Date.now() < nextAttemptAt) {
    return;
  }
  if (!initialization) {
    initialization = createTables()
      .then(() => {
        dbReady = true;
        logger.info('[cache] player_stats_cache table is ready');
        return true;
      })
      .catch((error) => {
        initialization = null;
        nextAttemptAt = Date.now() + RETRY_INTERVAL_MS;
        logger.error({ err: error }, '[cache] database unavailable; using the in-process cache only');
        return false;
      });
  }
  await initialization;
}

/** Synchronous gate used before issuing SQL (failed/unconfigured DB means skip). */
export function isDatabaseReady(): boolean {
  return dbReady;
}

/** `/healthz` probe: a missing or unreachable database must not fail the service. */
export async function checkDatabaseHealth(): Promise<boolean> {
  if (!isDatabaseConfigured) {
    return true;
  }
  await ensureInitialized();
  if (!dbReady) {
    return false;
  }
  try {
    await sql`SELECT 1`.execute(db);
    return true;
  } catch (error) {
    logger.error({ err: error }, '[cache] database health check failed');
    return false;
  }
}

/** Deletes rows past their TTL. Called hourly by the scheduler. */
export async function purgeExpiredEntries(now: number = Date.now()): Promise<void> {
  await ensureInitialized();
  if (!dbReady) {
    return;
  }
  try {
    const result = await sql`DELETE FROM player_stats_cache WHERE expires_at <= ${now}`.execute(db);
    const purged = Number(result.numAffectedRows ?? 0);
    if (purged > 0) {
      logger.info(`[cache] purged ${purged} expired player_stats_cache rows`);
    }
  } catch (error) {
    logger.error({ err: error }, '[cache] failed to purge expired rows');
  }
}

export async function closeCache(): Promise<void> {
  await db.destroy();
  logger.info('[cache] database closed');
}
