import { PLAYER_CACHE_DB_TTL_MS } from '../config';
import { CacheEntry, CacheMetadata, ensureInitialized, isDatabaseReady } from './cache';
import { isNonArrayObject } from '../util/typeChecks';
import { MinimalPlayerStats } from './hypixel';
import { logger } from '../util/logger';
import { db } from './database/db';

export type CachedPlayerStats = CacheEntry<MinimalPlayerStats>;

// Versioned so a payload-shape change invalidates old rows without a manual
// purge. v2 adds bedwars_active_star for Prestige Customizer stars.
const PLAYER_KEY_PREFIX = 'player:v2:';

export function buildPlayerCacheKey(uuid: string): string {
  return `${PLAYER_KEY_PREFIX}${uuid.toLowerCase()}`;
}

function mapRow(row: { payload: unknown; expires_at: unknown; etag: string | null; last_modified: unknown }): CachedPlayerStats | null {
  let payload: unknown = row.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!isNonArrayObject(payload)) {
    return null;
  }

  const expiresAt = Number(row.expires_at);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  return {
    value: payload as unknown as MinimalPlayerStats,
    expiresAt,
    etag: row.etag,
    lastModified: row.last_modified === null ? null : Number(row.last_modified),
  };
}

export async function getPlayerStats(key: string): Promise<CachedPlayerStats | null> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return null;
  }

  try {
    const row = await db
      .selectFrom('player_stats_cache')
      .selectAll()
      .where('cache_key', '=', key)
      .executeTakeFirst();

    if (!row) {
      return null;
    }
    const entry = mapRow(row);
    if (!entry || entry.expiresAt <= Date.now()) {
      return null;
    }
    return entry;
  } catch (error) {
    logger.error({ err: error }, '[statsCache] failed to read player stats');
    return null;
  }
}

export async function getManyPlayerStats(keys: string[]): Promise<Map<string, CachedPlayerStats>> {
  const result = new Map<string, CachedPlayerStats>();
  if (keys.length === 0) {
    return result;
  }

  await ensureInitialized();
  if (!isDatabaseReady()) {
    return result;
  }

  try {
    const rows = await db
      .selectFrom('player_stats_cache')
      .selectAll()
      .where('cache_key', 'in', keys)
      .execute();

    const now = Date.now();
    for (const row of rows) {
      const entry = mapRow(row);
      if (entry && entry.expiresAt > now) {
        result.set(row.cache_key, entry);
      }
    }
  } catch (error) {
    logger.error({ err: error }, '[statsCache] failed to batch read player stats');
  }

  return result;
}

export async function setPlayerStats(
  key: string,
  stats: MinimalPlayerStats,
  metadata: CacheMetadata = {},
  ttlMs?: number,
): Promise<void> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return;
  }

  const now = Date.now();
  const ttl = typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0
    ? ttlMs
    : PLAYER_CACHE_DB_TTL_MS;
  const expiresAt = now + ttl;
  const payload = JSON.stringify(stats);
  const etag = metadata.etag ?? null;
  const lastModified = metadata.lastModified ?? null;

  try {
    await db.insertInto('player_stats_cache')
      .values({
        cache_key: key,
        payload,
        expires_at: expiresAt,
        etag,
        last_modified: lastModified,
      })
      .onConflict((oc) => oc.column('cache_key').doUpdateSet({
        payload,
        expires_at: expiresAt,
        etag,
        last_modified: lastModified,
      }))
      .execute();
  } catch (error) {
    logger.error({ err: error }, '[statsCache] failed to write player stats');
  }
}

export async function deletePlayerStatsEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  await ensureInitialized();
  if (!isDatabaseReady()) {
    return 0;
  }

  try {
    const result = await db.deleteFrom('player_stats_cache')
      .where('cache_key', 'in', keys)
      .execute();
    return Number(result[0]?.numDeletedRows ?? 0);
  } catch (error) {
    logger.error({ err: error }, '[statsCache] failed to delete player stats');
    return 0;
  }
}

export async function clearAllPlayerStatsCaches(): Promise<number> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return 0;
  }

  try {
    const result = await db.deleteFrom('player_stats_cache').execute();
    return Number(result[0]?.numDeletedRows ?? 0);
  } catch (error) {
    logger.error({ err: error }, '[statsCache] failed to clear player stats');
    return 0;
  }
}
