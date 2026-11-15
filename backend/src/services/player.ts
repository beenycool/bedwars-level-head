import { LRUCache } from 'lru-cache';
import { HttpError } from '../util/httpError';
import { IDENTIFIER_MAX_LENGTH, isUuid, normalizeIdentifier } from '../util/validationConstants';
import { fetchHypixelPlayer, extractMinimalStats, MinimalPlayerStats } from './hypixel';
import { logger } from '../util/logger';
import {
  buildPlayerCacheKey,
  CachedPlayerStats,
  getManyPlayerStats,
  getPlayerStats,
  setPlayerStats,
} from './statsCache';

/** Short-lived in-process cache in front of the SQL cache. */
const MEMORY_TTL_MS = 10 * 60 * 1000;

const memoizedResults = new LRUCache<string, ResolvedPlayer>({
  max: 5000,
  ttl: MEMORY_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<ResolvedPlayer>>();

/**
 * UUIDs that a recent batch warmup already looked up in SQL and did not find.
 * Saves one duplicate SELECT per cache miss in a 100-player lobby.
 */
const warmedMisses = new Set<string>();

export function clearInMemoryPlayerCache(): void {
  memoizedResults.clear();
  inFlightRequests.clear();
  warmedMisses.clear();
}

export interface ResolvedPlayer {
  payload: MinimalPlayerStats;
  etag: string | null;
  lastModified: number | null;
  source: 'cache' | 'network';
  revalidated: boolean;
  uuid: string | null;
  username: string | null;
  lookupType: 'uuid' | 'ign';
  lookupValue: string;
  nicked: boolean;
  /** Present on responses served from a stale cache entry (legacy route hints). */
  isStale?: boolean;
  staleAgeMs?: number;
}

function buildNickedStats(): MinimalPlayerStats {
  return {
    displayname: '(nicked)',
    bedwars_experience: null,
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

function fromCacheEntry(uuid: string, entry: CachedPlayerStats): ResolvedPlayer {
  const { payload, nicked } = normalizeUuidLookupStats(entry.value);
  return {
    payload,
    etag: entry.etag,
    lastModified: entry.lastModified,
    source: 'cache',
    revalidated: false,
    uuid,
    username: normalizeDisplayName(payload.displayname),
    lookupType: 'uuid',
    lookupValue: uuid,
    nicked,
  };
}

async function loadFromUpstream(uuid: string): Promise<ResolvedPlayer> {
  const response = await fetchHypixelPlayer(uuid);
  const { payload, nicked } = normalizeUuidLookupStats(extractMinimalStats(response.payload));

  void setPlayerStats(buildPlayerCacheKey(uuid), payload, {
    etag: response.etag,
    lastModified: response.lastModified,
  }).catch((error) => logger.warn({ err: error }, '[player] cache write failed'));

  return {
    payload,
    etag: response.etag,
    lastModified: response.lastModified,
    source: 'network',
    revalidated: false,
    uuid,
    username: normalizeDisplayName(payload.displayname),
    lookupType: 'uuid',
    lookupValue: uuid,
    nicked,
  };
}

/**
 * Resolves one player by undashed UUID. Lookups are deduped in-process (memoised
 * results plus a single in-flight promise per UUID) and backed by the SQL cache.
 */
export async function resolvePlayer(identifier: string): Promise<ResolvedPlayer> {
  if (!identifier || typeof identifier !== 'string' || identifier.length > IDENTIFIER_MAX_LENGTH) {
    throw new HttpError(400, 'INVALID_IDENTIFIER', `Identifier must be ${IDENTIFIER_MAX_LENGTH} characters or less.`);
  }

  const uuid = normalizeIdentifier(identifier);
  if (!isUuid(uuid)) {
    throw new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a 32-character UUID (no dashes).');
  }

  const memoized = memoizedResults.get(uuid);
  if (memoized) {
    return { ...memoized, source: 'cache' };
  }

  const pending = inFlightRequests.get(uuid);
  if (pending) {
    const result = await pending;
    return { ...result, source: 'cache' };
  }

  const promise = (async (): Promise<ResolvedPlayer> => {
    // A batch warmup that already missed in SQL does not need a second SELECT.
    const warmedMiss = warmedMisses.delete(uuid);
    const cached = warmedMiss ? null : await getPlayerStats(buildPlayerCacheKey(uuid));
    const resolved = cached ? fromCacheEntry(uuid, cached) : await loadFromUpstream(uuid);
    memoizedResults.set(uuid, resolved);
    return resolved;
  })().finally(() => {
    inFlightRequests.delete(uuid);
  });

  inFlightRequests.set(uuid, promise);
  return promise;
}

/**
 * Pre-fills the in-process cache for a batch from a single SQL round-trip.
 * Identifiers that miss are resolved individually by the caller.
 */
export async function warmupPlayerCache(identifiers: string[]): Promise<void> {
  if (warmedMisses.size > 10_000) {
    warmedMisses.clear();
  }
  const keys: { key: string; uuid: string }[] = [];
  for (const identifier of identifiers) {
    const uuid = normalizeIdentifier(identifier);
    if (isUuid(uuid)) {
      keys.push({ key: buildPlayerCacheKey(uuid), uuid });
    }
  }
  if (keys.length === 0) {
    return;
  }

  const entries = await getManyPlayerStats(keys.map((entry) => entry.key));
  for (const { key, uuid } of keys) {
    if (memoizedResults.has(uuid)) {
      continue;
    }
    const entry = entries.get(key);
    if (entry) {
      memoizedResults.set(uuid, fromCacheEntry(uuid, entry));
    } else {
      warmedMisses.add(uuid);
    }
  }
}
