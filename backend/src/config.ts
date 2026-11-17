import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { readFileSync } from 'node:fs';

loadEnv();

const isProduction = process.env.NODE_ENV === 'production';

export const HYPIXEL_API_BASE_URL = process.env.HYPIXEL_API_BASE_URL ?? 'https://api.hypixel.net';

/**
 * The key the proxy owns on behalf of every client. Required because the whole point
 * of this service is to hold one non-expiring key instead of shipping keys to users.
 */
export const HYPIXEL_API_KEY = requireEnv('HYPIXEL_API_KEY');
export const HYPIXEL_TIMEOUT_MS = parseIntEnv('HYPIXEL_TIMEOUT_MS', 5000);
export const HYPIXEL_RETRY_DELAY_MIN_MS = parseIntEnv('HYPIXEL_RETRY_DELAY_MIN_MS', 50);
export const HYPIXEL_RETRY_DELAY_MAX_MS = parseIntEnv('HYPIXEL_RETRY_DELAY_MAX_MS', 150);

/**
 * Global cap on concurrent Hypixel requests. Cold lookups open fresh TLS
 * connections, and a lobby join can fire a dozen at once; capping keeps that
 * burst from turning into multi-second connect stalls. Queueing is cheap
 * compared with the upstream request itself.
 */
export const HYPIXEL_MAX_CONCURRENCY = Math.max(1, parseIntEnv('HYPIXEL_MAX_CONCURRENCY', 6));

/**
 * Outbound pacing. Hypixel also throttles bursts that stay under the 5-minute
 * quota, so a small token bucket spreads a lobby join over a second or two
 * instead of firing dozens in the same tick. Normal traffic (a couple of
 * lookups per second) never waits.
 */
export const HYPIXEL_REQUESTS_PER_SECOND = Math.max(1, parseFloatEnv('HYPIXEL_REQUESTS_PER_SECOND', 5));
export const HYPIXEL_BURST_CAPACITY = Math.max(1, parseIntEnv('HYPIXEL_BURST_CAPACITY', 4));

export const CACHE_DB_URL = (process.env.CACHE_DB_URL ?? process.env.DATABASE_URL ?? '').trim();

export const ADMIN_API_KEYS = splitList(process.env.ADMIN_API_KEYS);

/**
 * Optional comma-separated CIDRs for trusted reverse proxies. When unset we trust a
 * single proxy hop in production (Render/Cloudflare terminate TLS in front of us) and
 * nothing in development.
 */
export const TRUST_PROXY_CIDRS = splitList(process.env.TRUST_PROXY_CIDRS);
export const TRUST_SINGLE_PROXY_HOP = isProduction && TRUST_PROXY_CIDRS.length === 0;

export const PUBLIC_RATE_LIMIT_MAX = Math.max(1, parseIntEnv('PUBLIC_RATE_LIMIT_MAX', 600));
export const PUBLIC_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Every HTTP request still costs one request token, even when it is served from
 * cache. This is a much higher ceiling than the identifier budget: it exists only to
 * stop a cached-request flood, not to charge normal mod traffic.
 */
export const PUBLIC_REQUEST_LIMIT_MAX = Math.max(
  PUBLIC_RATE_LIMIT_MAX,
  Math.max(1, parseIntEnv('PUBLIC_REQUEST_LIMIT_MAX', 1_200)),
);

/**
 * Dynamic per-client budgets. Instead of handing every IP the same fixed budget,
 * the limiter divides the remaining Hypixel quota between active clients and
 * throttles further when recent demand is high. Cached lookups cost no quota, so
 * the cache hit rate widens the budget.
 */
export const DYNAMIC_RATE_LIMIT_ENABLED = parseBooleanEnv('DYNAMIC_RATE_LIMIT_ENABLED', true);
export const DYNAMIC_RATE_LIMIT_MIN = Math.min(
  PUBLIC_RATE_LIMIT_MAX,
  Math.max(1, parseIntEnv('DYNAMIC_RATE_LIMIT_MIN', 20)),
);
export const DYNAMIC_RATE_LIMIT_MAX = Math.min(
  PUBLIC_RATE_LIMIT_MAX,
  Math.max(
    DYNAMIC_RATE_LIMIT_MIN,
    parseIntEnv('DYNAMIC_RATE_LIMIT_MAX', PUBLIC_RATE_LIMIT_MAX),
  ),
);
export const DYNAMIC_RATE_LIMIT_CACHE_TTL_MS = Math.max(
  1000,
  parseIntEnv('DYNAMIC_RATE_LIMIT_CACHE_TTL_MS', 10_000),
);

export const HYPIXEL_HOURLY_QUOTA = Math.max(60, parseIntEnv('HYPIXEL_HOURLY_QUOTA', 7_200));

export const LOOKUP_TRACKING_ENABLED = process.env.LOOKUP_TRACKING_ENABLED !== 'false';

export const LOOKUP_LOG_RETENTION_DAYS = Math.max(
  1,
  parseIntEnv('LOOKUP_LOG_RETENTION_DAYS', 30),
);

export const PLAYER_CACHE_DB_TTL_MS = Math.max(
  60 * 60 * 1000,
  parseIntEnv('PLAYER_CACHE_DB_TTL_MS', 24 * 60 * 60 * 1000),
);

export const CB_FAILURE_THRESHOLD = Math.max(1, parseIntEnv('CB_FAILURE_THRESHOLD', 5));
export const CB_RESET_TIMEOUT_MS = Math.max(1000, parseIntEnv('CB_RESET_TIMEOUT_MS', 30000));

export const SERVER_PORT = parseIntEnv('PORT', 3000);
export const SERVER_HOST = process.env.HOST ?? '0.0.0.0';

export const BACKEND_VERSION = readPackageVersion();
export const OUTBOUND_USER_AGENT = `Levelhead-Proxy/${BACKEND_VERSION}`;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required but not set.\n` +
        'Set it in your environment or .env file. Obtain a key at https://developer.hypixel.net/',
    );
  }
  return value;
}

function splitList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseFloatEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined) {
    return defaultValue;
  }
  if (['true', '1', 'yes', 'on'].includes(raw)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(raw)) {
    return false;
  }
  return defaultValue;
}

function readPackageVersion(): string {
  const override = process.env.BACKEND_VERSION?.trim();
  if (override) {
    return override;
  }
  try {
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
  }
  return 'dev';
}
