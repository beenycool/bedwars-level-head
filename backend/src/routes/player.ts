import { Router } from 'express';
import { requireModHandshake } from '../middleware/auth';
import { enforceRateLimit } from '../middleware/rateLimit';
import { resolvePlayer, ResolvedPlayer } from '../services/player';
import { recordPlayerQuery } from '../services/history';
import { computeBedwarsStar } from '../util/bedwars';

function parseIfModifiedSince(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const router = Router();

function extractBedwarsExperience(payload: ResolvedPlayer['payload']): number | null {
  const bedwars = payload.data?.bedwars ?? payload.bedwars;
  if (!bedwars || typeof bedwars !== 'object') {
    return null;
  }

  const record = bedwars as Record<string, unknown>;
  const rawValue = record.bedwars_experience ?? record.Experience ?? record.experience;
  if (rawValue === undefined || rawValue === null) {
    return null;
  }

  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return numeric;
}

router.get('/:identifier', requireModHandshake, enforceRateLimit, async (req, res, next) => {
  const { identifier } = req.params;
  const ifNoneMatch = req.header('if-none-match')?.trim();
  const ifModifiedSince = parseIfModifiedSince(req.header('if-modified-since'));
  res.locals.metricsRoute = '/api/player/:identifier';

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

    await recordPlayerQuery({
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
      installId: req.installId ?? null,
      responseStatus,
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
