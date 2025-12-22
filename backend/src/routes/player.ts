import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { enforceRateLimit, enforceBatchRateLimit } from '../middleware/rateLimit';
import { resolvePlayer, ResolvedPlayer } from '../services/player';
import { recordPlayerQuery } from '../services/history';
import { computeBedwarsStar } from '../util/bedwars';
import { HttpError } from '../util/httpError';
import { validatePlayerSubmission, matchesCriticalFields } from '../util/validation';
import { canonicalize } from '../util/signature';
import { isValidBedwarsObject } from '../util/typeChecks';

import { extractBedwarsExperience, parseIfModifiedSince, recordQuerySafely } from '../util/requestUtils';
import { getCacheEntry, CacheSource } from '../services/cache';
import { COMMUNITY_SUBMIT_SECRET } from '../config';

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

const uuidOnlyPattern = /^[0-9a-f]{32}$/i;




interface VerificationResult {
  valid: boolean;
  source: CacheSource | null;
}

function verifySignedSubmission(uuid: string, data: unknown, signature?: string): boolean {
  if (!COMMUNITY_SUBMIT_SECRET || !signature) {
    return false;
  }

  try {
    const canonical = canonicalize(data);
    const digest = createHmac('sha256', COMMUNITY_SUBMIT_SECRET).update(`${uuid}:${canonical}`).digest();
    const provided = Buffer.from(signature, 'hex');
    if (provided.length !== digest.length) {
      return false;
    }
    return timingSafeEqual(provided, digest);
  } catch (error) {
    console.warn('Failed to verify signed submission', error);
    return false;
  }
}

async function verifyHypixelOrigin(uuid: string, data: unknown, signature?: string): Promise<VerificationResult> {
  try {
    const submittedData = data as Record<string, unknown>;
    const cacheKey = `player:${uuid}`;
    const cached = await getCacheEntry<ResolvedPlayer['payload']>(cacheKey);
    const cachedBedwars = cached?.value?.data?.bedwars ?? cached?.value?.bedwars;

    // Only accept cache-based verification if the cache entry originated from Hypixel
    // This prevents "self-reinforcing cache poisoning" where community submissions
    // validate against other community submissions
    if (cached?.source === 'hypixel' && cachedBedwars && isValidBedwarsObject(cachedBedwars) && matchesCriticalFields(cachedBedwars, submittedData)) {
      return { valid: true, source: 'community_verified' };
    }

    // Signed submissions are verified by HMAC, so they are trusted
    if (verifySignedSubmission(uuid, data, signature)) {
      return { valid: true, source: 'community_verified' };
    }

    // Fallback: fetch fresh data from Hypixel and compare
    const { fetchHypixelPlayer } = await import('../services/hypixel');
    const result = await fetchHypixelPlayer(uuid);

    if (!result.payload || result.notModified) {
      return { valid: false, source: null };
    }

    const hypixelData = result.payload.data?.bedwars;
    if (!isValidBedwarsObject(hypixelData)) {
      return { valid: false, source: null };
    }

    if (matchesCriticalFields(hypixelData, submittedData)) {
      return { valid: true, source: 'community_verified' };
    }

    return { valid: false, source: null };
  } catch (error) {
    console.error('Failed to verify Hypixel origin:', error);
    return { valid: false, source: null };
  }
}

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

  // Perform comprehensive validation
  const jsonString = JSON.stringify(data);
  const validation = validatePlayerSubmission(jsonString, data);

  if (!validation.valid) {
    const errorDetails = validation.errors.map((err) => `${err.field}: ${err.message}`).join('; ');
    next(
      new HttpError(
        422,
        'VALIDATION_FAILED',
        `Player data validation failed: ${errorDetails}`,
      ),
    );
    return;
  }

  const normalizedUuid = uuid.trim().toLowerCase();

  // Verify origin to prevent cache poisoning
  const verificationResult = await verifyHypixelOrigin(normalizedUuid, data, signature);
  if (!verificationResult.valid) {
    next(
      new HttpError(
        403,
        'INVALID_ORIGIN',
        'Player data could not be verified as originating from Hypixel API. This may indicate fabricated data.',
      ),
    );
    return;
  }

  const cacheKey = `player:${normalizedUuid}`;

  try {
    const { setCachedPayload } = await import('../services/cache');
    const { CACHE_TTL_MS } = await import('../config');

    // Build a proxy-compatible payload wrapper
    const payload = {
      success: true,
      contributed: true,
      data: { bedwars: data },
      bedwars: data,
    };

    // Store with verified source to prevent self-reinforcing cache poisoning
    await setCachedPayload(cacheKey, payload, CACHE_TTL_MS, {
      etag: `contrib-${Date.now()}`,
      lastModified: Date.now(),
      source: verificationResult.source,
    });

    console.info(`[player/submit] Accepted contribution for uuid=${normalizedUuid} source=${verificationResult.source}`);
    res.status(202).json({ success: true, message: 'Contribution accepted.' });
  } catch (error) {
    next(error);
  }
});

export default router;
