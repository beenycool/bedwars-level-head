import { Router } from 'express';
import { enforceAdminRateLimit } from '../middleware/rateLimit';
import { enforceAdminAuth } from '../middleware/adminAuth';
import { clearInMemoryPlayerCache, evictPlayerFromMemory } from '../services/player';
import { HttpError } from '../util/httpError';
import { IDENTIFIER_MAX_LENGTH, normalizeUuid } from '../util/validationConstants';
import { buildPlayerCacheKey, clearAllPlayerStatsCaches, deletePlayerStatsEntries } from '../services/statsCache';

const router = Router();

router.post('/cache/purge', enforceAdminRateLimit, enforceAdminAuth, async (req, res, next) => {
  const { identifier } = req.body ?? {};

  try {
    let purged = 0;

    if (identifier == null) {
      purged = await clearAllPlayerStatsCaches();
      clearInMemoryPlayerCache();
    } else {
      if (typeof identifier !== 'string' || identifier.length > IDENTIFIER_MAX_LENGTH) {
        throw new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a UUID.');
      }
      const uuid = normalizeUuid(identifier.trim());
      if (!uuid) {
        throw new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a UUID.');
      }
      const cacheKey = buildPlayerCacheKey(uuid);
      purged = await deletePlayerStatsEntries([cacheKey]);
      evictPlayerFromMemory(cacheKey);
    }

    res.status(202).json({ success: true, purged });
  } catch (error) {
    next(error);
  }
});

export default router;
