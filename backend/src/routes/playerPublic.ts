import { Router } from 'express';
import { enforcePublicRateLimit, enforcePublicBatchRateLimit } from '../middleware/rateLimitPublic';
import { MAX_BATCH_SIZE } from '../util/validationConstants';
import { createPlayerBatchHandler, createPlayerLookupHandler } from './playerHandlers';

const router = Router();

router.get('/:identifier', enforcePublicRateLimit, createPlayerLookupHandler({
  private: false,
  setStaleHeaders: false,
  cacheControl: 'public, max-age=300, stale-while-revalidate=600',
}));

router.post('/batch', enforcePublicBatchRateLimit, createPlayerBatchHandler({
  batchSize: MAX_BATCH_SIZE,
  cacheControl: 'public, max-age=300, stale-while-revalidate=600',
}));

export default router;
