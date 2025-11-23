import { Router } from 'express';
import { enforceRateLimit } from '../middleware/rateLimit';
import { enforceAdminAuth } from '../middleware/adminAuth';
import { clearAllCacheEntries, deleteCacheEntries, getCacheEntry } from '../services/cache';
import { clearInMemoryPlayerCache } from '../services/player';
import { HttpError } from '../util/httpError';
import { ProxyPlayerPayload } from '../services/hypixel';

const router = Router();

const uuidRegex = /^[0-9a-f]{32}$/i;
const ignRegex = /^[a-z0-9_]{1,16}$/i;

function extractUuidFromPayload(payload: ProxyPlayerPayload | null | undefined): string | null {
  const payloadPlayer =
    payload && typeof payload === 'object' && 'player' in payload
      ? (payload as { player?: unknown }).player
      : undefined;
  const payloadUuidCandidate =
    payloadPlayer && typeof payloadPlayer === 'object' && payloadPlayer !== null && 'uuid' in payloadPlayer
      ? (payloadPlayer as { uuid?: unknown }).uuid
      : undefined;
  const payloadUuidRaw = typeof payloadUuidCandidate === 'string' ? payloadUuidCandidate : null;
  return payloadUuidRaw ? payloadUuidRaw.replace(/-/g, '').toLowerCase() : null;
}

function extractIgnFromPayload(payload: ProxyPlayerPayload | null | undefined): string | null {
  const display = payload?.display;
  if (typeof display === 'string' && display.trim().length > 0) {
    return display.trim();
  }

  const playerRecord =
    payload && typeof payload === 'object' && 'player' in payload
      ? (payload as { player?: unknown }).player
      : undefined;
  const playerDisplayName =
    playerRecord && typeof playerRecord === 'object' && playerRecord !== null && 'displayname' in playerRecord
      ? (playerRecord as { displayname?: unknown }).displayname
      : undefined;
  if (typeof playerDisplayName === 'string' && playerDisplayName.trim().length > 0) {
    return playerDisplayName.trim();
  }

  return null;
}

async function cacheKeysForIdentifier(identifier: string): Promise<string[]> {
  const normalized = identifier.toLowerCase();
  if (uuidRegex.test(normalized)) {
    const keys = [`player:${normalized}`];
    const playerEntry = await getCacheEntry<ProxyPlayerPayload>(keys[0], true);
    const ign = extractIgnFromPayload(playerEntry?.value);
    if (ign) {
      keys.push(`ign:${ign.toLowerCase()}`);
    }
    return keys;
  }

  if (ignRegex.test(normalized)) {
    const ignKey = `ign:${normalized}`;
    const keys = [ignKey];
    const ignEntry = await getCacheEntry<ProxyPlayerPayload>(ignKey, true);
    const uuid = extractUuidFromPayload(ignEntry?.value);
    if (uuid) {
      keys.push(`player:${uuid}`);
    }
    return keys;
  }

  return [];
}

router.post('/cache/purge', enforceAdminAuth, enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/cache/purge';
  const { identifier } = req.body ?? {};

  try {
    let purged = 0;
    if (typeof identifier === 'string' && identifier.trim().length > 0) {
      const keys = await cacheKeysForIdentifier(identifier.trim());
      if (keys.length === 0) {
        throw new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a UUID (without dashes) or an IGN.');
      }
      purged = await deleteCacheEntries(keys);
    } else {
      purged = await clearAllCacheEntries();
    }

    clearInMemoryPlayerCache();

    res.status(202).json({ success: true, purged });
  } catch (error) {
    next(error);
  }
});

export default router;
