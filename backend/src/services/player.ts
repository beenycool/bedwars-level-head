import { LRUCache } from 'lru-cache';
import { HttpError } from '../util/httpError';
import { IDENTIFIER_MAX_LENGTH } from '../util/validationConstants';
import { CacheEntry, CacheMetadata } from './cache';
import { fetchHypixelPlayer, HypixelFetchOptions, extractMinimalStats, MinimalPlayerStats } from './hypixel';
import { lookupProfileByUsername } from './mojang';
import { recordCacheMiss, recordCacheRefresh, recordCacheSourceHit } from './metrics';
import { logger } from '../util/logger';
import {
  buildPlayerCacheKey,
  fetchWithDedupe,
  getIgnMapping,
  getPlayerStatsFromCache,
  getPlayerStatsFromCacheWithSWR,
  getManyPlayerStatsFromCacheWithSWR,
  SWRCacheEntry,
  setIgnMapping,
  setPlayerStatsBoth,
  setPlayerStatsL1,
} from './statsCache';

const uuidRegex = /^[0-9a-f]{32}$/i;
const ignRegex = /^[a-zA-Z0-9_]{1,16}$/;

const memoizedResults = new LRUCache<string, ResolvedPlayer>({
  max: 1000,
  ttl: 5 * 60 * 1000, // 5 minutes
});

const inFlightRequests = new Map<string, Promise<ResolvedPlayer>>();

