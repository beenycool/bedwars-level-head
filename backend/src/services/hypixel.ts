import axios from 'axios';
import type { AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';
import { HYPIXEL_API_BASE_URL, HYPIXEL_API_KEY } from '../config';
import { HttpError } from '../util/httpError';

const hypixelClient = axios.create({
  baseURL: HYPIXEL_API_BASE_URL,
  timeout: 5000,
  headers: {
    'User-Agent': 'Levelhead-Proxy/1.0',
  },
  validateStatus: (status) => status >= 200 && status < 400,
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
  lastModified?: string;
}

export interface HypixelPlayerFetchResult {
  payload?: ProxyPlayerPayload;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

function readHeader(
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders,
  name: string,
): string | undefined {
  const headerValue = headers[name.toLowerCase() as keyof typeof headers];
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue ?? undefined;
}

function shapePlayerPayload(response: HypixelPlayerResponse): ProxyPlayerPayload {
  const bedwarsStats = response.player?.stats?.Bedwars ?? {};
  const statsRecord = bedwarsStats as Record<string, unknown>;
  const experience = statsRecord['bedwars_experience'] ?? statsRecord['Experience'];

  const shapedStats: Record<string, unknown> = {
    ...statsRecord,
    ...(experience !== undefined ? { bedwars_experience: experience, Experience: experience } : {}),
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

export async function fetchHypixelPlayer(
  uuid: string,
  options: HypixelFetchOptions = {},
): Promise<HypixelPlayerFetchResult> {
  try {
    const response = await hypixelClient.get<HypixelPlayerResponse>('/v2/player', {
      params: { uuid },
      headers: {
        'API-Key': HYPIXEL_API_KEY,
        ...(options.etag ? { 'If-None-Match': options.etag } : {}),
        ...(options.lastModified ? { 'If-Modified-Since': options.lastModified } : {}),
      },
    });

    const etag = readHeader(response.headers, 'etag');
    const lastModified = readHeader(response.headers, 'last-modified');

    if (response.status === 304) {
      return {
        notModified: true,
        etag: etag ?? options.etag,
        lastModified: lastModified ?? options.lastModified,
      };
    }

    if (!response.data.success) {
      const cause = response.data.cause ?? 'UNKNOWN_HYPIXEL_ERROR';
      throw new HttpError(502, cause, 'Hypixel returned an error response.');
    }

    return {
      payload: shapePlayerPayload(response.data),
      etag,
      lastModified,
      notModified: false,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status;
        if (status === 403) {
          throw new HttpError(502, 'HYPIXEL_FORBIDDEN', 'Hypixel rejected the backend API key.');
        }
        throw new HttpError(502, 'HYPIXEL_ERROR', `Hypixel responded with status ${status}.`);
      }

      if (error.code === 'ECONNABORTED') {
        throw new HttpError(504, 'HYPIXEL_TIMEOUT', 'Hypixel did not respond within 5 seconds.');
      }

      throw new HttpError(502, 'HYPIXEL_NETWORK_ERROR', 'Unable to reach Hypixel.');
    }

    throw error;
  }
}
