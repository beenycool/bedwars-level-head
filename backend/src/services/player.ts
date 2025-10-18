import { CACHE_TTL_MS } from '../config';
import { HttpError } from '../util/httpError';
import { getCachedPayload, setCachedPayload } from './cache';
import {
  fetchHypixelPlayer,
  HypixelFetchOptions,
  HypixelPlayerFetchResult,
  ProxyPlayerPayload,
} from './hypixel';
import { lookupProfileByUsername } from './mojang';
import { recordCacheHit, recordCacheMiss } from './metrics';

const uuidRegex = /^[0-9a-f]{32}$/i;
const ignRegex = /^[a-zA-Z0-9_]{1,16}$/;

const PLAYER_UUID_CACHE_LABEL = 'player_uuid';
const PLAYER_IGN_CACHE_LABEL = 'player_ign';

interface CachedPlayerEntry {
  value: ProxyPlayerPayload;
  etag?: string;
  lastModified?: string;
}

interface ResolvedPlayer {
  payload: ProxyPlayerPayload;
  etag?: string;
  lastModified?: string;
}

interface MemoizedEntry {
  expiresAt: number;
  resolved: ResolvedPlayer;
}

const memoizedPlayers = new Map<string, MemoizedEntry>();

function normalizeCacheEntry(
  entry: CachedPlayerEntry | ProxyPlayerPayload | null,
): CachedPlayerEntry | null {
  if (!entry) {
    return null;
  }

  if (typeof entry === 'object' && entry !== null && 'value' in entry) {
    const candidate = entry as CachedPlayerEntry;
    if (candidate.value) {
      return candidate;
    }

    return null;
  }

  return {
    value: entry as ProxyPlayerPayload,
  };
}

function buildCacheKey(prefix: string, value: string): string {
  return `${prefix}:${value}`;
}

function getMemoized(uuid: string): ResolvedPlayer | null {
  const entry = memoizedPlayers.get(uuid);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    memoizedPlayers.delete(uuid);
    return null;
  }

  return entry.resolved;
}

function setMemoized(uuid: string, resolved: ResolvedPlayer): void {
  memoizedPlayers.set(uuid, {
    resolved,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
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

async function fetchByUuid(uuid: string): Promise<ResolvedPlayer> {
  const normalizedUuid = uuid.toLowerCase();
  const memoized = getMemoized(normalizedUuid);
  if (memoized) {
    return memoized;
  }

  const cacheKey = buildCacheKey('player', normalizedUuid);
  const rawCacheEntry = await getCachedPayload<CachedPlayerEntry | ProxyPlayerPayload>(cacheKey);
  const cacheEntry = normalizeCacheEntry(rawCacheEntry);
  const validators: HypixelFetchOptions = {};

  if (cacheEntry) {
    recordCacheHit(PLAYER_UUID_CACHE_LABEL);
    if (cacheEntry.etag) {
      validators.etag = cacheEntry.etag;
    }

    if (cacheEntry.lastModified) {
      validators.lastModified = cacheEntry.lastModified;
    }
  } else {
    recordCacheMiss(PLAYER_UUID_CACHE_LABEL);
  }

  let response: HypixelPlayerFetchResult = await fetchHypixelPlayer(normalizedUuid, validators);

  if (response.notModified) {
    if (!cacheEntry) {
      response = await fetchHypixelPlayer(normalizedUuid);
    } else {
      const resolved: ResolvedPlayer = {
        payload: cacheEntry.value,
        etag: response.etag ?? cacheEntry.etag,
        lastModified: response.lastModified ?? cacheEntry.lastModified,
      };
      await setCachedPayload(cacheKey, {
        value: resolved.payload,
        etag: resolved.etag,
        lastModified: resolved.lastModified,
      }, CACHE_TTL_MS);
      setMemoized(normalizedUuid, resolved);
      return resolved;
    }
  }

  if (!response.payload) {
    throw new HttpError(502, 'HYPIXEL_EMPTY_PAYLOAD', 'Hypixel returned an empty player payload.');
  }

  const resolved: ResolvedPlayer = {
    payload: response.payload,
    etag: response.etag,
    lastModified: response.lastModified,
  };

  await setCachedPayload(cacheKey, {
    value: resolved.payload,
    etag: resolved.etag,
    lastModified: resolved.lastModified,
  }, CACHE_TTL_MS);
  setMemoized(normalizedUuid, resolved);
  return resolved;
}

async function fetchByIgn(ign: string): Promise<ResolvedPlayer> {
  const normalizedIgn = ign.toLowerCase();
  const ignCacheKey = buildCacheKey('ign', normalizedIgn);

  const rawCacheEntry = await getCachedPayload<CachedPlayerEntry | ProxyPlayerPayload>(ignCacheKey);
  const cacheEntry = normalizeCacheEntry(rawCacheEntry);
  if (cacheEntry) {
    recordCacheHit(PLAYER_IGN_CACHE_LABEL);
    return {
      payload: cacheEntry.value,
      etag: cacheEntry.etag,
      lastModified: cacheEntry.lastModified,
    };
  }

  recordCacheMiss(PLAYER_IGN_CACHE_LABEL);

  const profile = await lookupProfileByUsername(ign);
  if (!profile) {
    const nickedPayload = buildNickedPayload();
    const resolved: ResolvedPlayer = { payload: nickedPayload };
    await setCachedPayload(
      ignCacheKey,
      {
        value: resolved.payload,
      },
      CACHE_TTL_MS,
    );
    return resolved;
  }

  const resolvedPlayer = await fetchByUuid(profile.id);
  await setCachedPayload(
    ignCacheKey,
    {
      value: resolvedPlayer.payload,
      etag: resolvedPlayer.etag,
      lastModified: resolvedPlayer.lastModified,
    },
    CACHE_TTL_MS,
  );
  return resolvedPlayer;
}

export async function resolvePlayer(identifier: string): Promise<ProxyPlayerPayload> {
  if (uuidRegex.test(identifier)) {
    const resolved = await fetchByUuid(identifier);
    return resolved.payload;
  }

  if (ignRegex.test(identifier)) {
    const resolved = await fetchByIgn(identifier);
    return resolved.payload;
  }

  throw new HttpError(
    400,
    'INVALID_IDENTIFIER',
    'Identifier must be a valid UUID (no dashes) or Minecraft username.',
  );
}
