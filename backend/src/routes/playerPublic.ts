import { Router } from 'express';
import { enforcePublicRateLimit } from '../middleware/rateLimitPublic';
import { resolvePlayer } from '../services/player';
import { computeBedwarsStar } from '../util/bedwars';

import { extractBedwarsExperience, parseIfModifiedSince, recordQuerySafely } from '../util/requestUtils';

const router = Router();





router.get('/:identifier', enforcePublicRateLimit, async (req, res, next) => {
  const { identifier } = req.params;
  const ifNoneMatch = req.header('if-none-match')?.trim();
  const ifModifiedSince = parseIfModifiedSince(req.header('if-modified-since'));
  res.locals.metricsRoute = '/api/public/player/:identifier';
  const startedAt = process.hrtime.bigint();

  try {
    const resolved = await resolvePlayer(identifier, {
      etag: ifNoneMatch,
      lastModified: ifModifiedSince,
    });

    const experience = extractBedwarsExperience(resolved.payload);
    const computedStars = experience === null ? null : computeBedwarsStar(experience);
    if (resolved.etag) {
      res.set('ETag', resolved.etag);
    }

    if (resolved.lastModified) {
      res.set('Last-Modified', new Date(resolved.lastModified).toUTCString());
    }

    res.statusCode = 200;
    const notModified = req.fresh;
    const responseStatus = notModified ? 304 : 200;

    void recordQuerySafely({
      identifier,
      normalizedIdentifier: resolved.lookupValue,
      lookupType: resolved.lookupType,
      resolvedUuid: resolved.uuid,
      resolvedUsername: resolved.username,
      stars: computedStars,
      nicked: resolved.nicked,
      cacheSource: resolved.source,
      cacheHit: resolved.source === 'cache',
      revalidated: resolved.revalidated,
      installId: null,
      responseStatus,
      latencyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    });

    if (notModified) {
      res.status(304).end();
      return;
    }

    res.json(resolved.payload);
  } catch (error) {
    next(error);
  }
});

export default router;
