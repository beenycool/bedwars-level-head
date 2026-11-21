import type { RequestHandler } from 'express';
import pLimit from 'p-limit';
import { resolvePlayer, ResolvedPlayer, warmupPlayerCache } from '../services/player';
import type { LookupObservation, LookupRoute } from '../services/lookupTracking';
import { recordLookups } from '../services/lookupTracking';
import { HttpError } from '../util/httpError';
import { extractBatchIdentifiersFromBody, parseAndValidateBatchIdentifiers } from '../util/requestUtils';
import { getCircuitBreakerState } from '../services/hypixel';
import { refundPublicTokens } from '../middleware/rateLimit';
import { IDENTIFIER_MAX_LENGTH, normalizeUuid } from '../util/validationConstants';
import { computeResponseEtag } from '../util/etag';
import { logger } from '../util/logger';

interface PlayerLookupHandlerOptions {
  private: boolean;
  cacheControl: string;
  route: LookupRoute;
}

interface PlayerBatchHandlerOptions {
  batchSize: number;
  cacheControl?: string;
}

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

function failureStatus(error: unknown): number {
  return error instanceof HttpError ? error.status : 500;
}

const BATCH_RETRY_AFTER_DEFAULT_SECONDS = 60;
const RETRY_AFTER_MIN_SECONDS = 1;
const RETRY_AFTER_MAX_SECONDS = 300;

type BatchOutcome =
  | { ok: true; identifier: string; resolved: ResolvedPlayer }
  | { ok: false; identifier: string; error: unknown };

/**
 * Use the upstream's own Retry-After window when a failure carries one, instead
 * of always guessing the default batch wait.
 */
function deriveRetryAfterSeconds(outcomes: BatchOutcome[]): number | null {
  let derived: number | null = null;
  for (const outcome of outcomes) {
    if (outcome.ok || !(outcome.error instanceof HttpError)) {
      continue;
    }
    const header = outcome.error.headers?.['Retry-After'];
    const parsed = header === undefined ? Number.NaN : Number.parseInt(header, 10);
    let seconds: number;
    if (Number.isFinite(parsed)) {
      seconds = parsed;
    } else if (outcome.error.causeCode === 'HYPIXEL_RATE_LIMIT') {
      seconds = BATCH_RETRY_AFTER_DEFAULT_SECONDS;
    } else {
      continue;
    }
    const clamped = Math.min(RETRY_AFTER_MAX_SECONDS, Math.max(RETRY_AFTER_MIN_SECONDS, Math.ceil(seconds)));
    derived = derived === null ? clamped : Math.max(derived, clamped);
  }
  return derived;
}

