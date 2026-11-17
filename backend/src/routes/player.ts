import { Router } from 'express';
import { enforceBatchRateLimit, enforceRateLimit, enforceRequestRateLimit } from '../middleware/rateLimit';
import { MAX_BATCH_SIZE } from '../util/validationConstants';
import { createPlayerBatchHandler, createPlayerLookupHandler } from './playerHandlers';

const router = Router();

router.get('/:identifier', enforceRequestRateLimit, enforceRateLimit, createPlayerLookupHandler({
  private: true,
  cacheControl: 'public, max-age=300, stale-while-revalidate=600',
  route: 'legacy',
}));

router.post('/batch', enforceRequestRateLimit, enforceBatchRateLimit, createPlayerBatchHandler({
  batchSize: MAX_BATCH_SIZE,
}));

export default router;
