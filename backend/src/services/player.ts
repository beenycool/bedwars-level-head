import { LRUCache } from 'lru-cache';
import { HttpError } from '../util/httpError';
import { CacheEntry, CacheMetadata } from './cache';
import { fetchHypixelPlayer, HypixelFetchOptions, extractMinimalStats, MinimalPlayerStats } from './hypixel';
import { lookupProfileByUsername } from './mojang';
import { recordCacheMiss } from './metrics';
import {
  buildPlayerCacheKey,
  getIgnMapping,
  getPlayerStatsFromCache,
  setIgnMapping,
  setPlayerStatsBoth,
  setPlayerStatsL1,
} from './statsCache';

const uuidRegex = /^[0-9a-f]{32}$/i;
const dashedUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  console.warn(message, error);
}

function scheduleBackgroundRefresh(task: () => Promise<void>, errorMessage: string): void {
  void task().catch((error) => {
    logBackgroundRefreshFailure(errorMessage, error);
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
}

async function refreshUuidCache(
  cacheKey: string,
  normalizedUuid: string,
  cacheEntry: CacheEntry<MinimalPlayerStats> | null,
  conditional?: HypixelFetchOptions,
): Promise<ResolvedPlayer> {
  const cacheMetadata: CacheMetadata = cacheEntry ? summarizeCacheEntry(cacheEntry) : {};
  const requestOptions = mergeConditionalOptions(conditional, cacheMetadata);
  let response = await fetchHypixelPlayer(normalizedUuid, requestOptions);

  if (response.notModified) {
    if (cacheEntry) {
      void setPlayerStatsL1(cacheKey, cacheEntry.value, {
        etag: cacheMetadata.etag ?? undefined,
        lastModified: cacheMetadata.lastModified ?? undefined,
        source: cacheEntry.source ?? 'hypixel',
      }).catch((e) => console.warn('[player] L1 revalidation write failed', e));

      const displayname = normalizeDisplayName(cacheEntry.value.displayname);
      if (displayname) {
        void setIgnMapping(displayname.toLowerCase(), normalizedUuid, false)
          .catch((e) => console.warn('[player] ign mapping revalidation write failed', e));
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

    // Hypixel returned 304 but the local cache was purged; refetch without conditionals.
    recordCacheMiss('not_modified_without_cache');
    response = await fetchHypixelPlayer(normalizedUuid);
  }

  const payload = response.payload;
  if (!payload) {
    recordCacheMiss('empty_payload');
    throw new HttpError(502, 'HYPIXEL_EMPTY_PAYLOAD', 'Hypixel did not return any data.');
  }

  const etag = response.etag ?? cacheEntry?.etag ?? null;
  const lastModified = response.lastModified ?? cacheEntry?.lastModified ?? null;
  const stats = extractMinimalStats(payload);

  void setPlayerStatsBoth(cacheKey, stats, { etag, lastModified, source: 'hypixel' })
    .catch((e) => console.warn('[player] cache write failed', e));

  const displayname = normalizeDisplayName(stats.displayname);
  if (displayname) {
    void setIgnMapping(displayname.toLowerCase(), normalizedUuid, false)
      .catch((e) => console.warn('[player] ign mapping write failed', e));
  }

  const resolved = buildResolvedFromStats(
    stats,
    { etag, lastModified },
    'network',
    Boolean(cacheEntry),
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

  const cacheEntry = await getPlayerStatsFromCache(cacheKey, true);
  const now = Date.now();
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
    setMemoized('player', normalizedUuid, resolved);

    if (cacheEntry.expiresAt <= now) {
      scheduleBackgroundRefresh(
        async () => {
          await refreshUuidCache(cacheKey, normalizedUuid, cacheEntry, conditional);
        },
        `[player] background refresh for ${normalizedUuid} failed`,
      );
    }

    return resolved;
  }

  return refreshUuidCache(cacheKey, normalizedUuid, cacheEntry, conditional);
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

export async function resolvePlayer(
  identifier: string,
  options?: PlayerResolutionOptions,
): Promise<ResolvedPlayer> {
  const normalizedIdentifier = dashedUuidRegex.test(identifier) ? identifier.replace(/-/g, '') : identifier;
  const key = normalizedIdentifier.toLowerCase();
  const inFlightKey = uuidRegex.test(key) ? `uuid:${key}` : ignRegex.test(key) ? `ign:${key}` : null;
  if (inFlightKey) {
    const pending = inFlightRequests.get(inFlightKey);
    if (pending) {
      const result = await pending;
      return { ...result, source: 'cache' };
    }
  }

  const conditional = normalizeConditionalHeaders(options);

  const executor = async (): Promise<ResolvedPlayer> => {
    if (uuidRegex.test(key)) {
      return fetchByUuid(key, conditional);
    }

    if (ignRegex.test(identifier)) {
      return fetchByIgn(identifier, conditional);
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
