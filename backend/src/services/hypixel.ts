import axios, { type AxiosResponseHeaders, type RawAxiosResponseHeaders } from 'axios';
import https from 'node:https';
import CacheableLookup from 'cacheable-lookup';
import {
  CB_FAILURE_THRESHOLD,
  CB_RESET_TIMEOUT_MS,
  HYPIXEL_API_BASE_URL,
  HYPIXEL_API_KEY,
  HYPIXEL_RETRY_DELAY_MAX_MS,
  HYPIXEL_RETRY_DELAY_MIN_MS,
  HYPIXEL_TIMEOUT_MS,
  OUTBOUND_USER_AGENT,
} from '../config';
import { HttpError } from '../util/httpError';
import { recordHypixelApiCall } from './hypixelTracker';
import { logger } from '../util/logger';

const dnsCache = new CacheableLookup({ maxTtl: 300, fallbackDuration: 0 });

// Define a custom HTTPS agent to force IPv4 and enable Keep-Alive
const agent = new https.Agent({
  keepAlive: true,       // Reuse existing connections for batch requests
  keepAliveMsecs: 15_000,
  maxSockets: 50,        // Allow up to 50 parallel connections
  family: 4,             // STRICTLY force IPv4 to bypass the 2s IPv6 timeout
});
dnsCache.install(agent as any);

const hypixelClient = axios.create({
  baseURL: HYPIXEL_API_BASE_URL,
  timeout: HYPIXEL_TIMEOUT_MS,
  httpsAgent: agent,     // Attach the custom agent here
  headers: {
    'User-Agent': OUTBOUND_USER_AGENT,
  },
});

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

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureAt: number | null;
  nextRetryAt: number | null;
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

export interface ProxyPlayerPayload {
  success: boolean;
  cause?: string;
  message?: string;
  data?: {
    bedwars?: Record<string, unknown>;
  };
  bedwars?: Record<string, unknown>;
  player?: {
    uuid?: string;
    displayname?: string;
    stats?: {
      Bedwars?: Record<string, unknown>;
      Duels?: Record<string, unknown>;
      SkyWars?: Record<string, unknown>;
    };
  };
  nicked?: boolean;
  display?: string;
}

export interface HypixelFetchOptions {
  etag?: string;
  lastModified?: number;
}

export interface HypixelFetchResult {
  payload?: ProxyPlayerPayload;
  etag: string | null;
  lastModified: number | null;
  notModified: boolean;
}

function toHttpDate(ms?: number): string | undefined {
  if (typeof ms !== 'number' || Number.isNaN(ms)) {
    return undefined;
  }

  return new Date(ms).toUTCString();
}

