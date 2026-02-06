import axios, { type AxiosResponseHeaders, type RawAxiosResponseHeaders } from 'axios';
import https from 'node:https';
import CacheableLookup from 'cacheable-lookup';
import {
  HYPIXEL_API_BASE_URL,
  HYPIXEL_API_KEY,
  HYPIXEL_RETRY_DELAY_MAX_MS,
  HYPIXEL_RETRY_DELAY_MIN_MS,
  HYPIXEL_TIMEOUT_MS,
  OUTBOUND_USER_AGENT,
} from '../config';
import { HttpError } from '../util/httpError';
import { recordHypixelApiCall } from './hypixelTracker';

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
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  state: 'closed' as 'closed' | 'open' | 'half-open',
  failures: 0,
  lastFailureAt: 0,
};

function circuitBreakerCheck(): void {
  if (CIRCUIT_BREAKER.state === 'closed') {
    return;
  }
  if (CIRCUIT_BREAKER.state === 'open') {
    if (Date.now() - CIRCUIT_BREAKER.lastFailureAt >= CIRCUIT_BREAKER.resetTimeoutMs) {
      CIRCUIT_BREAKER.state = 'half-open';
      return;
    }
    throw new HttpError(503, 'HYPIXEL_CIRCUIT_OPEN', 'Hypixel API circuit breaker is open; failing fast.');
  }
}

function circuitBreakerSuccess(): void {
  CIRCUIT_BREAKER.failures = 0;
  CIRCUIT_BREAKER.state = 'closed';
}

function circuitBreakerFailure(): void {
  CIRCUIT_BREAKER.failures += 1;
  CIRCUIT_BREAKER.lastFailureAt = Date.now();
  if (CIRCUIT_BREAKER.failures >= CIRCUIT_BREAKER.failureThreshold) {
    CIRCUIT_BREAKER.state = 'open';
  }
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

function shapePayload(response: HypixelPlayerResponse): ProxyPlayerPayload {
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

  const shapedStats: Record<string, unknown> = {
    ...bedwarsStats,
    ...(experience !== undefined ? { bedwars_experience: experience, Experience: experience } : {}),
    ...(Number.isFinite(fkdr) ? { fkdr } : {}),
    ...(winstreak !== undefined ? { winstreak } : {}),
  };

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
        console.error('Failed to record Hypixel API call', error);
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
    console.error('Hypixel reachability check failed', error);
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

  for (const key of Object.keys(stats)) {
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
  return { wins, losses, kills, deaths };
}

export function extractMinimalStats(response: HypixelPlayerResponse): MinimalPlayerStats {
  const bedwarsStats = response.player?.stats?.Bedwars ?? {};
  const duelsStats = response.player?.stats?.Duels ?? {};
  const skywarsStats = response.player?.stats?.SkyWars ?? {};

  const duelsWins = Number(duelsStats.wins ?? 0);
  const duelsLosses = Number(duelsStats.losses ?? 0);
  const duelsKills = Number(duelsStats.kills ?? 0);
  const duelsDeaths = Number(duelsStats.deaths ?? 0);

  const duelsAggregates =
    !duelsWins || !duelsLosses || !duelsKills || !duelsDeaths
      ? computeAggregates(duelsStats)
      : { wins: 0, losses: 0, kills: 0, deaths: 0 };

  const duelsWinsTotal = duelsWins || duelsAggregates.wins;
  const duelsLossesTotal = duelsLosses || duelsAggregates.losses;
  const duelsKillsTotal = duelsKills || duelsAggregates.kills;
  const duelsDeathsTotal = duelsDeaths || duelsAggregates.deaths;

  const skywarsWins = Number(skywarsStats.wins ?? 0);
  const skywarsLosses = Number(skywarsStats.losses ?? 0);
  const skywarsKills = Number(skywarsStats.kills ?? 0);
  const skywarsDeaths = Number(skywarsStats.deaths ?? 0);

  const skywarsAggregates =
    !skywarsWins || !skywarsLosses || !skywarsKills || !skywarsDeaths
      ? computeAggregates(skywarsStats)
      : { wins: 0, losses: 0, kills: 0, deaths: 0 };

  const skywarsWinsTotal = skywarsWins || skywarsAggregates.wins;
  const skywarsLossesTotal = skywarsLosses || skywarsAggregates.losses;
  const skywarsKillsTotal = skywarsKills || skywarsAggregates.kills;
  const skywarsDeathsTotal = skywarsDeaths || skywarsAggregates.deaths;

  return {
    displayname: response.player?.displayname ?? null,

    // Bedwars
    bedwars_experience: (bedwarsStats as any).bedwars_experience
                       ?? (bedwarsStats as any).Experience ?? null,
    bedwars_final_kills: Number(bedwarsStats.final_kills_bedwars ?? 0),
    bedwars_final_deaths: Number(bedwarsStats.final_deaths_bedwars ?? 0),

    // Duels
    duels_wins: duelsWinsTotal,
    duels_losses: duelsLossesTotal,
    duels_kills: duelsKillsTotal,
    duels_deaths: duelsDeathsTotal,

    // SkyWars
    skywars_experience: (skywarsStats as any).skywars_experience
                       ?? (skywarsStats as any).SkyWars_experience
                       ?? (skywarsStats as any).Experience
                       ?? null,
    skywars_wins: skywarsWinsTotal,
    skywars_losses: skywarsLossesTotal,
    skywars_kills: skywarsKillsTotal,
    skywars_deaths: skywarsDeathsTotal,
  };
}
