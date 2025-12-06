import { LRUCache } from 'lru-cache';
import { CACHE_TTL_MS } from '../config';
import { HttpError } from '../util/httpError';
import { CacheEntry, CacheMetadata, getCacheEntry, setCachedPayload } from './cache';
import { fetchHypixelPlayer, HypixelFetchOptions, ProxyPlayerPayload } from './hypixel';
import { lookupProfileByUsername } from './mojang';
import { recordCacheMiss } from './metrics';

const uuidRegex = /^[0-9a-f]{32}$/i;
const dashedUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ignRegex = /^[a-zA-Z0-9_]{1,16}$/;

function buildCacheKey(prefix: string, value: string): string {
  return `${prefix}:${value}`;
}

const memoizedResults = new LRUCache<string, ResolvedPlayer>({
  max: 1000,
  ttl: 5 * 60 * 1000, // 5 minutes
});

const inFlightRequests = new Map<string, Promise<ResolvedPlayer>>();

export function clearInMemoryPlayerCache(): void {
  memoizedResults.clear();
  inFlightRequests.clear();
}

function extractDisplayName(payload: ProxyPlayerPayload): string | null {
  if (payload.display && typeof payload.display === 'string') {
    return payload.display;
  }

  const bedwars = payload.data?.bedwars ?? payload.bedwars;
  if (bedwars && typeof bedwars === 'object') {
    const candidate = (bedwars as Record<string, unknown>).displayname;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const player = payload.player as Record<string, unknown> | undefined;
  if (player && typeof player.displayname === 'string') {
    const candidate = player.displayname as string;
    if (candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

function buildNickedPayload(): ProxyPlayerPayload {
  const display = '(nicked)';
  const bedwarsStats: Record<string, unknown> = {
    nicked: true,
    display,
  };

  return {
    success: true,
    message: 'Player appears to be nicked.',
    nicked: true,
    display,
    data: {
      bedwars: bedwarsStats,
    },
    bedwars: bedwarsStats,
    player: {
      stats: {
        Bedwars: bedwarsStats,
      },
    },
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

function summarizeCacheEntry(entry: CacheEntry<ProxyPlayerPayload>): CacheMetadata {
  return { etag: entry.etag ?? undefined, lastModified: entry.lastModified ?? undefined };
}

export interface ResolvedPlayer {
  payload: ProxyPlayerPayload;
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

async function fetchByUuid(uuid: string, conditional?: HypixelFetchOptions): Promise<ResolvedPlayer> {
  const normalizedUuid = uuid.toLowerCase();
  const cacheKey = buildCacheKey('player', normalizedUuid);
  const memoized = getMemoized('player', normalizedUuid);
  if (memoized) {
    return memoized;
  }

  const cacheEntry = await getCacheEntry<ProxyPlayerPayload>(cacheKey, true);
  const now = Date.now();
  if (cacheEntry && cacheEntry.expiresAt > now) {
    const payload = cacheEntry.value;
    const resolved: ResolvedPlayer = {
      payload,
      etag: cacheEntry.etag,
      lastModified: cacheEntry.lastModified,
      source: 'cache',
      revalidated: false,
      uuid: normalizedUuid,
      username: extractDisplayName(payload),
      lookupType: 'uuid',
      lookupValue: normalizedUuid,
      nicked: payload.nicked === true,
    };
    setMemoized('player', normalizedUuid, resolved);
    return resolved;
  }

  const cacheMetadata = cacheEntry ? summarizeCacheEntry(cacheEntry) : {};

  const response = await fetchHypixelPlayer(normalizedUuid, {
    etag: conditional?.etag ?? cacheMetadata.etag ?? undefined,
    lastModified: conditional?.lastModified ?? cacheMetadata.lastModified ?? undefined,
  });

  if (response.notModified && cacheEntry) {
    const payload = cacheEntry.value;
    await setCachedPayload(cacheKey, payload, CACHE_TTL_MS, cacheMetadata);
    const resolved: ResolvedPlayer = {
      payload,
      etag: cacheEntry.etag,
      lastModified: cacheEntry.lastModified,
      source: 'cache',
      revalidated: true,
      uuid: normalizedUuid,
      username: extractDisplayName(payload),
      lookupType: 'uuid',
      lookupValue: normalizedUuid,
      nicked: payload.nicked === true,
    };
    setMemoized('player', normalizedUuid, resolved);
    return resolved;
  }

  const payload = response.payload ?? cacheEntry?.value;
  if (!payload) {
    recordCacheMiss('empty_payload');
    throw new HttpError(502, 'HYPIXEL_EMPTY_PAYLOAD', 'Hypixel did not return any data.');
  }

  const etag = response.etag ?? cacheEntry?.etag ?? null;
  const lastModified = response.lastModified ?? cacheEntry?.lastModified ?? null;

  await setCachedPayload(cacheKey, payload, CACHE_TTL_MS, { etag, lastModified });

  const resolved: ResolvedPlayer = {
    payload,
    etag,
    lastModified,
    source: 'network',
    revalidated: Boolean(cacheEntry),
    uuid: normalizedUuid,
    username: extractDisplayName(payload),
    lookupType: 'uuid',
    lookupValue: normalizedUuid,
    nicked: payload.nicked === true,
  };
  setMemoized('player', normalizedUuid, resolved);
  return resolved;
}

async function fetchByIgn(ign: string): Promise<ResolvedPlayer> {
  const normalizedIgn = ign.toLowerCase();
  const ignCacheKey = buildCacheKey('ign', normalizedIgn);
  const memoized = getMemoized('ign', normalizedIgn);
  if (memoized) {
    return memoized;
  }

  const cacheEntry = await getCacheEntry<ProxyPlayerPayload>(ignCacheKey, true);
  const now = Date.now();
  if (cacheEntry && cacheEntry.expiresAt > now) {
    const payload = cacheEntry.value;
    const payloadPlayer =
      payload && typeof payload === 'object' && 'player' in payload
        ? (payload as { player?: unknown }).player
        : undefined;
    const payloadUuidCandidate =
      payloadPlayer && typeof payloadPlayer === 'object' && payloadPlayer !== null && 'uuid' in payloadPlayer
        ? (payloadPlayer as { uuid?: unknown }).uuid
        : undefined;
    const payloadUuidRaw = typeof payloadUuidCandidate === 'string' ? payloadUuidCandidate : null;
    const payloadUuid = payloadUuidRaw ? payloadUuidRaw.replace(/-/g, '').toLowerCase() : null;

    const resolved: ResolvedPlayer = {
      payload,
      etag: cacheEntry.etag,
      lastModified: cacheEntry.lastModified,
      source: 'cache',
      revalidated: false,
      uuid: payloadUuid,
      username: extractDisplayName(payload) ?? normalizedIgn,
      lookupType: 'ign',
      lookupValue: normalizedIgn,
      nicked: payload.nicked === true,
    };
    setMemoized('ign', normalizedIgn, resolved);
    return resolved;
  }

  const profile = await lookupProfileByUsername(ign);
  if (!profile) {
    const nickedPayload = buildNickedPayload();
    await setCachedPayload(ignCacheKey, nickedPayload, CACHE_TTL_MS, { etag: 'nicked', lastModified: Date.now() });
    const resolved: ResolvedPlayer = {
      payload: nickedPayload,
      etag: 'nicked',
      lastModified: Date.now(),
      source: 'network',
      revalidated: false,
      uuid: null,
      username: normalizedIgn,
      lookupType: 'ign',
      lookupValue: normalizedIgn,
      nicked: true,
    };
    setMemoized('ign', normalizedIgn, resolved);
    return resolved;
  }

  const resolvedUuid = await fetchByUuid(profile.id);
  const resolved: ResolvedPlayer = {
    ...resolvedUuid,
    lookupType: 'ign',
    lookupValue: normalizedIgn,
    username: profile.name ?? normalizedIgn,
  };
  await setCachedPayload(ignCacheKey, resolved.payload, CACHE_TTL_MS, {
    etag: resolved.etag,
    lastModified: resolved.lastModified,
  });
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
      return pending;
    }
  }

  const conditional = normalizeConditionalHeaders(options);

  const executor = async (): Promise<ResolvedPlayer> => {
    if (uuidRegex.test(key)) {
      return fetchByUuid(key, conditional);
    }

    if (ignRegex.test(identifier)) {
      return fetchByIgn(identifier);
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
