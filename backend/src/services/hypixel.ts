import axios, { type AxiosResponseHeaders, type RawAxiosResponseHeaders } from 'axios';
import https from 'node:https';
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

// Create a dedicated HTTPS Agent
const agent = new https.Agent({
  keepAlive: true,      // Reuse connections (Huge speedup for batches)
  keepAliveMsecs: 1000,
  family: 4,            // Force IPv4 to prevent 2s timeouts
});

const hypixelClient = axios.create({
  baseURL: HYPIXEL_API_BASE_URL,
  timeout: HYPIXEL_TIMEOUT_MS,
  httpsAgent: agent,    // Attach the agent here
  headers: {
    'User-Agent': OUTBOUND_USER_AGENT,
  },
});

export interface HypixelPlayerResponse {
  success: boolean;
  cause?: string;
  player?: {
    uuid?: string;
    stats?: {
      Bedwars?: Record<string, unknown>;
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
    stats?: {
      Bedwars?: Record<string, unknown>;
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

  return {
    success: true,
    data: {
      bedwars: shapedStats,
    },
    bedwars: shapedStats,
    player: {
      stats: {
        Bedwars: shapedStats,
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
