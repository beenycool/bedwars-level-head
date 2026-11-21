import axios, { type AxiosResponseHeaders, type RawAxiosResponseHeaders } from 'axios';
import https from 'node:https';
import { randomInt } from 'node:crypto';
import CacheableLookup from 'cacheable-lookup';
import pLimit from 'p-limit';
import {
  CB_FAILURE_THRESHOLD,
  CB_RESET_TIMEOUT_MS,
  HYPIXEL_API_BASE_URL,
  HYPIXEL_API_KEY,
  HYPIXEL_BURST_CAPACITY,
  HYPIXEL_MAX_CONCURRENCY,
  HYPIXEL_REQUESTS_PER_SECOND,
  HYPIXEL_RETRY_DELAY_MAX_MS,
  HYPIXEL_RETRY_DELAY_MIN_MS,
  HYPIXEL_TIMEOUT_MS,
  OUTBOUND_USER_AGENT,
} from '../config';
import { HttpError } from '../util/httpError';
import { isNonArrayObject } from '../util/typeChecks';
import { logger } from '../util/logger';

const dnsCache = new CacheableLookup({ maxTtl: 300, fallbackDuration: 0 });

const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 50,
  family: 4,             // STRICTLY force IPv4 to bypass the 2s IPv6 timeout
});
dnsCache.install(agent as unknown as https.Agent);

const hypixelClient = axios.create({
  baseURL: HYPIXEL_API_BASE_URL,
  timeout: HYPIXEL_TIMEOUT_MS,
  httpsAgent: agent,
  headers: {
    'User-Agent': OUTBOUND_USER_AGENT,
  },
});

const upstreamGate = pLimit(HYPIXEL_MAX_CONCURRENCY);

/**
 * Paces request arrivals, not just concurrency. Hypixel throttles same-second
 * bursts even when the 5-minute quota is healthy, so a waiting room of players
 * is fed through a small token bucket instead of all at once.
 */
class UpstreamPacer {
  private tokens: number;
  private lastRefillAt = Date.now();
  private readonly queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
  ) {
    this.tokens = capacity;
  }

  async acquire(): Promise<number> {
    const queuedAt = Date.now();
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.pump();
    });
    return Date.now() - queuedAt;
  }

  private pump(): void {
    if (this.timer) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefillAt = now;
    }
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()?.();
    }
    if (this.queue.length > 0) {
      const waitMs = Math.max(1, Math.ceil((1 - this.tokens) / this.refillPerMs));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, waitMs);
      this.timer.unref?.();
    }
  }
}

const upstreamPacer = new UpstreamPacer(
  HYPIXEL_BURST_CAPACITY,
  HYPIXEL_REQUESTS_PER_SECOND / 1000,
);

/**
 * Hypixel returns 429 with `Retry-After` (and `RateLimit-Reset`) when its
 * limiter trips. Remember the window so queued lookups fail fast with a 429
 * instead of burning requests against a key that is already being throttled.
 */
const MAX_COOLDOWN_MS = 5 * 60 * 1000;
let upstreamCooldownUntil = 0;

