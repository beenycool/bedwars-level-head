import { LRUCache } from 'lru-cache';
import { HttpError } from '../util/httpError';
import { IDENTIFIER_MAX_LENGTH, normalizeUuid } from '../util/validationConstants';
import { fetchHypixelPlayer, extractMinimalStats, MinimalPlayerStats } from './hypixel';
import { logger } from '../util/logger';
import {
  buildPlayerCacheKey,
  CachedPlayerStats,
  getManyPlayerStats,
  getPlayerStats,
  setPlayerStats,
} from './statsCache';

const MEMORY_TTL_MS = 10 * 60 * 1000;

const memoizedResults = new LRUCache<string, ResolvedPlayer>({
  max: 5000,
  ttl: MEMORY_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<ResolvedPlayer>>();

export function clearInMemoryPlayerCache(): void {
  memoizedResults.clear();
  inFlightRequests.clear();
}

export interface ResolvedPlayer {
  payload: MinimalPlayerStats;
  etag: string | null;
  lastModified: number | null;
  source: 'cache' | 'network';
  username: string | null;
  nicked: boolean;
}

function buildNickedStats(): MinimalPlayerStats {
  return {
    displayname: '(nicked)',
    bedwars_experience: null,
    bedwars_active_star: null,
    bedwars_final_kills: 0,
    bedwars_final_deaths: 0,
    duels_wins: 0,
    duels_losses: 0,
    duels_kills: 0,
    duels_deaths: 0,
    skywars_experience: null,
    skywars_wins: 0,
    skywars_losses: 0,
    skywars_kills: 0,
    skywars_deaths: 0,
  };
}

function normalizeDisplayName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Hypixel returns no displayname for nicked players (or the literal `(nicked)`).
 * Both cases are flagged so the mod can render its "(nicked)" tag deliberately
 * instead of treating zeroed counters as real stats.
 */
function normalizeUuidLookupStats(stats: MinimalPlayerStats): { payload: MinimalPlayerStats; nicked: boolean } {
  const displayname = normalizeDisplayName(stats.displayname);
  if (!displayname || displayname === '(nicked)') {
    return { payload: buildNickedStats(), nicked: true };
  }
  if (displayname !== stats.displayname) {
    return { payload: { ...stats, displayname }, nicked: false };
  }
  return { payload: stats, nicked: false };
}

function fromCacheEntry(entry: CachedPlayerStats): ResolvedPlayer {
  const { payload, nicked } = normalizeUuidLookupStats(entry.value);
  return {
    payload,
    etag: entry.etag,
    lastModified: entry.lastModified,
    source: 'cache',
    username: normalizeDisplayName(payload.displayname),
    nicked,
  };
}

async function loadFromUpstream(uuid: string): Promise<ResolvedPlayer> {
  const startedAt = Date.now();
  logger.debug({ uuid }, '[player] upstream fetch start');
  const response = await fetchHypixelPlayer(uuid);
  const { payload, nicked } = normalizeUuidLookupStats(extractMinimalStats(response.payload));

  void setPlayerStats(buildPlayerCacheKey(uuid), payload, {
    etag: response.etag,
    lastModified: response.lastModified,
  }).catch((error) => logger.warn({ err: error }, '[player] cache write failed'));

  logger.debug({
    uuid,
    latencyMs: Date.now() - startedAt,
    displayname: payload.displayname,
    nicked,
  }, '[player] upstream fetch done');

  return {
    payload,
    etag: response.etag,
    lastModified: response.lastModified,
    source: 'network',
    username: normalizeDisplayName(payload.displayname),
    nicked,
  };
}

export async function resolvePlayer(
  identifier: string,
  warmedMisses?: Set<string>,
): Promise<ResolvedPlayer> {
  if (!identifier || typeof identifier !== 'string' || identifier.length > IDENTIFIER_MAX_LENGTH) {
    throw new HttpError(400, 'INVALID_IDENTIFIER', `Identifier must be ${IDENTIFIER_MAX_LENGTH} characters or less.`);
  }

  const uuid = normalizeUuid(identifier);
  if (!uuid) {
    throw new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a 32-character UUID (dashes optional).');
  }
  const startedAt = Date.now();

  const memoized = memoizedResults.get(uuid);
  if (memoized) {
    logger.debug({ uuid, source: 'memory', latencyMs: Date.now() - startedAt }, '[player] resolved');
    return { ...memoized, source: 'cache' };
  }

  const pending = inFlightRequests.get(uuid);
  if (pending) {
    const result = await pending;
    logger.debug({ uuid, source: 'inflight', latencyMs: Date.now() - startedAt }, '[player] resolved');
    return { ...result, source: 'cache' };
  }

  const promise = (async (): Promise<ResolvedPlayer> => {
    // A batch warmup that already missed in SQL does not need a second SELECT.
    const warmedMiss = warmedMisses?.delete(uuid) ?? false;
    const cached = warmedMiss ? null : await getPlayerStats(buildPlayerCacheKey(uuid));
    const resolved = cached ? fromCacheEntry(cached) : await loadFromUpstream(uuid);
    logger.debug({
      uuid,
      source: cached ? 'sql' : 'network',
      latencyMs: Date.now() - startedAt,
    }, '[player] resolved');
    memoizedResults.set(uuid, resolved);
    return resolved;
  })().finally(() => {
    inFlightRequests.delete(uuid);
  });

  inFlightRequests.set(uuid, promise);
  return promise;
}

export async function warmupPlayerCache(identifiers: string[]): Promise<Set<string>> {
  const keys: { key: string; uuid: string }[] = [];
  const requested = new Set<string>();
  for (const identifier of identifiers) {
    const uuid = normalizeUuid(identifier);
    if (uuid && !requested.has(uuid)) {
      requested.add(uuid);
      keys.push({ key: buildPlayerCacheKey(uuid), uuid });
    }
  }
  if (keys.length === 0) {
    return new Set();
  }

  const entries = await getManyPlayerStats(keys.map((entry) => entry.key));
  const misses = new Set<string>();
  for (const { key, uuid } of keys) {
    if (memoizedResults.has(uuid)) {
      continue;
    }
    const entry = entries.get(key);
    if (entry) {
      memoizedResults.set(uuid, fromCacheEntry(entry));
    } else {
      misses.add(uuid);
    }
  }
  logger.debug({
    requested: requested.size,
    keys: keys.length,
    sqlEntries: entries.size,
    misses: misses.size,
  }, '[player] batch warmup');
  return misses;
}
