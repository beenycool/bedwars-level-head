import axios from 'axios';
import https from 'node:https';
import CacheableLookup from 'cacheable-lookup';
import { HttpError } from '../util/httpError';
import { OUTBOUND_USER_AGENT } from '../config';

const dnsCache = new CacheableLookup({ maxTtl: 300, fallbackDuration: 0 });

const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 20,
  family: 4,
});
dnsCache.install(agent as any);

const mojangClient = axios.create({
  baseURL: 'https://api.mojang.com',
  timeout: 5000,
  httpsAgent: agent,
  headers: {
    'User-Agent': OUTBOUND_USER_AGENT,
  },
  validateStatus: (status) => status >= 200 && status < 500,
});

function normalizeRetryAfter(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === 'string');
  }

  return typeof value === 'string' ? value : undefined;
}

export interface MojangProfileResponse {
  id: string;
  name: string;
}

export async function lookupProfileByUsername(username: string): Promise<MojangProfileResponse | null> {
  try {
    const encodedUsername = encodeURIComponent(username);
    const response = await mojangClient.get<MojangProfileResponse>(
      `/users/profiles/minecraft/${encodedUsername}`
    );

    if (response.status === 200 && response.data && response.data.id) {
      return response.data;
    }

    if (response.status === 204 || response.status === 404) {
      return null;
    }

    if (response.status === 429) {
      const retryAfter = normalizeRetryAfter(response.headers['retry-after']);
      throw new HttpError(
        429,
        'MOJANG_RATE_LIMITED',
        'Mojang rate limit exceeded.',
        retryAfter ? { 'Retry-After': retryAfter } : undefined,
      );
    }

    throw new HttpError(502, 'MOJANG_ERROR', `Mojang responded with status ${response.status}.`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status;
        if (status === 429) {
          const retryAfter = normalizeRetryAfter(error.response.headers?.['retry-after']);
          throw new HttpError(
            429,
            'MOJANG_RATE_LIMITED',
            'Mojang rate limit exceeded.',
            retryAfter ? { 'Retry-After': retryAfter } : undefined,
          );
        }
        throw new HttpError(502, 'MOJANG_ERROR', `Mojang responded with status ${status}.`);
      }

      if (error.code === 'ECONNABORTED') {
        throw new HttpError(504, 'MOJANG_TIMEOUT', 'Mojang did not respond within 5 seconds.');
      }

      throw new HttpError(502, 'MOJANG_NETWORK_ERROR', 'Unable to reach Mojang.');
    }

    throw error;
  }
}
