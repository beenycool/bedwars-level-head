import { CACHE_TTL_MS } from '../config';
import { HttpError } from '../util/httpError';
import { getCachedPayload, setCachedPayload } from './cache';
import { fetchHypixelPlayer, ProxyPlayerPayload } from './hypixel';
import { lookupProfileByUsername } from './mojang';

const uuidRegex = /^[0-9a-f]{32}$/i;
const ignRegex = /^[a-zA-Z0-9_]{1,16}$/;

function buildCacheKey(prefix: string, value: string): string {
  return `${prefix}:${value}`;
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

async function fetchByUuid(uuid: string): Promise<ProxyPlayerPayload> {
  const normalizedUuid = uuid.toLowerCase();
  const cacheKey = buildCacheKey('player', normalizedUuid);

  const cached = await getCachedPayload<ProxyPlayerPayload>(cacheKey);
  if (cached) {
    return cached;
  }

  const payload = await fetchHypixelPlayer(normalizedUuid);
  await setCachedPayload(cacheKey, payload, CACHE_TTL_MS);
  return payload;
}

async function fetchByIgn(ign: string): Promise<ProxyPlayerPayload> {
  const normalizedIgn = ign.toLowerCase();
  const ignCacheKey = buildCacheKey('ign', normalizedIgn);

  const cached = await getCachedPayload<ProxyPlayerPayload>(ignCacheKey);
  if (cached) {
    return cached;
  }

  const profile = await lookupProfileByUsername(ign);
  if (!profile) {
    const nickedPayload = buildNickedPayload();
    await setCachedPayload(ignCacheKey, nickedPayload, CACHE_TTL_MS);
    return nickedPayload;
  }

  const payload = await fetchByUuid(profile.id);
  await setCachedPayload(ignCacheKey, payload, CACHE_TTL_MS);
  return payload;
}

export async function resolvePlayer(identifier: string): Promise<ProxyPlayerPayload> {
  if (uuidRegex.test(identifier)) {
    return fetchByUuid(identifier);
  }

  if (ignRegex.test(identifier)) {
    return fetchByIgn(identifier);
  }

  throw new HttpError(
    400,
    'INVALID_IDENTIFIER',
    'Identifier must be a valid UUID (no dashes) or Minecraft username.',
  );
}