export function createPlayerLookupHandler(options: PlayerLookupHandlerOptions): RequestHandler {
  return async (req, res, next) => {
    const { identifier } = req.params;

    if (identifier.length > IDENTIFIER_MAX_LENGTH) {
      next(new HttpError(400, 'INVALID_IDENTIFIER', `Identifier must be ${IDENTIFIER_MAX_LENGTH} characters or less.`));
      return;
    }

    const trackingKey = normalizeUuid(identifier);
    if (!trackingKey) {
      next(new HttpError(400, 'INVALID_IDENTIFIER', 'Identifier must be a UUID (dashes optional).'));
      return;
    }

    const startedAt = Date.now();
    const session = req.header('x-levelhead-session') ?? 'none';
    const install = req.header('x-levelhead-install') ?? 'none';

    try {
      const resolved = await resolvePlayer(trackingKey);
      logger.info({
        session,
        install,
        route: options.route,
        identifier: trackingKey,
        source: resolved.source,
        nicked: resolved.nicked,
        latencyMs: Date.now() - startedAt,
      }, '[lookup] individual');
      const responseEtag = computeResponseEtag(resolved.etag, resolved.nicked);
      if (responseEtag) {
        res.set('ETag', responseEtag);
      }

      if (resolved.lastModified) {
        res.set('Last-Modified', new Date(resolved.lastModified).toUTCString());
      }

      res.set('X-Cache', resolved.source === 'cache' ? 'HIT' : 'MISS');
      res.set('Cache-Control', options.cacheControl);

      const status = req.fresh ? 304 : 200;
      recordLookups(
        [
          {
            identifier: trackingKey,
            username: resolved.username,
            bedwarsExperience: resolved.payload.bedwars_experience,
            nicked: resolved.nicked,
            source: resolved.source,
            status,
            latencyMs: Date.now() - startedAt,
          },
        ],
        options.route,
      );

      if (resolved.source === 'cache') {
        refundPublicTokens(req, 1, 'single');
      }

      if (req.fresh) {
        res.status(304).end();
        return;
      }

      const isCircuitOpen = getCircuitBreakerState().state === 'open';
      res.status(200).json({
        ...resolved.payload,
        nicked: resolved.nicked,
        ...(options.private && isCircuitOpen ? { degradedMode: true } : {}),
      });
    } catch (error) {
      logger.warn({
        session,
        install,
        route: options.route,
        identifier: trackingKey,
        status: failureStatus(error),
        latencyMs: Date.now() - startedAt,
        err: error,
      }, '[lookup] individual failed');
      recordLookups(
        [
          {
            identifier: trackingKey,
            username: null,
            bedwarsExperience: null,
            nicked: false,
            source: 'network',
            status: failureStatus(error),
            latencyMs: Date.now() - startedAt,
          },
        ],
        options.route,
      );
      next(error);
    }
  };
}

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

    if (hasInvalid) {
      next(
        new HttpError(
          400,
          'INVALID_IDENTIFIER',
          'All identifiers must be valid UUIDs (dashes optional).',
        ),
      );
      return;
    }

    if (uniqueUuids.length === 0) {
      res.json({ success: true, data: {} });
      return;
    }

    const session = req.header('x-levelhead-session') ?? 'none';
    const install = req.header('x-levelhead-install') ?? 'none';
    const startedAt = Date.now();
    logger.info({
      session,
      install,
      route: 'batch',
      requested: uuidsValue.length,
      unique: uniqueUuids.length,
    }, '[lookup] batch start');

    try {
      const warmedMisses = await warmupPlayerCache(uniqueUuids);

      const observations: LookupObservation[] = [];
      const outcomes = await Promise.all(
        uniqueUuids.map((identifier) =>
          batchLimit(async () => {
            const startedAt = Date.now();
            try {
              const resolved = await resolvePlayer(identifier, warmedMisses);
              observations.push({
                identifier,
                username: resolved.username,
                bedwarsExperience: resolved.payload.bedwars_experience,
                nicked: resolved.nicked,
                source: resolved.source,
                status: 200,
                latencyMs: Date.now() - startedAt,
              });
              return { ok: true as const, identifier, resolved };
            } catch (error) {
              const tracked = normalizeUuid(identifier);
              if (tracked) {
                observations.push({
                  identifier: tracked,
                  username: null,
                  bedwarsExperience: null,
                  nicked: false,
                  source: 'network',
                  status: failureStatus(error),
                  latencyMs: Date.now() - startedAt,
                });
              }
              return { ok: false as const, identifier, error };
            }
          }),
        ),
      );

      const cacheHitCount = outcomes.filter((outcome) => outcome.ok && outcome.resolved.source === 'cache').length;
      const networkMissCount = outcomes.filter((outcome) => outcome.ok && outcome.resolved.source === 'network').length;
      const errorCount = outcomes.filter((outcome) => !outcome.ok).length;
      logger.info({
        session,
        install,
        route: 'batch',
        requested: uniqueUuids.length,
        cacheHits: cacheHitCount,
        networkMisses: networkMissCount,
        errors: errorCount,
        latencyMs: Date.now() - startedAt,
      }, '[lookup] batch done');
      outcomes
        .filter((outcome) => !outcome.ok)
        .slice(0, 5)
        .forEach((outcome) => {
          logger.debug({ session, identifier: outcome.identifier, err: outcome.error }, '[lookup] batch item failed');
        });

      recordLookups(observations, 'batch');

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

      refundPublicTokens(req, cacheHits, 'batch');

      if (successes === 0) {
        if (upstreamFailures === outcomes.length) {
          // No data was delivered, so hand this request's identifier tokens back.
          refundPublicTokens(req, uniqueUuids.length, 'batch');
          const retryAfter = deriveRetryAfterSeconds(outcomes) ?? BATCH_RETRY_AFTER_DEFAULT_SECONDS;
          throw upstreamUnavailable(retryAfter);
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