function parseLastModified(value?: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function jitterDelay(): number {
  const min = Math.max(0, HYPIXEL_RETRY_DELAY_MIN_MS);
  const max = Math.max(min, HYPIXEL_RETRY_DELAY_MAX_MS);
  return min + Math.random() * (max - min);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shapes the Hypixel player response into the proxy payload format.
 * **Does NOT mutate** the input response object. It clones the bedwars stats
 * and injects/overwrites bedwars_experience, Experience, fkdr, and winstreak.
 */
export function shapePayload(response: HypixelPlayerResponse): ProxyPlayerPayload {
  if (!response.success) {
    const cause = response.cause ?? 'UNKNOWN_HYPIXEL_ERROR';
    throw new HttpError(502, cause, 'Hypixel returned an error response.');
  }

  const bedwarsStats = response.player?.stats?.Bedwars ?? {};
  const experience = (bedwarsStats as any).bedwars_experience ?? (bedwarsStats as any).Experience;
  const finalKillsRaw = (bedwarsStats as any).final_kills_bedwars;
  const finalDeathsRaw = (bedwarsStats as any).final_deaths_bedwars;
  const winstreakRaw = (bedwarsStats as any).winstreak;

  const finalKills = Number(finalKillsRaw ?? 0);
  const finalDeaths = Number(finalDeathsRaw ?? 0);
  const winstreakNumber = Number(winstreakRaw);
  const winstreak = Number.isFinite(winstreakNumber) ? winstreakNumber : undefined;
  const fkdr = finalDeaths <= 0 ? finalKills : finalKills / finalDeaths;

  // Clone to avoid hidden mutation
  const shapedStats = { ...bedwarsStats } as Record<string, unknown>;

  if (experience !== undefined) {
    shapedStats.bedwars_experience = experience;
    shapedStats.Experience = experience;
  }
  if (Number.isFinite(fkdr)) {
    shapedStats.fkdr = fkdr;
  }
  if (winstreak !== undefined) {
    shapedStats.winstreak = winstreak;
  } else if ('winstreak' in shapedStats) {
    delete shapedStats.winstreak;
  }

  const duelsStats = response.player?.stats?.Duels ?? {};
  const skywarsStats = response.player?.stats?.SkyWars ?? {};

  return {
    success: true,
    data: {
      bedwars: shapedStats,
    },
    bedwars: shapedStats,
    player: {
      uuid: response.player?.uuid,
      displayname: response.player?.displayname,
      stats: {
        Bedwars: shapedStats,
        Duels: duelsStats,
        SkyWars: skywarsStats,
      },
    },
  };
}

function buildHeaders(options?: HypixelFetchOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'API-Key': HYPIXEL_API_KEY,
  };

  if (options?.etag) {
    headers['If-None-Match'] = options.etag;
  }

  const modifiedSince = toHttpDate(options?.lastModified);
  if (modifiedSince) {
    headers['If-Modified-Since'] = modifiedSince;
  }

  return headers;
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

  const headerValue = (headers as Record<string, unknown>)['retry-after'];
  if (!headerValue) {
    return undefined;
  }

  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return String(headerValue);
}

export async function fetchHypixelPlayer(
  uuid: string,
  options?: HypixelFetchOptions,
): Promise<HypixelFetchResult> {
  let attempt = 0;
  let lastError: unknown;
  circuitBreakerCheck();

  while (attempt < 2) {
    try {
      const response = await hypixelClient.get<HypixelPlayerResponse>('/v2/player', {
        params: { uuid },
        headers: buildHeaders(options),
        timeout: HYPIXEL_TIMEOUT_MS,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
      });

      const etag = response.headers['etag'] ?? null;
      const lastModified = parseLastModified(response.headers['last-modified']);
      void recordHypixelApiCall(uuid).catch((error) => {
        logger.error('Failed to record Hypixel API call', error);
      });

      circuitBreakerSuccess();

      if (response.status === 304) {
        return { payload: undefined, etag, lastModified, notModified: true };
      }

      const payload = shapePayload(response.data);

      return {
        payload,
        etag,
        lastModified,
        notModified: false,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0 && shouldRetry(error)) {
        attempt += 1;
        await wait(jitterDelay());
        continue;
      }

      circuitBreakerFailure();

      if (axios.isAxiosError(error)) {
        if (error.response) {
          const status = error.response.status;
          if (status === 403) {
            throw new HttpError(502, 'HYPIXEL_FORBIDDEN', 'Hypixel rejected the backend API key.');
          }
          if (status === 429) {
            const retryAfter = extractRetryAfterHeader(error.response.headers);
            throw new HttpError(
              429,
              'HYPIXEL_RATE_LIMIT',
              'Hypixel rate limited the backend.',
              retryAfter ? { 'Retry-After': retryAfter } : undefined,
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

export async function checkHypixelReachability(): Promise<boolean> {
  try {
    const response = await hypixelClient.get('/status', {
      timeout: Math.min(HYPIXEL_TIMEOUT_MS, 2000),
      validateStatus: () => true,
    });
    return response.status < 500;
  } catch (error) {
    logger.error('Hypixel reachability check failed', error);
    return false;
  }
}

export interface MinimalPlayerStats {
  displayname: string | null;

  // Bedwars-specific (for stars calculation, FKDR)
  bedwars_experience: number | null;
  bedwars_final_kills: number;
  bedwars_final_deaths: number;

  // Duels-specific (for WLR, KDR)
  duels_wins: number;
  duels_losses: number;
  duels_kills: number;
  duels_deaths: number;

  // SkyWars-specific (for level calculation, WLR, KDR)
  skywars_experience: number | null;
  skywars_wins: number;
  skywars_losses: number;
  skywars_kills: number;
  skywars_deaths: number;
}

// Bolt: Optimized aggregation to scan stats object only once
function computeAggregates(stats: Record<string, unknown>) {
  let wins = 0;
  let losses = 0;
  let kills = 0;
  let deaths = 0;

  // Optimization: Use for..in to avoid Object.keys() allocation
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
  const wins = Number(stats.wins ?? 0);
  const losses = Number(stats.losses ?? 0);
  const kills = Number(stats.kills ?? 0);
  const deaths = Number(stats.deaths ?? 0);

  const aggregates =
    !wins || !losses || !kills || !deaths
      ? computeAggregates(stats)
      : { wins: 0, losses: 0, kills: 0, deaths: 0 };

  return {
    wins: wins || aggregates.wins,
    losses: losses || aggregates.losses,
    kills: kills || aggregates.kills,
    deaths: deaths || aggregates.deaths,
  };
}

export function extractMinimalStats(response: HypixelPlayerResponse): MinimalPlayerStats {
  const bedwarsStats = response.player?.stats?.Bedwars ?? {};
  const duelsStats = response.player?.stats?.Duels ?? {};
  const skywarsStats = response.player?.stats?.SkyWars ?? {};

  const duelsAggregates = extractModeStats(duelsStats);
  const skywarsAggregates = extractModeStats(skywarsStats);

  return {
    displayname: response.player?.displayname ?? null,

    // Bedwars
    bedwars_experience: (bedwarsStats as any).bedwars_experience
                       ?? (bedwarsStats as any).Experience ?? null,
    bedwars_final_kills: Number(bedwarsStats.final_kills_bedwars ?? 0),
    bedwars_final_deaths: Number(bedwarsStats.final_deaths_bedwars ?? 0),

    // Duels
    duels_wins: duelsAggregates.wins,
    duels_losses: duelsAggregates.losses,
    duels_kills: duelsAggregates.kills,
    duels_deaths: duelsAggregates.deaths,

    // SkyWars
    skywars_experience: (skywarsStats as any).skywars_experience
                       ?? (skywarsStats as any).SkyWars_experience
                       ?? (skywarsStats as any).Experience
                       ?? null,
    skywars_wins: skywarsAggregates.wins,
    skywars_losses: skywarsAggregates.losses,
    skywars_kills: skywarsAggregates.kills,
    skywars_deaths: skywarsAggregates.deaths,
  };
}