function headerNumber(
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders | undefined,
  name: string,
): number | null {
  if (!headers) {
    return null;
  }
  const raw = isNonArrayObject(headers) ? headers[name] : undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function updateRateLimitState(
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders | undefined,
  now: number,
): void {
  const remaining = headerNumber(headers, 'ratelimit-remaining');
  const resetSeconds = headerNumber(headers, 'ratelimit-reset');
  if (remaining === 0 && resetSeconds !== null) {
    upstreamCooldownUntil = Math.max(
      upstreamCooldownUntil,
      now + Math.min(MAX_COOLDOWN_MS, resetSeconds * 1000),
    );
  }
}

function applyRateLimitCooldown(
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders | undefined,
): void {
  const retryAfter = headerNumber(headers, 'retry-after');
  const resetSeconds = headerNumber(headers, 'ratelimit-reset');
  const seconds = Math.max(retryAfter ?? 0, resetSeconds ?? 0, 1);
  upstreamCooldownUntil = Math.max(
    upstreamCooldownUntil,
    Date.now() + Math.min(MAX_COOLDOWN_MS, seconds * 1000),
  );
}

const CIRCUIT_BREAKER = {
  failureThreshold: CB_FAILURE_THRESHOLD,
  resetTimeoutMs: CB_RESET_TIMEOUT_MS,
  state: 'closed' as 'closed' | 'open' | 'half-open',
  failures: 0,
  lastFailureAt: 0,
  halfOpenProbeInFlight: false,
};

function circuitBreakerCheck(): void {
  if (CIRCUIT_BREAKER.state === 'closed') {
    return;
  }
  if (CIRCUIT_BREAKER.state === 'open') {
    if (Date.now() - CIRCUIT_BREAKER.lastFailureAt >= CIRCUIT_BREAKER.resetTimeoutMs) {
      CIRCUIT_BREAKER.state = 'half-open';
      CIRCUIT_BREAKER.halfOpenProbeInFlight = true;
      return;
    }
    throw new HttpError(503, 'HYPIXEL_CIRCUIT_OPEN', 'Hypixel API circuit breaker is open; failing fast.');
  }

  if (CIRCUIT_BREAKER.halfOpenProbeInFlight) {
    throw new HttpError(503, 'HYPIXEL_CIRCUIT_OPEN', 'Hypixel API circuit breaker is half-open; probe in flight.');
  }

  CIRCUIT_BREAKER.halfOpenProbeInFlight = true;
}

function circuitBreakerSuccess(): void {
  CIRCUIT_BREAKER.failures = 0;
  CIRCUIT_BREAKER.state = 'closed';
  CIRCUIT_BREAKER.halfOpenProbeInFlight = false;
}

function circuitBreakerFailure(): void {
  CIRCUIT_BREAKER.failures += 1;
  CIRCUIT_BREAKER.lastFailureAt = Date.now();
  CIRCUIT_BREAKER.halfOpenProbeInFlight = false;
  if (CIRCUIT_BREAKER.state === 'half-open' || CIRCUIT_BREAKER.failures >= CIRCUIT_BREAKER.failureThreshold) {
    CIRCUIT_BREAKER.state = 'open';
  }
}

/**
 * A 429 does not trip a closed breaker, but it still ends a half-open probe.
 * Reopening and resetting `lastFailureAt` keeps the next probe behind the normal
 * reset timeout instead of leaving the breaker half-open with a stuck flag.
 */
function releaseHalfOpenProbe(): void {
  if (CIRCUIT_BREAKER.state !== 'half-open') {
    return;
  }
  CIRCUIT_BREAKER.state = 'open';
  CIRCUIT_BREAKER.halfOpenProbeInFlight = false;
  CIRCUIT_BREAKER.lastFailureAt = Date.now();
}

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureAt: number | null;
  nextRetryAt: number | null;
  probeInFlight: boolean;
}

export function getCircuitBreakerState(): CircuitBreakerState {
  const nextRetryAt =
    CIRCUIT_BREAKER.state === 'open' && CIRCUIT_BREAKER.lastFailureAt > 0
      ? CIRCUIT_BREAKER.lastFailureAt + CIRCUIT_BREAKER.resetTimeoutMs
      : null;

  return {
    state: CIRCUIT_BREAKER.state,
    failureCount: CIRCUIT_BREAKER.failures,
    lastFailureAt: CIRCUIT_BREAKER.lastFailureAt > 0 ? CIRCUIT_BREAKER.lastFailureAt : null,
    nextRetryAt,
    probeInFlight: CIRCUIT_BREAKER.halfOpenProbeInFlight,
  };
}

export interface HypixelPlayerResponse {
  success: boolean;
  cause?: string;
  player?: {
    uuid?: string;
    displayname?: string;
    stats?: {
      Bedwars?: Record<string, unknown>;
      Duels?: Record<string, unknown>;
      SkyWars?: Record<string, unknown>;
    };
  } | null;
}

