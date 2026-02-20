import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import pLimit from 'p-limit';
import { enforceRateLimit, enforceBatchRateLimit, getClientIpAddress } from '../middleware/rateLimit';
import { resolvePlayer, ResolvedPlayer, warmupPlayerCache } from '../services/player';
import { computeBedwarsStar } from '../util/bedwars';
import { HttpError } from '../util/httpError';
import { validatePlayerSubmission, matchesCriticalFields, validateTimestampAndNonce } from '../util/validation';
import { canonicalize } from '../util/signature';
import { isValidBedwarsObject } from '../util/typeChecks';

import { extractBedwarsExperience, parseIfModifiedSince, recordQuerySafely } from '../util/requestUtils';
import { CacheSource } from '../services/cache';
import { COMMUNITY_SUBMIT_SECRET } from '../config';
import { MinimalPlayerStats, extractMinimalStats } from '../services/hypixel';
import { getPlayerStatsFromCache, setIgnMapping, setPlayerStatsBoth } from '../services/statsCache';
import { getCircuitBreakerState } from '../services/hypixel';
import { logger } from '../util/logger';

const batchLimit = pLimit(6);

const router = Router();

function buildSubmitterKeyId(ipAddress: string): string {
  if (!COMMUNITY_SUBMIT_SECRET || COMMUNITY_SUBMIT_SECRET.length === 0) {
    throw new HttpError(
      503,
      'SERVICE_UNAVAILABLE',
      'COMMUNITY_SUBMIT_SECRET must be set for player submissions. Configure it in your environment.',
    );
  }
  return createHmac('sha256', COMMUNITY_SUBMIT_SECRET).update(ipAddress).digest('hex');
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




interface VerificationResult {
  valid: boolean;
  source: CacheSource | null;
  error?: string;
  statusCode?: number;
  verifiedDisplayname?: string;
}

interface SignedData {
  timestamp: number;
  nonce: string;
  [key: string]: unknown;
}

function verifySignedSubmission(uuid: string, data: SignedData, signature?: string): boolean {
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
    logger.warn('Failed to verify signed submission', error);
    return false;
  }
}

async function verifyHypixelOrigin(
  uuid: string,
  data: unknown,
  signature?: string,
  keyId?: string,
): Promise<VerificationResult> {
  try {
    const submittedData = data as SignedData;

    // Signed submissions are verified by HMAC, so they are trusted
    if (verifySignedSubmission(uuid, submittedData, signature)) {
      // Validate timestamp and nonce for replay protection
      const timestamp = submittedData.timestamp;
      const nonce = submittedData.nonce;

      if (typeof timestamp !== 'number' || typeof nonce !== 'string') {
        return {
          valid: false,
          source: null,
          error: 'Missing timestamp or nonce in signed payload. Both are required for replay protection.',
          statusCode: 400,
        };
      }

      const nonceValidation = await validateTimestampAndNonce(timestamp, nonce, keyId || 'default');
      if (!nonceValidation.valid) {
        return {
          valid: false,
          source: null,
          error: nonceValidation.error,
          statusCode: nonceValidation.statusCode,
        };
      }

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
      // Security fix: Also verify displayname if present in submission
      // to prevent IGN spoofing/cache poisoning
      const submittedName = (data as any).displayname;
      const actualName = result.payload.player?.displayname;

      if (typeof submittedName === 'string' && typeof actualName === 'string') {
        if (submittedName.trim() !== actualName.trim()) {
          return { valid: false, source: null, error: 'Displayname mismatch' };
        }
      }

      return {
        valid: true,
        source: 'community_verified',
        verifiedDisplayname: actualName,
      };
    }

    return { valid: false, source: null };
  } catch (error) {
    logger.error('Failed to verify Hypixel origin:', error);
    return { valid: false, source: null };
  }
}

export const _test = { verifyHypixelOrigin };

