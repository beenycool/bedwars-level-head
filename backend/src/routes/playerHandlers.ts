import type { RequestHandler } from 'express';
import pLimit from 'p-limit';
import { resolvePlayer, ResolvedPlayer, warmupPlayerCache } from '../services/player';
import { HttpError } from '../util/httpError';
import { extractBatchIdentifiersFromBody, parseAndValidateBatchIdentifiers } from '../util/requestUtils';
import { getCircuitBreakerState } from '../services/hypixel';
import { IDENTIFIER_MAX_LENGTH, IDENTIFIER_PATTERN } from '../util/validationConstants';
import { computeResponseEtag } from '../util/etag';

interface PlayerLookupHandlerOptions {
  /** Legacy `/api/player` route: exposes degradation hints and stale headers. */
  private: boolean;
  setStaleHeaders: boolean;
  cacheControl: string;
}

interface PlayerBatchHandlerOptions {
  batchSize: number;
  cacheControl?: string;
}

/** Upstream failure = Hypixel refused/timed out or the breaker is open. */
function isUpstreamFailure(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status >= 500 || error.status === 429;
  }
  return true;
}

function upstreamUnavailable(retryAfterSeconds: number): HttpError {
  return new HttpError(
    503,
    'UPSTREAM_UNAVAILABLE',
    'The stats upstream is unavailable. Try again shortly.',
    { 'Retry-After': String(retryAfterSeconds) },
  );
}

/**
 * Shared implementation of GET /:identifier for the public and legacy routers.
 * The payload shape is unchanged: the flat minimal stats object plus `nicked`.
 */
export function createPlayerLookupHandler(options: PlayerLookupHandlerOptions): RequestHandler {
  return async (req, res, next) => {
    const { identifier } = req.params;

    if (identifier.length > IDENTIFIER_MAX_LENGTH) {
      next(new HttpError(400, 'INVALID_IDENTIFIER', `Identifier must be ${IDENTIFIER_MAX_LENGTH} characters or less.`));
      return;
    }

    if (!IDENTIFIER_PATTERN.test(identifier)) {
      next(new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a valid undashed UUID.'));
      return;
    }

    try {
      const resolved = await resolvePlayer(identifier);
      const responseEtag = computeResponseEtag(resolved.etag, resolved.nicked);
      if (responseEtag) {
        res.set('ETag', responseEtag);
      }

      if (resolved.lastModified) {
        res.set('Last-Modified', new Date(resolved.lastModified).toUTCString());
      }

      if (options.setStaleHeaders && resolved.isStale) {
        res.set('X-Cache-Stale', '1');
        res.set('Age', Math.floor((resolved.staleAgeMs ?? 0) / 1000).toString());
      }

      res.set('X-Cache', resolved.source === 'cache' ? 'HIT' : 'MISS');
      res.set('Cache-Control', options.cacheControl);

      if (req.fresh) {
        res.status(304).end();
        return;
      }

      const isCircuitOpen = getCircuitBreakerState().state === 'open';
      res.status(200).json({
        ...resolved.payload,
        nicked: resolved.nicked,
        ...(options.private && resolved.isStale ? { stale: true } : {}),
        ...(options.private && isCircuitOpen ? { degradedMode: true } : {}),
      });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Shared implementation of POST /batch.
 *
 * One bad identifier never fails the batch: identifiers that fail are omitted, which
 * the mod already treats as a temporary per-player error. The batch as a whole only
 * fails when the upstream is unusable for every identifier (breaker open / 5xx / 429).
 */
export function createPlayerBatchHandler(options: PlayerBatchHandlerOptions): RequestHandler {
  const batchLimit = pLimit(6);

  return async (req, res, next) => {
    const uuidsValue = extractBatchIdentifiersFromBody(req.body);
    if (!uuidsValue) {
      next(new HttpError(400, 'BAD_REQUEST', 'Expected body.uuids to be an array.'));
      return;
    }

    if (uuidsValue.length > options.batchSize) {
      next(new HttpError(400, 'BAD_REQUEST', `Provide up to ${options.batchSize} UUIDs per batch request.`));
      return;
    }

    const { uniqueUuids, hasInvalid } = parseAndValidateBatchIdentifiers(uuidsValue);

    if (uniqueUuids.length === 0) {
      res.json({ success: true, data: {} });
      return;
    }

    if (hasInvalid) {
      next(
        new HttpError(
          400,
          'INVALID_IDENTIFIER',
          'All identifiers must be valid undashed UUIDs.',
        ),
      );
      return;
    }

    try {
      if (getCircuitBreakerState().state === 'open') {
        throw upstreamUnavailable(30);
      }

      await warmupPlayerCache(uniqueUuids);

      const outcomes = await Promise.all(
        uniqueUuids.map((identifier) =>
          batchLimit(async () => {
            try {
              const resolved = await resolvePlayer(identifier);
              return { ok: true as const, identifier, resolved };
            } catch (error) {
              return { ok: false as const, identifier, error };
            }
          }),
        ),
      );

      const data: Record<string, ResolvedPlayer['payload'] & { nicked: boolean }> = {};
      let cacheHits = 0;
      let successes = 0;
      let upstreamFailures = 0;

      for (const outcome of outcomes) {
        if (outcome.ok) {
          data[outcome.identifier] = { ...outcome.resolved.payload, nicked: outcome.resolved.nicked };
          successes += 1;
          if (outcome.resolved.source === 'cache') {
            cacheHits += 1;
          }
        } else if (isUpstreamFailure(outcome.error)) {
          upstreamFailures += 1;
        }
      }

      // Nothing worked and every failure came from upstream: fail the batch so the
      // client backs off instead of interpreting an empty 200 as "no such players".
      if (successes === 0) {
        if (upstreamFailures === outcomes.length) {
          throw upstreamUnavailable(60);
        }
        throw new HttpError(400, 'INVALID_IDENTIFIER', 'All identifiers were rejected.');
      }

      res.set('X-Cache', cacheHits === successes ? 'HIT' : cacheHits > 0 ? 'PARTIAL' : 'MISS');

      if (options.cacheControl) {
        res.set('Cache-Control', options.cacheControl);
      }

      const isCircuitOpen = getCircuitBreakerState().state === 'open';
      res.json({ success: true, data, ...(isCircuitOpen ? { degradedMode: true } : {}) });
    } catch (error) {
      next(error);
    }
  };
}
