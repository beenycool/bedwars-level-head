import { Router } from 'express';
import pLimit from 'p-limit';
import { enforcePublicRateLimit, enforcePublicBatchRateLimit } from '../middleware/rateLimitPublic';
import { resolvePlayer, ResolvedPlayer, warmupPlayerCache } from '../services/player';
import { computeBedwarsStar } from '../util/bedwars';
import { HttpError } from '../util/httpError';
import { extractBedwarsExperience, parseIfModifiedSince, recordQuerySafely } from '../util/requestUtils';
import { getCircuitBreakerState } from '../services/hypixel';
import { IDENTIFIER_MAX_LENGTH, MAX_BATCH_SIZE, IDENTIFIER_PATTERN } from '../util/validationConstants';

const batchLimit = pLimit(6);

const router = Router();

function computeResponseEtag(baseEtag: string | null, nicked: boolean): string | null {
  if (!baseEtag) return null;
  return `"player-v2-${nicked ? 'nicked' : 'valid'}-${baseEtag.replace(/^"|"$/g, '')}"`;
}





router.get('/:identifier', enforcePublicRateLimit, async (req, res, next) => {
  const { identifier } = req.params;

  if (!IDENTIFIER_PATTERN.test(identifier)) {
    next(new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a valid Minecraft username (<=16 chars) or undashed UUID.'));
    return;
  }

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
    const responseEtag = computeResponseEtag(resolved.etag, resolved.nicked);
    if (responseEtag) {
      res.set('ETag', responseEtag);
    }

    if (resolved.lastModified) {
      res.set('Last-Modified', new Date(resolved.lastModified).toUTCString());
    }

    res.set('X-Cache', resolved.source === 'cache' ? 'HIT' : 'MISS');
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

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

    res.json({
      ...resolved.payload,
      nicked: resolved.nicked,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/batch', enforcePublicBatchRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/public/player/batch';
  const uuidsValue = (req.body as { uuids?: unknown })?.uuids;

  if (!Array.isArray(uuidsValue)) {
    next(new HttpError(400, 'BAD_REQUEST', 'Expected body.uuids to be an array.'));
    return;
  }

  if (uuidsValue.length > MAX_BATCH_SIZE) {
    next(new HttpError(400, 'BAD_REQUEST', `Provide up to ${MAX_BATCH_SIZE} UUIDs per batch request.`));
    return;
  }

  // ⚡ Bolt: Replace Array.from(), and filter() with a single pass to avoid multiple O(N) allocations
  const uniqueUuids: string[] = [];
  const seenUuids = new Set<string>();

  for (let i = 0; i < uuidsValue.length; i++) {
    const value = uuidsValue[i];
    if (typeof value === 'string' && value.length <= IDENTIFIER_MAX_LENGTH) {
      const trimmed = value.trim();
      if (trimmed.length > 0 && !seenUuids.has(trimmed)) {
        seenUuids.add(trimmed);
        uniqueUuids.push(trimmed);
      }
    }
  }

  if (uniqueUuids.length === 0) {
    res.json({ success: true, data: {} });
    return;
  }

  const invalidIdentifiers = uniqueUuids.filter((identifier) => !IDENTIFIER_PATTERN.test(identifier));
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
    await warmupPlayerCache(uniqueUuids);

    const limitPromises: Promise<{ identifier: string; payload: ResolvedPlayer['payload'] & { nicked: boolean; stale?: true }; source: ResolvedPlayer['source'] } | null>[] = [];
    for (let i = 0; i < uniqueUuids.length; i++) {
      const identifier = uniqueUuids[i];
      limitPromises.push(batchLimit(async () => {

        try {
          const startedAt = process.hrtime.bigint();
          const resolved = await resolvePlayer(identifier);
          const experience = extractBedwarsExperience(resolved.payload);
          const stars = experience === null ? null : computeBedwarsStar(experience);

          void recordQuerySafely({
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
            latencyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
          });

          return {
            identifier,
            payload: {
              ...resolved.payload,
              nicked: resolved.nicked,
              ...(resolved.isStale ? { stale: true } : {}),
            },
            source: resolved.source,
          } as { identifier: string; payload: ResolvedPlayer['payload'] & { nicked: boolean; stale?: true }; source: ResolvedPlayer['source'] };
        } catch (error) {
          if (error instanceof HttpError) {
            if (error.status >= 500) {
              throw error;
            }
            return null;
          }
          throw error;
        }
      }));
    }
    const results = await Promise.all(limitPromises);

    const payloadMap: Record<string, ResolvedPlayer['payload'] & { nicked: boolean; stale?: true }> = {};
    let cacheHits = 0;
    let total = 0;

    // Indexed for loop avoids iterator/closure overhead in this hot batch path
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result) {
        payloadMap[result.identifier] = result.payload;
        total++;
        if (result.source === 'cache') {
          cacheHits++;
        }
      }
    }

    if (total > 0) {
      res.set('X-Cache', cacheHits === total ? 'HIT' : cacheHits > 0 ? 'PARTIAL' : 'MISS');
    }

    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

    const circuitBreaker = getCircuitBreakerState();
    const isCircuitOpen = circuitBreaker.state === 'open';

    res.json({ success: true, data: payloadMap, ...(isCircuitOpen ? { degradedMode: true } : {}) });
  } catch (error) {
    next(error);
  }
});

export default router;
