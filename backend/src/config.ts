import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import path from 'node:path';

loadEnv();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const HYPIXEL_API_KEY = requiredEnv('HYPIXEL_API_KEY');

function requiredStringListEnv(name: string): string[] {
  const raw = requiredEnv(name);
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new Error(`Environment variable ${name} must contain at least one value`);
  }

  return values;
}

type TrustProxyValue = false | true | number | string;

function parseTrustProxyEnv(value: string | undefined): TrustProxyValue {
  if (value === undefined) {
    return false;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (lower === 'false' || lower === '0') {
    return false;
  }

  if (lower === 'true') {
    return true;
  }

  const asNumber = Number(normalized);
  if (!Number.isNaN(asNumber)) {
    return asNumber;
  }

  return normalized;
}

export const ADMIN_API_KEYS = requiredStringListEnv('ADMIN_API_KEYS');

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

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parseBytesEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B?)$/i);
  if (!match) return defaultValue;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    '': 1,
    'B': 1,
    'K': 1024,
    'KB': 1024,
    'M': 1024 * 1024,
    'MB': 1024 * 1024,
    'G': 1024 * 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'T': 1024 * 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024,
  };
  return Math.floor(value * (multipliers[unit] || 1));
}

export const RATE_LIMIT_WINDOW_MS = parseIntEnv('RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000);
export const RATE_LIMIT_MAX = parseIntEnv('RATE_LIMIT_MAX', 300);
export const PUBLIC_RATE_LIMIT_WINDOW_MS = parseIntEnv('PUBLIC_RATE_LIMIT_WINDOW_MS', 60 * 1000);
export const PUBLIC_RATE_LIMIT_MAX = parseIntEnv('PUBLIC_RATE_LIMIT_MAX', 60);
export const DYNAMIC_RATE_LIMIT_ENABLED = parseBooleanEnv('DYNAMIC_RATE_LIMIT_ENABLED', true);
export const DYNAMIC_RATE_LIMIT_MIN = Math.max(1, parseIntEnv('DYNAMIC_RATE_LIMIT_MIN', 10));
export const DYNAMIC_RATE_LIMIT_MAX = Math.max(
  DYNAMIC_RATE_LIMIT_MIN,
  parseIntEnv('DYNAMIC_RATE_LIMIT_MAX', RATE_LIMIT_MAX),
);
export const DYNAMIC_RATE_LIMIT_CACHE_TTL_MS = Math.max(1000, parseIntEnv('DYNAMIC_RATE_LIMIT_CACHE_TTL_MS', 10000));
export const HYPIXEL_API_QUOTA = parseIntEnv('HYPIXEL_API_QUOTA', 120);

export const SERVER_PORT = parseIntEnv('PORT', 3000);
export const SERVER_HOST = process.env.HOST ?? '0.0.0.0';
export const TRUST_PROXY: TrustProxyValue = parseTrustProxyEnv(process.env.TRUST_PROXY);
export const TRUST_PROXY_ENABLED = TRUST_PROXY !== false;

export const HYPIXEL_API_BASE_URL = process.env.HYPIXEL_API_BASE_URL ?? 'https://api.hypixel.net';

export const CLOUD_FLARE_TUNNEL = process.env.CLOUDFLARE_TUNNEL ?? '';
export const COMMUNITY_SUBMIT_SECRET = process.env.COMMUNITY_SUBMIT_SECRET?.trim() ?? '';

const HOURS = 60 * 60 * 1000;
const defaultCacheTtl = 72 * HOURS;
const rawCacheTtl = parseIntEnv('CACHE_TTL_MS', defaultCacheTtl);
const minimumCacheTtl = 1 * HOURS;
const maximumCacheTtl = 72 * HOURS;

export const CACHE_TTL_MS = Math.min(Math.max(rawCacheTtl, minimumCacheTtl), maximumCacheTtl);

export const CACHE_DB_POOL_MIN = parseIntEnv('CACHE_DB_POOL_MIN', 2);
export const CACHE_DB_POOL_MAX = parseIntEnv('CACHE_DB_POOL_MAX', 20);
export const CACHE_DB_SIZE_LIMIT_BYTES = parseBytesEnv('CACHE_DB_SIZE_LIMIT_BYTES', 0);

export const HYPIXEL_TIMEOUT_MS = parseIntEnv('HYPIXEL_TIMEOUT_MS', 5 * 1000);
export const HYPIXEL_RETRY_DELAY_MIN_MS = parseIntEnv('HYPIXEL_RETRY_DELAY_MIN_MS', 50);
export const HYPIXEL_RETRY_DELAY_MAX_MS = parseIntEnv('HYPIXEL_RETRY_DELAY_MAX_MS', 150);
export const HYPIXEL_API_CALL_WINDOW_MS = parseIntEnv('HYPIXEL_API_CALL_WINDOW_MS', 5 * 60 * 1000);

export const CACHE_DB_URL = requiredEnv('CACHE_DB_URL');

function readPackageVersion(): string {
  const override = process.env.BACKEND_VERSION?.trim();
  if (override) {
    return override;
  }

  try {
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
    const raw = readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch (error) {
    console.warn('Unable to read backend package version for user-agent metadata', error);
  }

  return 'dev';
}

function resolveRevision(): string {
  const revision =
    process.env.BUILD_SHA ??
    process.env.GIT_REVISION ??
    process.env.COMMIT_SHA ??
    process.env.SOURCE_VERSION ??
    '';
  return revision.trim();
}

function buildUserAgent(version: string, revision: string): string {
  const normalizedVersion = version || 'dev';
  const normalizedRevision = revision || 'unknown';
  return `Levelhead-Proxy/${normalizedVersion} (rev:${normalizedRevision})`;
}

export const BACKEND_VERSION = readPackageVersion();
export const BUILD_REVISION = resolveRevision();
export const OUTBOUND_USER_AGENT = buildUserAgent(BACKEND_VERSION, BUILD_REVISION);

// Redis configuration for rate limiting
export const REDIS_URL = process.env.REDIS_URL ?? '';
export const REDIS_COMMAND_TIMEOUT = parseIntEnv('REDIS_COMMAND_TIMEOUT', 2000);
export const REDIS_KEY_SALT = process.env.REDIS_KEY_SALT ?? '';
export const REDIS_STATS_BUCKET_SIZE_MS = parseIntEnv('REDIS_STATS_BUCKET_SIZE_MS', 60 * 1000);
export const REDIS_STATS_CACHE_TTL_MS = parseIntEnv('REDIS_STATS_CACHE_TTL_MS', 2000);
