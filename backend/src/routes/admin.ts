import { Router } from 'express';
import { enforceAdminRateLimit } from '../middleware/rateLimit';
import { enforceAdminAuth } from '../middleware/adminAuth';
import { clearInMemoryPlayerCache } from '../services/player';
import { HttpError } from '../util/httpError';
import { IDENTIFIER_MAX_LENGTH } from '../util/validationConstants';
import {
  buildPlayerCacheKey,
  clearAllPlayerStatsCaches,
  deleteIgnMappings,
  deletePlayerStatsEntries,
  getIgnMapping,
  getPlayerStatsFromCache,
} from '../services/statsCache';

const router = Router();

const uuidRegex = /^[0-9a-f]{32}$/i;
const ignRegex = /^[a-z0-9_]{1,16}$/i;

async function cacheKeysForIdentifier(identifier: string): Promise<{ playerKeys: string[]; igns: string[] }> {
  const normalized = identifier.toLowerCase();
  if (uuidRegex.test(normalized)) {
    const playerKey = buildPlayerCacheKey(normalized);
    const playerEntry = await getPlayerStatsFromCache(playerKey, true);
    const ign = playerEntry?.value?.displayname?.trim();
    return {
      playerKeys: [playerKey],
      igns: ign ? [ign.toLowerCase()] : [],
    };
  }

  if (ignRegex.test(normalized)) {
    const mapping = await getIgnMapping(normalized, true);
    const playerKeys = mapping?.uuid ? [buildPlayerCacheKey(mapping.uuid)] : [];
    return {
      playerKeys,
      igns: [normalized],
    };
  }

  return { playerKeys: [], igns: [] };
}

router.post('/cache/purge', enforceAdminRateLimit, enforceAdminAuth, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/cache/purge';
  const { identifier } = req.body ?? {};

  try {
    let purged = 0;
    if (typeof identifier === 'string') {
      if (identifier.length > IDENTIFIER_MAX_LENGTH) {
        throw new HttpError(400, 'INVALID_IDENTIFIER', `Identifier must be ${IDENTIFIER_MAX_LENGTH} characters or less.`);
      }
      const trimmed = identifier.trim();
      if (trimmed.length > 0) {
        const keys = await cacheKeysForIdentifier(trimmed);
        if (keys.playerKeys.length === 0 && keys.igns.length === 0) {
          throw new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a UUID (without dashes) or an IGN.');
        }
        if (keys.playerKeys.length > 0) {
          purged += await deletePlayerStatsEntries(keys.playerKeys);
        }
        if (keys.igns.length > 0) {
          purged += await deleteIgnMappings(keys.igns);
        }
      } else {
        purged = await clearAllPlayerStatsCaches();
      }
    } else {
      purged = await clearAllPlayerStatsCaches();
    }

    clearInMemoryPlayerCache();

    res.status(202).json({ success: true, purged });
  } catch (error) {
    next(error);
  }
});

export default router;
