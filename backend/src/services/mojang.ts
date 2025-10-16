import axios from 'axios';
import { HttpError } from '../util/httpError';

const mojangClient = axios.create({
  baseURL: 'https://api.mojang.com',
  timeout: 5000,
  headers: {
    'User-Agent': 'Levelhead-Proxy/1.0',
  },
  validateStatus: (status) => status >= 200 && status < 500,
});

export interface MojangProfileResponse {
  id: string;
  name: string;
}

export async function lookupProfileByUsername(username: string): Promise<MojangProfileResponse | null> {
  try {
    const response = await mojangClient.get<MojangProfileResponse>(`/users/profiles/minecraft/${username}`);

    if (response.status === 200 && response.data && response.data.id) {
      return response.data;
    }

    if (response.status === 204 || response.status === 404) {
      return null;
    }

    if (response.status === 429) {
      throw new HttpError(429, 'MOJANG_RATE_LIMIT', 'Mojang rate limit exceeded. Please try again later.');
    }

    throw new HttpError(502, 'MOJANG_ERROR', `Mojang responded with status ${response.status}.`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status;
        if (status === 429) {
          throw new HttpError(429, 'MOJANG_RATE_LIMIT', 'Mojang rate limit exceeded. Please try again later.');
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
