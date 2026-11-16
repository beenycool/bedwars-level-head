import { Router } from 'express';
import { enforceRequestRateLimit } from '../middleware/rateLimit';
import { enforcePublicRateLimit, enforcePublicBatchRateLimit } from '../middleware/rateLimitPublic';
import { MAX_BATCH_SIZE } from '../util/validationConstants';
import { createPlayerBatchHandler, createPlayerLookupHandler } from './playerHandlers';

const router = Router();

router.get('/:identifier', enforceRequestRateLimit, enforcePublicRateLimit, createPlayerLookupHandler({
  private: false,
  setStaleHeaders: false,
  cacheControl: 'public, max-age=300, stale-while-revalidate=600',
  route: 'public',
}));

router.post('/batch', enforceRequestRateLimit, enforcePublicBatchRateLimit, createPlayerBatchHandler({
  batchSize: MAX_BATCH_SIZE,
  cacheControl: 'public, max-age=300, stale-while-revalidate=600',
}));

export default router;
