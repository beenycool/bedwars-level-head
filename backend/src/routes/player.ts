import { Router } from 'express';
import { enforceBatchRateLimit, enforceRateLimit } from '../middleware/rateLimit';
import { MAX_BATCH_SIZE } from '../util/validationConstants';
import { createPlayerBatchHandler, createPlayerLookupHandler } from './playerHandlers';

/**
 * Legacy `/api/player` surface kept for older clients that send a Bearer token.
 *
 * The API-key machinery is gone: this router shares the public per-IP token bucket,
 * so it exposes exactly the same data and the same budget as `/api/public/player`.
 * Extra response hints (`degradedMode`) are preserved for compatibility.
 */
const router = Router();

router.get('/:identifier', enforceRateLimit, createPlayerLookupHandler({
  private: true,
  setStaleHeaders: true,
  cacheControl: 'public, max-age=300, stale-while-revalidate=600',
}));

router.post('/batch', enforceBatchRateLimit, createPlayerBatchHandler({
  batchSize: MAX_BATCH_SIZE,
}));

export default router;
