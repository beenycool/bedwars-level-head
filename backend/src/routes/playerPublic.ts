import { Router } from 'express';
import { enforcePublicRateLimit } from '../middleware/rateLimitPublic';
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

async function recordQuerySafely(payload: Parameters<typeof recordPlayerQuery>[0]): Promise<void> {
  try {
    await recordPlayerQuery(payload);
  } catch (error) {
    console.error('Failed to record public player query', {
      error,
      identifier: payload.identifier,
      lookupType: payload.lookupType,
      responseStatus: payload.responseStatus,
    });
  }
}

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

    await recordQuerySafely({
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
      latencyMs: Number((process.hrtime.bigint() - startedAt) / BigInt(1_000_000)),
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
