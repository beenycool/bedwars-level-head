import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { readFileSync } from 'node:fs';

loadEnv();

/**
 * Minimal backend configuration.
 *
 * Only `HYPIXEL_API_KEY` is mandatory. Everything else has a working default so a
 * fresh clone (or a bare render.yaml) boots and serves player data. The database is
 * optional: without `CACHE_DB_URL` the service runs from its in-process LRU cache.
 */

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

/** Optional PostgreSQL cache. Absent/blank means "in-memory cache only". */
export const CACHE_DB_URL = (process.env.CACHE_DB_URL ?? process.env.DATABASE_URL ?? '').trim();

/** Optional bearer tokens for the admin purge endpoint. Empty disables the endpoint. */
export const ADMIN_API_KEYS = splitList(process.env.ADMIN_API_KEYS);

/**
 * Optional comma-separated CIDRs for trusted reverse proxies. When unset we trust a
 * single proxy hop in production (Render/Cloudflare terminate TLS in front of us) and
 * nothing in development.
 */
export const TRUST_PROXY_CIDRS = splitList(process.env.TRUST_PROXY_CIDRS);
export const TRUST_SINGLE_PROXY_HOP = isProduction && TRUST_PROXY_CIDRS.length === 0;

/**
 * Public per-IP budget: identifiers per minute. Sized for a full BedWars hub
 * (a 100-player lobby costs 100 identifiers, and players hop lobbies).
 */
export const PUBLIC_RATE_LIMIT_MAX = Math.max(1, parseIntEnv('PUBLIC_RATE_LIMIT_MAX', 600));
export const PUBLIC_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** SQL cache retention. The in-process LRU is much shorter (see services/player.ts). */
export const PLAYER_CACHE_DB_TTL_MS = Math.max(
  60 * 60 * 1000,
  parseIntEnv('PLAYER_CACHE_DB_TTL_MS', 24 * 60 * 60 * 1000),
);

/** Hypixel circuit breaker. */
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
    // Bundled builds may not ship package.json next to dist; the version is cosmetic.
  }
  return 'dev';
}
