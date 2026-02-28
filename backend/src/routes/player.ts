import { Router } from 'express';
import pLimit from 'p-limit';
import { enforceRateLimit, enforceBatchRateLimit, getClientIpAddress } from '../middleware/rateLimit';
import { resolvePlayer, ResolvedPlayer, warmupPlayerCache } from '../services/player';
import { computeBedwarsStar } from '../util/bedwars';
import { HttpError } from '../util/httpError';
import { extractBedwarsExperience, parseIfModifiedSince, recordQuerySafely } from '../util/requestUtils';
import { getCircuitBreakerState } from '../services/hypixel';
import { submissionService } from '../services/submissionService';

const batchLimit = pLimit(6);

const router = Router();

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

    // Add SWR stale headers if data is stale
    if (resolved.isStale) {
      res.set('X-Cache-Stale', '1');
      const ageSeconds = Math.floor((resolved.staleAgeMs ?? 0) / 1000);
      res.set('Age', ageSeconds.toString());
    }

    res.set('X-Cache', resolved.source === 'cache' ? 'HIT' : 'MISS');

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

    // Include stale flag in response if data is stale
    const circuitBreaker = getCircuitBreakerState();
    const isCircuitOpen = circuitBreaker.state === 'open';
    res.json({
      ...resolved.payload,
      ...(resolved.isStale ? { stale: true } : {}),
      ...(isCircuitOpen ? { degradedMode: true } : {}),
    });
  } catch (error) {
    next(error);
  }
});

const identifierPattern = /^(?:[0-9a-f]{32}|[a-zA-Z0-9_]{1,16})$/;

router.post('/batch', enforceBatchRateLimit, async (req, res, next) => {
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
    // Warmup cache for all UUIDs in parallel (single Redis round-trip)
    await warmupPlayerCache(uniqueUuids);

    const results = await Promise.all(
      uniqueUuids.map((identifier) => batchLimit(async () => {
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
              ...(resolved.isStale ? { stale: true } : {}),
            },
            source: resolved.source,
          };
        } catch (error) {
          if (error instanceof HttpError) {
            if (error.status >= 500) {
              throw error;
            }
            return null;
          }
          throw error;
        }
      })),
    );

    const payloadMap: Record<string, ResolvedPlayer['payload']> = {};
    let cacheHits = 0;
    let total = 0;
    results.forEach((result) => {
      if (result) {
        payloadMap[result.identifier] = result.payload;
        total++;
        if ((result as any).source === 'cache') {
          cacheHits++;
        }
      }
    });

    if (total > 0) {
      res.set('X-Cache', cacheHits === total ? 'HIT' : cacheHits > 0 ? 'PARTIAL' : 'MISS');
    }

    const circuitBreaker = getCircuitBreakerState();
    const isCircuitOpen = circuitBreaker.state === 'open';

    res.json({ success: true, data: payloadMap, ...(isCircuitOpen ? { degradedMode: true } : {}) });
  } catch (error) {
    next(error);
  }
});

const uuidOnlyPattern = /^[0-9a-f]{32}$/i;

// Re-export specific logic for testing if needed
export const _test = {
    // verifyHypixelOrigin is now in submissionService, no longer directly testable here
    // unless we expose it from submissionService or change tests to import it from there
};

router.post('/submit', enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/player/submit';
  const body = req.body as { uuid?: unknown; data?: unknown; signature?: unknown } | undefined;

  // Validate request body structure
  if (!body || typeof body !== 'object') {
    next(new HttpError(400, 'BAD_REQUEST', 'Expected JSON body with uuid and data fields.'));
    return;
  }

  const { uuid, data, signature: rawSignature } = body;

  // Validate UUID format
  if (typeof uuid !== 'string' || !uuidOnlyPattern.test(uuid.trim())) {
    next(new HttpError(400, 'INVALID_UUID', 'uuid must be a 32-character hex string (no dashes).'));
    return;
  }

  // Validate data is present and is an object
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    next(new HttpError(400, 'INVALID_DATA', 'data must be a non-null, non-array object.'));
    return;
  }

  const signature = typeof rawSignature === 'string' && rawSignature.trim().length > 0 ? rawSignature.trim() : undefined;
  const ipAddress = getClientIpAddress(req);

  try {
    const result = await submissionService.processSubmission(uuid, data, signature, ipAddress);

    if (!result.success) {
        // Map service error to HttpError
        // If statusCode is 409, use REPLAY_DETECTED, else generic error codes or default
        const statusCode = result.statusCode || 403;
        const errorCode = statusCode === 409 ? 'REPLAY_DETECTED' :
                          statusCode === 422 ? 'VALIDATION_FAILED' :
                          statusCode === 503 ? 'SERVICE_UNAVAILABLE' :
                          'INVALID_ORIGIN';

        next(new HttpError(statusCode, errorCode, result.error || 'Submission failed'));
        return;
    }

    res.status(result.statusCode || 202).json({ success: true, message: result.message || 'Contribution accepted.' });

  } catch (error) {
    next(error);
  }
});

export default router;
