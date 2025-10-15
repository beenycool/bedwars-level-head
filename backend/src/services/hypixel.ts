import axios from 'axios';
import { HYPIXEL_API_BASE_URL, HYPIXEL_API_KEY } from '../config';
import { HttpError } from '../util/httpError';

const hypixelClient = axios.create({
  baseURL: HYPIXEL_API_BASE_URL,
  timeout: 5000,
  headers: {
    'User-Agent': 'Levelhead-Proxy/1.0',
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
  data?: {
    bedwars?: Record<string, unknown>;
  };
  bedwars?: Record<string, unknown>;
  player?: {
    stats?: {
      Bedwars?: Record<string, unknown>;
    };
  };
}

export async function fetchPlayer(uuid: string): Promise<ProxyPlayerPayload> {
  try {
    const response = await hypixelClient.get<HypixelPlayerResponse>('/player', {
      params: { uuid },
      headers: {
        'API-Key': HYPIXEL_API_KEY,
      },
    });

    if (!response.data.success) {
      const cause = response.data.cause ?? 'UNKNOWN_HYPIXEL_ERROR';
      throw new HttpError(502, cause, 'Hypixel returned an error response.');
    }

    const bedwarsStats = response.data.player?.stats?.Bedwars ?? {};
    const experience = (bedwarsStats as { bedwars_experience?: number; Experience?: number }).bedwars_experience ??
      (bedwarsStats as { Experience?: number }).Experience;

    const shapedStats: Record<string, unknown> = {
      ...bedwarsStats,
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
