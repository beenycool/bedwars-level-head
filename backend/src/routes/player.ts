import { Router } from 'express';
import { enforceRateLimit } from '../middleware/rateLimit';
import { resolvePlayer, ResolvedPlayer } from '../services/player';
import { recordPlayerQuery } from '../services/history';
import { computeBedwarsStar } from '../util/bedwars';
import { HttpError } from '../util/httpError';

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
    console.error('Failed to record player query', {
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

router.get('/:identifier', enforceRateLimit, async (req, res, next) => {
  const { identifier } = req.params;
  const ifNoneMatch = req.header('if-none-match')?.trim();
  const ifModifiedSince = parseIfModifiedSince(req.header('if-modified-since'));
  res.locals.metricsRoute = '/api/player/:identifier';
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

const identifierPattern = /^(?:[0-9a-f]{32}|[a-zA-Z0-9_]{1,16})$/;

router.post('/batch', enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/player/batch';
  const uuidsValue = (req.body as { uuids?: unknown })?.uuids;

  if (!Array.isArray(uuidsValue)) {
    next(new HttpError(400, 'BAD_REQUEST', 'Expected body.uuids to be an array.'));
    return;
  }

  const normalizedInput = uuidsValue
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);

  const uniqueUuids = Array.from(new Set(normalizedInput));
  if (uniqueUuids.length === 0) {
    res.json({ success: true, data: {} });
    return;
  }

  if (uniqueUuids.length > 20) {
    next(new HttpError(400, 'BAD_REQUEST', 'Provide up to 20 UUIDs per batch request.'));
    return;
  }

  const invalidIdentifiers = uniqueUuids.filter((identifier) => !identifierPattern.test(identifier));
  if (invalidIdentifiers.length > 0) {
    next(
      new HttpError(
        400,
        'INVALID_IDENTIFIER',
        'All identifiers must be valid Minecraft usernames (<=16 chars) or undashed UUIDs.',
      ),
    );
    return;
  }

  try {
    const results = await Promise.all(
      uniqueUuids.map(async (identifier) => {
        try {
          const startedAt = process.hrtime.bigint();
          const resolved = await resolvePlayer(identifier);
          const experience = extractBedwarsExperience(resolved.payload);
          const stars = experience === null ? null : computeBedwarsStar(experience);

          await recordQuerySafely({
            identifier,
            normalizedIdentifier: resolved.lookupValue,
            lookupType: resolved.lookupType,
            resolvedUuid: resolved.uuid,
            resolvedUsername: resolved.username,
            stars,
            nicked: resolved.nicked,
            cacheSource: resolved.source,
            cacheHit: resolved.source === 'cache',
            revalidated: resolved.revalidated,
            installId: null,
            responseStatus: 200,
            latencyMs: Number((process.hrtime.bigint() - startedAt) / BigInt(1_000_000)),
          });

          return { identifier, payload: resolved.payload };
        } catch (error) {
          if (error instanceof HttpError) {
            if (error.status >= 500) {
              throw error;
            }
            return null;
          }
          throw error;
        }
      }),
    );

    const payloadMap: Record<string, ResolvedPlayer['payload']> = {};
    results.forEach((result) => {
      if (result) {
        payloadMap[result.identifier] = result.payload;
      }
    });

    res.json({ success: true, data: payloadMap });
  } catch (error) {
    next(error);
  }
});

export default router;