export function clearInMemoryPlayerCache(): void {
  memoizedResults.clear();
  inFlightRequests.clear();
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

function memoKey(prefix: string, value: string): string {
  return `${prefix}:${value}`;
}

function getMemoized(prefix: string, value: string): ResolvedPlayer | null {
  const key = memoKey(prefix, value);
  return memoizedResults.get(key) ?? null;
}

function setMemoized(prefix: string, value: string, resolved: ResolvedPlayer): void {
  const key = memoKey(prefix, value);
  memoizedResults.set(key, resolved);
}

function logBackgroundRefreshFailure(message: string, error: unknown): void {
  logger.warn({ error }, message);
}

function scheduleBackgroundRefresh(task: () => Promise<void>, errorMessage: string): void {
  void task()
    .then(() => {
      recordCacheRefresh('success');
    })
    .catch((error) => {
      logBackgroundRefreshFailure(errorMessage, error);
      recordCacheRefresh('fail');
    });
}

function normalizeDisplayName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function summarizeCacheEntry(entry: CacheEntry<MinimalPlayerStats>): CacheMetadata {
  return { etag: entry.etag ?? undefined, lastModified: entry.lastModified ?? undefined };
}

function buildResolvedFromStats(
  stats: MinimalPlayerStats,
  meta: { etag: string | null; lastModified: number | null },
  source: 'cache' | 'network',
  revalidated: boolean,
  lookupType: 'uuid' | 'ign',
  lookupValue: string,
  uuid: string | null,
  usernameFallback?: string | null,
  nicked: boolean = false,
): ResolvedPlayer {
  return {
    payload: stats,
    etag: meta.etag,
    lastModified: meta.lastModified,
    source,
    revalidated,
    uuid,
    username: normalizeDisplayName(stats.displayname) ?? usernameFallback ?? null,
    lookupType,
    lookupValue,
    nicked,
  };
}

function mergeConditionalOptions(
  conditional: HypixelFetchOptions | undefined,
  cacheMetadata: CacheMetadata,
): HypixelFetchOptions {
  return {
    etag: conditional?.etag ?? cacheMetadata.etag ?? undefined,
    lastModified: conditional?.lastModified ?? cacheMetadata.lastModified ?? undefined,
  };
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
  isStale?: boolean;
  staleAgeMs?: number;
}

async function refreshUuidCache(
  cacheKey: string,
  normalizedUuid: string,
  cacheEntry: CacheEntry<MinimalPlayerStats> | null,
  conditional?: HypixelFetchOptions,
): Promise<ResolvedPlayer> {
  const cacheMetadata: CacheMetadata = cacheEntry ? summarizeCacheEntry(cacheEntry) : {};
  
  // Use single-flight fetch when no cache entry exists to prevent upstream request storms
  // If cache entry exists, use conditional fetch for revalidation
  let response: { stats: MinimalPlayerStats; etag: string | null; lastModified: number | null };
  let revalidated = Boolean(cacheEntry);
  
  if (!cacheEntry) {
    // Cache miss - use single-flight pattern to dedupe concurrent requests
    const fetchResult = await fetchWithDedupe(normalizedUuid, conditional);
    response = fetchResult;
    revalidated = false;
  } else {
    // Cache hit - use conditional fetch for revalidation
    const requestOptions = mergeConditionalOptions(conditional, cacheMetadata);
    const hypixelResponse = await fetchHypixelPlayer(normalizedUuid, requestOptions);

    if (hypixelResponse.notModified) {
      void setPlayerStatsL1(cacheKey, cacheEntry.value, {
        etag: cacheMetadata.etag ?? undefined,
        lastModified: cacheMetadata.lastModified ?? undefined,
        source: cacheEntry.source ?? 'hypixel',
      }).catch((e) => logger.warn('[player] L1 revalidation write failed', e));

      const displayname = normalizeDisplayName(cacheEntry.value.displayname);
      if (displayname) {
        void setIgnMapping(displayname.toLowerCase(), normalizedUuid, false)
          .catch((e) => logger.warn('[player] ign mapping revalidation write failed', e));
      }

      const resolved = buildResolvedFromStats(
        cacheEntry.value,
        { etag: cacheEntry.etag, lastModified: cacheEntry.lastModified },
        'cache',
        true,
        'uuid',
        normalizedUuid,
        normalizedUuid,
      );
      setMemoized('player', normalizedUuid, resolved);
      return resolved;
    }

    if (!hypixelResponse.payload) {
      recordCacheMiss('empty_payload');
      throw new HttpError(502, 'HYPIXEL_EMPTY_PAYLOAD', 'Hypixel did not return any data.');
    }

    response = {
      stats: extractMinimalStats(hypixelResponse.payload),
      etag: hypixelResponse.etag,
      lastModified: hypixelResponse.lastModified,
    };
  }

  const { stats, etag, lastModified } = response;

  recordCacheSourceHit('upstream');

  void setPlayerStatsBoth(cacheKey, stats, { etag, lastModified, source: 'hypixel' })
    .catch((e) => logger.warn('[player] cache write failed', e));

  const displayname = normalizeDisplayName(stats.displayname);
  if (displayname) {
    void setIgnMapping(displayname.toLowerCase(), normalizedUuid, false)
      .catch((e) => logger.warn('[player] ign mapping write failed', e));
  }

  const resolved = buildResolvedFromStats(
    stats,
    { etag, lastModified },
    'network',
    revalidated,
    'uuid',
    normalizedUuid,
    normalizedUuid,
  );
  setMemoized('player', normalizedUuid, resolved);
  return resolved;
}

async function refreshIgnMapping(normalizedIgn: string): Promise<void> {
  const profile = await lookupProfileByUsername(normalizedIgn);
  if (!profile) {
    await setIgnMapping(normalizedIgn, null, true);
    return;
  }

  const normalizedUuid = profile.id.replace(/-/g, '').toLowerCase();
  await setIgnMapping(normalizedIgn, normalizedUuid, false);
}

async function fetchByUuid(uuid: string, conditional?: HypixelFetchOptions): Promise<ResolvedPlayer> {
  const normalizedUuid = uuid.toLowerCase();
  const cacheKey = buildPlayerCacheKey(normalizedUuid);
  const memoized = getMemoized('player', normalizedUuid);
  if (memoized) {
    return { ...memoized, source: 'cache' };
  }

  const cacheEntry = await getPlayerStatsFromCacheWithSWR(cacheKey, normalizedUuid);
  if (cacheEntry) {
    const resolved = buildResolvedFromStats(
      cacheEntry.value,
      { etag: cacheEntry.etag, lastModified: cacheEntry.lastModified },
      'cache',
      false,
      'uuid',
      normalizedUuid,
      normalizedUuid,
    );
    
    // Add SWR information
    if (cacheEntry.isStale) {
      resolved.isStale = true;
      resolved.staleAgeMs = cacheEntry.staleAgeMs;
    }
    
    setMemoized('player', normalizedUuid, resolved);
    return resolved;
  }

  return refreshUuidCache(cacheKey, normalizedUuid, null, conditional);
}

async function fetchByIgn(ign: string, conditional?: HypixelFetchOptions): Promise<ResolvedPlayer> {
  const normalizedIgn = ign.toLowerCase();
  const memoized = getMemoized('ign', normalizedIgn);
  if (memoized) {
    return { ...memoized, source: 'cache' };
  }

  const mapping = await getIgnMapping(normalizedIgn, true);
  const now = Date.now();
  if (mapping) {
    if (mapping.expiresAt <= now) {
      scheduleBackgroundRefresh(
        async () => {
          await refreshIgnMapping(normalizedIgn);
        },
        `[player] background refresh for ign ${normalizedIgn} failed`,
      );
    }

    if (mapping.nicked || !mapping.uuid) {
      const nickedStats = buildNickedStats();
      const resolved = buildResolvedFromStats(
        nickedStats,
        { etag: 'nicked', lastModified: Date.now() },
        'cache',
        false,
        'ign',
        normalizedIgn,
        null,
        normalizedIgn,
        true,
      );
      setMemoized('ign', normalizedIgn, resolved);
      return resolved;
    }

    const resolvedUuid = await fetchByUuid(mapping.uuid, conditional);
    const resolved: ResolvedPlayer = {
      ...resolvedUuid,
      lookupType: 'ign',
      lookupValue: normalizedIgn,
      username: resolvedUuid.username ?? normalizedIgn,
    };
    setMemoized('ign', normalizedIgn, resolved);
    return resolved;
  }

  const profile = await lookupProfileByUsername(normalizedIgn);
  if (!profile) {
    const nickedStats = buildNickedStats();
    await setIgnMapping(normalizedIgn, null, true);
    const resolved = buildResolvedFromStats(
      nickedStats,
      { etag: 'nicked', lastModified: Date.now() },
      'network',
      false,
      'ign',
      normalizedIgn,
      null,
      normalizedIgn,
      true,
    );
    setMemoized('ign', normalizedIgn, resolved);
    return resolved;
  }

  const normalizedUuid = profile.id.replace(/-/g, '').toLowerCase();
  await setIgnMapping(normalizedIgn, normalizedUuid, false);

  const resolvedUuid = await fetchByUuid(normalizedUuid, conditional);
  const resolved: ResolvedPlayer = {
    ...resolvedUuid,
    lookupType: 'ign',
    lookupValue: normalizedIgn,
    username: resolvedUuid.username ?? profile.name ?? normalizedIgn,
  };
  setMemoized('ign', normalizedIgn, resolved);
  return resolved;
}

function normalizeConditionalHeaders(options?: PlayerResolutionOptions): HypixelFetchOptions | undefined {
  if (!options) {
    return undefined;
  }

  const normalized: HypixelFetchOptions = {};
  if (options.etag) {
    normalized.etag = options.etag;
  }
  if (typeof options.lastModified === 'number' && !Number.isNaN(options.lastModified)) {
    normalized.lastModified = options.lastModified;
  }
  return normalized;
}

export interface PlayerResolutionOptions {
  etag?: string;
  lastModified?: number;
}

export async function warmupPlayerCache(identifiers: string[]): Promise<void> {
  // Filter for valid UUIDs (no dashes)
  const uuids = identifiers.filter((id) => uuidRegex.test(id)).map((id) => id.toLowerCase());

  if (uuids.length === 0) {
    return;
  }

  const keys = uuids.map((uuid) => ({ key: buildPlayerCacheKey(uuid), uuid }));

  try {
    const results = await getManyPlayerStatsFromCacheWithSWR(keys);

    for (const { key, uuid } of keys) {
      const entry = results.get(key);
      if (!entry) continue;

      const resolved = buildResolvedFromStats(
        entry.value,
        { etag: entry.etag, lastModified: entry.lastModified },
        'cache',
        false,
        'uuid',
        uuid,
        uuid,
      );

      if (entry.isStale) {
        resolved.isStale = true;
        resolved.staleAgeMs = entry.staleAgeMs;
      }

      setMemoized('player', uuid, resolved);
    }
  } catch (error) {
    logger.warn({ error }, '[player] warmupPlayerCache failed');
  }
}

export async function resolvePlayer(
  identifier: string,
  options?: PlayerResolutionOptions,
): Promise<ResolvedPlayer> {
  if (!identifier || typeof identifier !== 'string' || identifier.length > IDENTIFIER_MAX_LENGTH) {
    throw new HttpError(400, 'INVALID_IDENTIFIER', `Identifier must be ${IDENTIFIER_MAX_LENGTH} characters or less.`);
  }

  // Fast normalization: combine length gate with structural dash check
  
  let key = identifier;
  if (key.length === 36 && key[8] === '-' && key[13] === '-' && key[18] === '-' && key[23] === '-') {
    key = key.slice(0, 8) + key.slice(9, 13) + key.slice(14, 18) + key.slice(19, 23) + key.slice(24);
  }
  key = key.toLowerCase();

  // Bolt: Consolidate validation logic to avoid repeated regex execution
  const isUuid = key.length === 32 && uuidRegex.test(key);
  const isIgn = !isUuid && ignRegex.test(key);

  const inFlightKey = isUuid ? `uuid:${key}` : isIgn ? `ign:${key}` : null;
  if (inFlightKey) {
    const pending = inFlightRequests.get(inFlightKey);
    if (pending) {
      const result = await pending;
      return { ...result, source: 'cache' };
    }
  }

  const conditional = normalizeConditionalHeaders(options);

  const executor = async (): Promise<ResolvedPlayer> => {
    if (isUuid) {
      return fetchByUuid(key, conditional);
    }

    if (isIgn) {
      // Bolt: Pass normalized key (lowercase) to avoid re-normalization
      return fetchByIgn(key, conditional);
    }

    throw new HttpError(
      400,
      'INVALID_IDENTIFIER',
      'Identifier must be a valid UUID (no dashes) or Minecraft username.',
    );
  };

  if (!inFlightKey) {
    return executor();
  }

  const promise = executor().finally(() => {
    inFlightRequests.delete(inFlightKey);
  });
  inFlightRequests.set(inFlightKey, promise);
  return promise;
}