function buildMinimalStatsFromSubmission(data: Record<string, unknown>): MinimalPlayerStats {
  const rawExperience = data.bedwars_experience ?? data.Experience ?? data.experience;
  const numericExperience = Number(rawExperience);
  const bedwarsExperience = Number.isFinite(numericExperience) ? numericExperience : null;

  const rawDisplayname = data.displayname;
  const displayname =
    typeof rawDisplayname === 'string' && rawDisplayname.trim().length > 0
      ? rawDisplayname.trim()
      : null;
  const rawFinalKills = Number(data.final_kills_bedwars ?? 0);
  const rawFinalDeaths = Number(data.final_deaths_bedwars ?? 0);
  const bedwarsFinalKills = Number.isFinite(rawFinalKills) ? rawFinalKills : 0;
  const bedwarsFinalDeaths = Number.isFinite(rawFinalDeaths) ? rawFinalDeaths : 0;

  return {
    displayname,
    bedwars_experience: bedwarsExperience,
    bedwars_final_kills: bedwarsFinalKills,
    bedwars_final_deaths: bedwarsFinalDeaths,
    duels_wins: 0,
    duels_losses: 0,
    duels_kills: 0,
    duels_deaths: 0,
    skywars_experience: null,
    skywars_wins: 0,
    skywars_losses: 0,
    skywars_kills: 0,
    skywars_deaths: 0,
  };
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

  // Use a stable submitter identifier for nonce tracking
  const keyId = buildSubmitterKeyId(getClientIpAddress(req));

  // Verify origin to prevent cache poisoning
  const verificationResult = await verifyHypixelOrigin(normalizedUuid, data, signature, keyId);
  if (!verificationResult.valid) {
    const statusCode = verificationResult.statusCode || 403;
    const errorCode = statusCode === 409 ? 'REPLAY_DETECTED' : 'INVALID_ORIGIN';
    const message = verificationResult.error || 'Player data could not be verified as originating from Hypixel API. This may indicate fabricated data.';
    next(new HttpError(statusCode, errorCode, message));
    return;
  }

  const cacheKey = `player:${normalizedUuid}`;

  try {
    const submission = data as Record<string, unknown>;
    const existingEntry = await getPlayerStatsFromCache(cacheKey, true);

    // Detect payload type and extract stats
    let minimalStats: MinimalPlayerStats;
    // Updated isFullResponse logic: Only treat as full response if it matches Hypixel shape (has player object)
    // Proxy payloads (data.bedwars) are partial updates and should be routed to buildMinimalStatsFromSubmission
    const isFullResponse = (submission.player && typeof submission.player === 'object');

    if (isFullResponse) {
         // Full Hypixel response -> extract all stats
         minimalStats = extractMinimalStats(submission as any);
    } else {
         // Partial update (Proxy or legacy) -> build minimal stats (zeros out missing fields)
         minimalStats = buildMinimalStatsFromSubmission(submission);
    }

    const verifiedName = verificationResult.verifiedDisplayname;
    const displaynameToUse = verifiedName ?? minimalStats.displayname;

    let mergedStats: MinimalPlayerStats;

    if (existingEntry?.value) {
        mergedStats = { ...existingEntry.value };
        // Removed redundant assignment to mergedStats.displayname here per PR review

        const hasExperience = Object.prototype.hasOwnProperty.call(submission, 'bedwars_experience') ||
                            Object.prototype.hasOwnProperty.call(submission, 'Experience') ||
                            Object.prototype.hasOwnProperty.call(submission, 'experience');

        // For full response, we trust the extracted value implicitly
        if (isFullResponse) {
             // Overwrite all stats with authoritative full response
             // This ensures Duels/SkyWars are updated correctly
             Object.assign(mergedStats, minimalStats);

             // Restore proper displayname if needed (Object.assign overwrites it with minimalStats.displayname)
             mergedStats.displayname = displaynameToUse ?? mergedStats.displayname;
        } else {
             // Partial update: Only update Bedwars fields that are present
             // Restore proper displayname here as well for partial updates
             mergedStats.displayname = displaynameToUse ?? mergedStats.displayname;

             if (hasExperience && minimalStats.bedwars_experience !== null) {
                 mergedStats.bedwars_experience = minimalStats.bedwars_experience;
             }

             if (Object.prototype.hasOwnProperty.call(submission, 'final_kills_bedwars')) {
                 mergedStats.bedwars_final_kills = minimalStats.bedwars_final_kills;
             }

             if (Object.prototype.hasOwnProperty.call(submission, 'final_deaths_bedwars')) {
                 mergedStats.bedwars_final_deaths = minimalStats.bedwars_final_deaths;
             }
             // Explicitly DO NOT update Duels/SkyWars here to preserve existing data
        }
    } else {
        // New entry
        mergedStats = { ...minimalStats, displayname: displaynameToUse };
    }

    const etag = `contrib-${Date.now()}`;
    const lastModified = Date.now();

    await setPlayerStatsBoth(cacheKey, mergedStats, {
      etag,
      lastModified,
      source: verificationResult.source,
    });

    if (mergedStats.displayname) {
      await setIgnMapping(mergedStats.displayname.toLowerCase(), normalizedUuid, false);
    }

    logger.info(`[player/submit] Accepted contribution for uuid=${normalizedUuid} source=${verificationResult.source}`);
    res.status(202).json({ success: true, message: 'Contribution accepted.' });
  } catch (error) {
    next(error);
  }
});

export default router;
