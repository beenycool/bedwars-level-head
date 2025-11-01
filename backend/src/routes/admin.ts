import { Router } from 'express';
import { enforceRateLimit } from '../middleware/rateLimit';
import { enforceAdminAuth } from '../middleware/adminAuth';
import { clearAllCacheEntries, deleteCacheEntries } from '../services/cache';
import { clearInMemoryPlayerCache } from '../services/player';
import { HttpError } from '../util/httpError';

const router = Router();

const uuidRegex = /^[0-9a-f]{32}$/i;
const ignRegex = /^[a-z0-9_]{1,16}$/i;

function cacheKeysForIdentifier(identifier: string): string[] {
  const normalized = identifier.toLowerCase();
  if (uuidRegex.test(normalized)) {
    return [`player:${normalized}`];
  }

  if (ignRegex.test(normalized)) {
    return [`ign:${normalized}`];
  }

  return [];
}

router.post('/cache/purge', enforceAdminAuth, enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/cache/purge';
  const { identifier } = req.body ?? {};

  try {
    let purged = 0;
    if (typeof identifier === 'string' && identifier.trim().length > 0) {
      const keys = cacheKeysForIdentifier(identifier.trim());
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
