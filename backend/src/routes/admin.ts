import { Router } from 'express';
import { enforceAdminRateLimit } from '../middleware/rateLimit';
import { enforceAdminAuth } from '../middleware/adminAuth';
import { clearInMemoryPlayerCache } from '../services/player';
import { HttpError } from '../util/httpError';
import { IDENTIFIER_MAX_LENGTH, isUuid, normalizeIdentifier } from '../util/validationConstants';
import { buildPlayerCacheKey, clearAllPlayerStatsCaches, deletePlayerStatsEntries } from '../services/statsCache';

/**
 * Single operator endpoint, called by hand:
 *   curl -X POST $URL/api/admin/cache/purge -H "Authorization: Bearer $TOKEN" \
 *        -H 'content-type: application/json' -d '{"identifier":"<undashed uuid>"}'
 * Omit `identifier` to clear every cached row.
 */
const router = Router();

router.post('/cache/purge', enforceAdminRateLimit, enforceAdminAuth, async (req, res, next) => {
  const { identifier } = req.body ?? {};

  try {
    let purged = 0;

    if (identifier == null) {
      purged = await clearAllPlayerStatsCaches();
    } else {
      if (typeof identifier !== 'string' || identifier.length > IDENTIFIER_MAX_LENGTH) {
        throw new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be an undashed UUID.');
      }
      const uuid = normalizeIdentifier(identifier.trim());
      if (!isUuid(uuid)) {
        throw new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be an undashed UUID.');
      }
      purged = await deletePlayerStatsEntries([buildPlayerCacheKey(uuid)]);
    }

    clearInMemoryPlayerCache();
    res.status(202).json({ success: true, purged });
  } catch (error) {
    next(error);
  }
});

export default router;