export interface HypixelFetchResult {
  payload: HypixelPlayerResponse;
  etag: string | null;
  lastModified: number | null;
}

function parseLastModified(value?: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function jitterDelay(): number {
  const MAX_TIMEOUT_MS = 2_147_483_647;
  const toSafeDelay = (value: number): number => {
    if (!Number.isSafeInteger(value)) return 0;
    return Math.min(MAX_TIMEOUT_MS, Math.max(0, value));
  };

  const min = toSafeDelay(HYPIXEL_RETRY_DELAY_MIN_MS);
  const max = Math.max(min, toSafeDelay(HYPIXEL_RETRY_DELAY_MAX_MS));
  return max > min ? randomInt(min, max + 1) : min;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(): Record<string, string> {
  return { 'API-Key': HYPIXEL_API_KEY };
}

function shouldRetry(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  if (error.response) {
    const status = error.response.status;
    if (status === 403 || status === 429) {
      return false;
    }
    return status >= 500;
  }

  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(error.code ?? '');
}

function extractRetryAfterHeader(
  headers?: RawAxiosResponseHeaders | AxiosResponseHeaders,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const headerValue = isNonArrayObject(headers) ? headers['retry-after'] : undefined;
  if (!headerValue) {
    return undefined;
  }

  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return String(headerValue);
}

export async function fetchHypixelPlayer(uuid: string): Promise<HypixelFetchResult> {
  let attempt = 0;
  let lastError: unknown;
  // Set when the probe outcome was already recorded, so the catch block does not
  // count the same probe failure twice.
  let breakerSettled = false;

  const cooldownMs = upstreamCooldownUntil - Date.now();
  if (cooldownMs > 0) {
    const retryAfter = Math.max(1, Math.ceil(cooldownMs / 1000));
    logger.debug({ uuid, retryAfter }, '[hypixel] skipping during cooldown');
    throw new HttpError(
      429,
      'HYPIXEL_RATE_LIMIT',
      'Hypixel rate limited the backend.',
      { 'Retry-After': String(retryAfter) },
    );
  }

  circuitBreakerCheck();
  const requestStartedAt = Date.now();

  while (attempt < 2) {
    try {
      const queuedAt = Date.now();
      const queueDepth = upstreamGate.pendingCount;
      logger.debug({ uuid, attempt: attempt + 1, queueDepth }, '[hypixel] fetch start');
      let upstreamStartedAt = queuedAt;
      let paceMs = 0;
      const response = await upstreamGate(async () => {
        paceMs = await upstreamPacer.acquire();
        upstreamStartedAt = Date.now();
        return hypixelClient.get<HypixelPlayerResponse>('/v2/player', {
          params: { uuid },
          headers: buildHeaders(),
          timeout: HYPIXEL_TIMEOUT_MS,
        });
      });

      const rateLimitRemaining = headerNumber(response.headers, 'ratelimit-remaining');
      const rateLimitReset = headerNumber(response.headers, 'ratelimit-reset');
      updateRateLimitState(response.headers, Date.now());
      logger.debug({
        uuid,
        attempt: attempt + 1,
        status: response.status,
        queueMs: upstreamStartedAt - queuedAt,
        paceMs,
        rateLimitRemaining,
        rateLimitReset,
        latencyMs: Date.now() - requestStartedAt,
      }, '[hypixel] fetch response');

      const payload = response.data;
      if (!isNonArrayObject(payload)) {
        throw new HttpError(502, 'INVALID_HYPIXEL_RESPONSE', 'Hypixel returned a malformed response.');
      }
      if (payload.success !== true) {
        const cause = typeof payload.cause === 'string' && payload.cause.length > 0
          ? payload.cause
          : 'UNKNOWN_HYPIXEL_ERROR';
        circuitBreakerFailure();
        breakerSettled = true;
        throw new HttpError(502, cause, 'Hypixel returned an error response.');
      }
      circuitBreakerSuccess();

      return {
        payload,
        etag: response.headers['etag'] ?? null,
        lastModified: parseLastModified(response.headers['last-modified']),
      };
    } catch (error) {
      lastError = error;
      const response = axios.isAxiosError(error) ? error.response : undefined;
      const status = response?.status;
      const code = axios.isAxiosError(error) ? error.code : undefined;
      const message = error instanceof Error ? error.message : String(error);
      const rateLimitRemaining = headerNumber(response?.headers, 'ratelimit-remaining');
      const rateLimitReset = headerNumber(response?.headers, 'ratelimit-reset');
      const retryAfter = headerNumber(response?.headers, 'retry-after');
      if (status === 429) {
        applyRateLimitCooldown(response?.headers);
      }
      logger.warn({
        uuid,
        attempt: attempt + 1,
        status,
        code,
        message,
        rateLimitRemaining,
        rateLimitReset,
        retryAfter,
        cooldownMs: Math.max(0, upstreamCooldownUntil - Date.now()),
        latencyMs: Date.now() - requestStartedAt,
      }, '[hypixel] fetch failed');
      if (attempt === 0 && shouldRetry(error)) {
        attempt += 1;
        logger.debug({ uuid, attempt: attempt + 1 }, '[hypixel] retrying');
        await wait(jitterDelay());
        continue;
      }

      // A throttle is not an outage: keeping the breaker closed lets normal
      // lookups resume as soon as the Retry-After window passes. It must still
      // end a half-open probe, or the probe flag would never clear.
      if (!breakerSettled) {
        if (status === 429) {
          releaseHalfOpenProbe();
        } else {
          circuitBreakerFailure();
        }
      }

      if (axios.isAxiosError(error)) {
        if (error.response) {
          const status = error.response.status;
          if (status === 403) {
            throw new HttpError(502, 'HYPIXEL_FORBIDDEN', 'Hypixel rejected the backend API key.');
          }
          if (status === 429) {
            const retryAfterHeader = extractRetryAfterHeader(error.response.headers);
            throw new HttpError(
              429,
              'HYPIXEL_RATE_LIMIT',
              'Hypixel rate limited the backend.',
              retryAfterHeader ? { 'Retry-After': retryAfterHeader } : undefined,
            );
          }
          throw new HttpError(502, 'HYPIXEL_ERROR', `Hypixel responded with status ${status}.`);
        }

        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new HttpError(504, 'HYPIXEL_TIMEOUT', 'Hypixel did not respond before timing out.');
        }

        throw new HttpError(502, 'HYPIXEL_NETWORK_ERROR', 'Unable to reach Hypixel.');
      }

      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown Hypixel fetch failure');
}

let reachabilityCache: { value: boolean; checkedAt: number } | null = null;
const REACHABILITY_CACHE_MS = 15_000;

export async function checkHypixelReachability(): Promise<boolean> {
  const now = Date.now();
  if (reachabilityCache && now - reachabilityCache.checkedAt < REACHABILITY_CACHE_MS) {
    return reachabilityCache.value;
  }

  const startedAt = now;
  try {
    // `/v2/counts` is a cheap route. The old `/status` call was actually the
    // player-status endpoint, so it always returned 400 ("missing uuid") while
    // still being treated as healthy. This doesn't send the API key, so probes
    // stay free; the short cache below keeps Render's 5-second checks from
    // multiplying them.
    const response = await hypixelClient.get('/v2/counts', {
      timeout: Math.min(HYPIXEL_TIMEOUT_MS, 2000),
      validateStatus: () => true,
    });
    const reachable = response.status < 500;
    logger.debug({
      status: response.status,
      latencyMs: Date.now() - startedAt,
      reachable,
      cached: false,
    }, '[hypixel] status check');
    reachabilityCache = { value: reachable, checkedAt: Date.now() };
    return reachable;
  } catch (error) {
    logger.error({ err: error }, 'Hypixel reachability check failed');
    reachabilityCache = { value: false, checkedAt: Date.now() };
    return false;
  }
}

export interface MinimalPlayerStats {
  displayname: string | null;

  bedwars_experience: number | null;
  bedwars_active_star: string | null;
  bedwars_final_kills: number;
  bedwars_final_deaths: number;

  duels_wins: number;
  duels_losses: number;
  duels_kills: number;
  duels_deaths: number;

  skywars_experience: number | null;
  skywars_wins: number;
  skywars_losses: number;
  skywars_kills: number;
  skywars_deaths: number;
}

function computeAggregates(stats: Record<string, unknown>) {
  let wins = 0;
  let losses = 0;
  let kills = 0;
  let deaths = 0;

  for (const key in stats) {
    if (Object.prototype.hasOwnProperty.call(stats, key)) {
      const value = stats[key];
      if (typeof value !== 'number') continue;

      if (key.startsWith('wins_')) {
        wins += value;
      } else if (key.startsWith('losses_')) {
        losses += value;
      } else if (key.startsWith('kills_')) {
        kills += value;
      } else if (key.startsWith('deaths_')) {
        deaths += value;
      }
    }
  }
  return { wins, losses, kills, deaths };
}

function extractModeStats(
  stats: Record<string, unknown>,
): { wins: number; losses: number; kills: number; deaths: number } {
  const hasWins = stats.wins != null;
  const hasLosses = stats.losses != null;
  const hasKills = stats.kills != null;
  const hasDeaths = stats.deaths != null;

  if (hasWins && hasLosses && hasKills && hasDeaths) {
    return {
      wins: Number(stats.wins),
      losses: Number(stats.losses),
      kills: Number(stats.kills),
      deaths: Number(stats.deaths),
    };
  }

  const aggregates = computeAggregates(stats);
  return {
    wins: hasWins ? Number(stats.wins) : aggregates.wins,
    losses: hasLosses ? Number(stats.losses) : aggregates.losses,
    kills: hasKills ? Number(stats.kills) : aggregates.kills,
    deaths: hasDeaths ? Number(stats.deaths) : aggregates.deaths,
  };
}

export function extractMinimalStats(response: HypixelPlayerResponse): MinimalPlayerStats {
  const bedwarsStatsRaw = response.player?.stats?.Bedwars;
  const duelsStatsRaw = response.player?.stats?.Duels;
  const skywarsStatsRaw = response.player?.stats?.SkyWars;
  const bedwarsStats = isNonArrayObject(bedwarsStatsRaw) ? bedwarsStatsRaw : {};
  const duelsStats = isNonArrayObject(duelsStatsRaw) ? duelsStatsRaw : {};
  const skywarsStats = isNonArrayObject(skywarsStatsRaw) ? skywarsStatsRaw : {};

  const bedwars = bedwarsStats as Record<string, number | undefined>;
  const skywars = skywarsStats as Record<string, number | undefined>;
  const activeStar = typeof bedwarsStats.active_star === 'string' ? bedwarsStats.active_star : null;

  const duelsAggregates = extractModeStats(duelsStats);
  const skywarsAggregates = extractModeStats(skywarsStats);

  return {
    displayname: response.player?.displayname ?? null,

    bedwars_experience: bedwars.bedwars_experience ?? bedwars.Experience ?? null,
    bedwars_active_star: activeStar,
    bedwars_final_kills: Number(bedwars.final_kills_bedwars ?? 0),
    bedwars_final_deaths: Number(bedwars.final_deaths_bedwars ?? 0),

    duels_wins: duelsAggregates.wins,
    duels_losses: duelsAggregates.losses,
    duels_kills: duelsAggregates.kills,
    duels_deaths: duelsAggregates.deaths,

    skywars_experience: skywars.skywars_experience
                       ?? skywars.SkyWars_experience
                       ?? skywars.experience
                       ?? skywars.Experience
                       ?? null,
    skywars_wins: skywarsAggregates.wins,
    skywars_losses: skywarsAggregates.losses,
    skywars_kills: skywarsAggregates.kills,
    skywars_deaths: skywarsAggregates.deaths,
  };
}
