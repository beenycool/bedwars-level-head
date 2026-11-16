import { Router } from 'express';
import {
  createRateLimitMiddleware,
  getClientIpAddress,
  TokenBucketLimiter,
} from '../middleware/rateLimit';
import { LOOKUP_LOG_RETENTION_DAYS } from '../config';
import { parseStatsQuery } from '../util/statsQuery';
import { loadLookupRowsForExport, loadStatsPage } from '../services/lookupStats';
import { renderLookupCsv, renderStatsPage, renderUnavailablePage } from '../views/statsPage';
import { logger } from '../util/logger';

/**
 * Public analytics page. It reads only cached, already-public Hypixel data, so it
 * needs no auth — just a page-load budget of its own so a browser refresh loop cannot
 * hammer PostgreSQL.
 */
const router = Router();

const statsRateLimiter = new TokenBucketLimiter({ capacity: 60, windowMs: 60_000 });
const enforceStatsRateLimit = createRateLimitMiddleware({
  limiter: statsRateLimiter,
  getBucketKey: (req) => `stats:${getClientIpAddress(req)}`,
  label: 'stats',
});

router.get('/export.csv', enforceStatsRateLimit, async (req, res, next) => {
  try {
    const query = parseStatsQuery(req.query as Record<string, unknown>);
    const rows = await loadLookupRowsForExport(query);

    if (!rows) {
      res.status(503).type('text/plain').send('Tracking database unavailable.');
      return;
    }

    const filename = `levelhead-lookups-${new Date().toISOString().slice(0, 10)}.csv`;
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('text/csv; charset=utf-8').send(renderLookupCsv(rows));
  } catch (error) {
    next(error);
  }
});

router.get('/', enforceStatsRateLimit, async (req, res, next) => {
  try {
    const query = parseStatsQuery(req.query as Record<string, unknown>);
    const data = await loadStatsPage(query);

    res.set('Cache-Control', 'no-store');
    if (!data) {
      res.status(503).type('html').send(
        renderUnavailablePage('No PostgreSQL connection is configured or reachable.'),
      );
      return;
    }

    res.type('html').send(
      renderStatsPage({ query, data, retentionDays: LOOKUP_LOG_RETENTION_DAYS }),
    );
  } catch (error) {
    logger.error({ err: error }, '[stats] failed to render the tracking page');
    res.status(503).type('html').send(
      renderUnavailablePage('The tracking database did not answer. Try again shortly.'),
    );
  }
});

export default router;
