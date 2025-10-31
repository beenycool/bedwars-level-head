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
export const PUBLIC_RATE_LIMIT_WINDOW_MS = parseIntEnv('PUBLIC_RATE_LIMIT_WINDOW_MS', 60 * 1000);
export const PUBLIC_RATE_LIMIT_MAX = parseIntEnv('PUBLIC_RATE_LIMIT_MAX', 60);

export const SERVER_PORT = parseIntEnv('PORT', 3000);
export const SERVER_HOST = process.env.HOST ?? '0.0.0.0';

export const HYPIXEL_API_BASE_URL = process.env.HYPIXEL_API_BASE_URL ?? 'https://api.hypixel.net';

export const CLOUD_FLARE_TUNNEL = process.env.CLOUDFLARE_TUNNEL ?? '';

const HOURS = 60 * 60 * 1000;
const defaultCacheTtl = 24 * HOURS;
const rawCacheTtl = parseIntEnv('CACHE_TTL_MS', defaultCacheTtl);
const minimumCacheTtl = 1 * HOURS;
const maximumCacheTtl = 24 * HOURS;

export const CACHE_TTL_MS = Math.min(Math.max(rawCacheTtl, minimumCacheTtl), maximumCacheTtl);

export const CACHE_DB_POOL_MIN = parseIntEnv('CACHE_DB_POOL_MIN', 0);
export const CACHE_DB_POOL_MAX = parseIntEnv('CACHE_DB_POOL_MAX', 10);

export const HYPIXEL_TIMEOUT_MS = parseIntEnv('HYPIXEL_TIMEOUT_MS', 5 * 1000);
export const HYPIXEL_RETRY_DELAY_MIN_MS = parseIntEnv('HYPIXEL_RETRY_DELAY_MIN_MS', 50);
export const HYPIXEL_RETRY_DELAY_MAX_MS = parseIntEnv('HYPIXEL_RETRY_DELAY_MAX_MS', 150);

export const CACHE_DB_URL = requiredEnv('CACHE_DB_URL');
