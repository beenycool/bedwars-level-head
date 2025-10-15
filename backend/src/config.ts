import { config as loadEnv } from 'dotenv';

loadEnv();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const HYPIXEL_API_KEY = requiredEnv('HYPIXEL_API_KEY');

const rawTokens = process.env.PROXY_AUTH_TOKENS ?? '';
export const PROXY_AUTH_TOKENS = new Set(
  rawTokens
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
);

if (PROXY_AUTH_TOKENS.size === 0) {
  throw new Error('PROXY_AUTH_TOKENS must include at least one token.');
}

function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

export const RATE_LIMIT_WINDOW_MS = parseIntEnv('RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000);
export const RATE_LIMIT_MAX = parseIntEnv('RATE_LIMIT_MAX', 300);

export const SERVER_PORT = parseIntEnv('PORT', 3000);
export const SERVER_HOST = process.env.HOST ?? '0.0.0.0';

export const HYPIXEL_API_BASE_URL = process.env.HYPIXEL_API_BASE_URL ?? 'https://api.hypixel.net';

export const CLOUD_FLARE_TUNNEL = process.env.CLOUDFLARE_TUNNEL ?? '';
