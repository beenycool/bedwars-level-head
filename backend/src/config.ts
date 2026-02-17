import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ipaddr from 'ipaddr.js';

loadEnv();
const isProduction = process.env.NODE_ENV === 'production';
export const CLOUD_FLARE_TUNNEL = process.env.CLOUDFLARE_TUNNEL ?? '';

interface MissingField {
  name: string;
  description: string;
  format: string;
}

const missingFields: MissingField[] = [];

function checkRequiredEnv(name: string, description: string, format: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    missingFields.push({ name, description, format });
    return undefined;
  }
  return value;
}

function requiredEnv(name: string, description: string, format: string): string | undefined {
  return checkRequiredEnv(name, description, format);
}

function buildMissingFieldsError(): string {
  if (missingFields.length === 0) {
    return 'Missing required environment variables';
  }

  if (missingFields.length === 1) {
    const field = missingFields[0];
    return `${field.name} is required but not set in environment\n\n` +
           `Description: ${field.description}\n` +
           `Expected format: ${field.format}\n\n` +
           `To fix: Set ${field.name} in your .env file or environment`;
  }

  const fieldList = missingFields.map(f => f.name).join(', ');
  const details = missingFields.map(f => 
    `  - ${f.name}: ${f.description}\n    Format: ${f.format}`
  ).join('\n\n');

  return `Missing required environment variables: ${fieldList}\n\n` +
         `Details:\n${details}\n\n` +
         `To fix: Set these variables in your .env file or environment`;
}

const HYPIXEL_API_KEY_VALUE = checkRequiredEnv(
  'HYPIXEL_API_KEY',
  'Your Hypixel API key for fetching player data',
  'A valid Hypixel API key (obtain from https://developer.hypixel.net/)'
);

function requiredStringListEnv(name: string, description: string, format: string): string[] {
  const raw = requiredEnv(name, description, format);
  if (raw === undefined) {
    return [];
  }

  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new Error(
      `Environment variable ${name} must contain at least one value\n\n` +
      `Expected format: ${format}\n` +
      `Example: value1,value2,value3`
    );
  }

  return values;
}

function optionalStringListEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

// IPv4 CIDR validation regex: matches 0.0.0.0/0 to 255.255.255.255/32
const IPV4_CIDR_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

// IPv6 CIDR validation regex: matches valid IPv6 CIDR notation
const IPV6_CIDR_REGEX = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\/(\d{1,3})$|^::1\/(\d{1,3})$/;

function isValidIPv4CIDR(cidr: string): boolean {
  const match = IPV4_CIDR_REGEX.exec(cidr);
  if (!match) return false;
  const [, a, b, c, d, prefix] = match;
  const octets = [a, b, c, d].map(Number);
  const prefixNum = Number(prefix);
  return octets.every((o) => o >= 0 && o <= 255) && prefixNum >= 0 && prefixNum <= 32;
}

function isValidIPv6CIDR(cidr: string): boolean {
  if (IPV6_CIDR_REGEX.test(cidr)) return true;

  try {
    const [addr, prefix] = ipaddr.parseCIDR(cidr);
    return addr.kind() === 'ipv6' && prefix >= 0 && prefix <= 128;
  } catch {
    return false;
  }
}

function isValidCIDR(cidr: string): boolean {
  return isValidIPv4CIDR(cidr) || isValidIPv6CIDR(cidr);
}

function isTooPermissiveCIDR(cidr: string): boolean {
  return cidr === '0.0.0.0/0' || cidr === '::/0';
}

function parseCIDRListEnv(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    // Default to loopback only
    return ['127.0.0.1/32', '::1/128'];
  }

  const cidrs = value
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  // Validate each CIDR and filter out invalid ones
  const validCidrs = cidrs.filter((cidr) => {
    if (!isValidCIDR(cidr)) {
      console.warn(`[config] Invalid CIDR in TRUST_PROXY_CIDRS: "${cidr}" — skipping`);
      return false;
    }
    return true;
  });

  // Warn about too permissive CIDRs
  for (const cidr of validCidrs) {
    if (isTooPermissiveCIDR(cidr)) {
      console.warn(`[config] WARNING: TRUST_PROXY_CIDRS includes ${cidr} which is too permissive and may allow IP spoofing`);
    }
  }

  return validCidrs;
}

const CACHE_DB_URL_VALUE = checkRequiredEnv(
  'CACHE_DB_URL',
  'Database connection string for caching player data',
  'PostgreSQL: postgresql://user:pass@host:port/dbname\n' +
  '    Azure SQL: sqlserver://user:pass@host:port/database'
);

const ADMIN_API_KEYS_VALUE = checkRequiredEnv(
  'ADMIN_API_KEYS',
  'Comma-separated list of admin API tokens for administrative endpoints',
  'Comma-separated list of secure random tokens (e.g., tok1,tok2,tok3)'
);

// Validate all required fields together and throw comprehensive error if any are missing

// Require TRUST_PROXY_CIDRS in production or when explicitly behind a proxy (e.g., Cloudflare Tunnel)
if (isProduction || CLOUD_FLARE_TUNNEL.length > 0) {
  checkRequiredEnv(
    'TRUST_PROXY_CIDRS',
    'Allowed CIDR ranges for trusted reverse proxies (required in production for IP security)',
    'Comma-separated list of CIDRs (e.g., 127.0.0.1/32,10.0.0.0/8,172.16.0.0/12)'
  );
}
if (missingFields.length > 0) {
  throw new Error(buildMissingFieldsError());
}

// Now we can safely export these since we've validated they exist
export const HYPIXEL_API_KEY = HYPIXEL_API_KEY_VALUE!;
export const ADMIN_API_KEYS = ADMIN_API_KEYS_VALUE!
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
if (ADMIN_API_KEYS.length === 0) {
  throw new Error(
    'ADMIN_API_KEYS must contain at least one value\n\n' +
    'Expected format: Comma-separated list of secure random tokens (e.g., tok1,tok2,tok3)',
  );
}
export const CACHE_DB_URL = CACHE_DB_URL_VALUE!;

export const CRON_API_KEYS = optionalStringListEnv('CRON_API_KEYS');

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

function parseFloatEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseFloat(raw);
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

export const RATE_LIMIT_WINDOW_MS = parseIntEnv('RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000);
export const RATE_LIMIT_MAX = parseIntEnv('RATE_LIMIT_MAX', 300);
export const PUBLIC_RATE_LIMIT_WINDOW_MS = parseIntEnv('PUBLIC_RATE_LIMIT_WINDOW_MS', 60 * 1000);
export const PUBLIC_RATE_LIMIT_MAX = parseIntEnv('PUBLIC_RATE_LIMIT_MAX', 60);
export const CRON_RATE_LIMIT_WINDOW_MS = parseIntEnv('CRON_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000);
export const CRON_RATE_LIMIT_MAX = parseIntEnv('CRON_RATE_LIMIT_MAX', 10);
export const ADMIN_RATE_LIMIT_WINDOW_MS = parseIntEnv('ADMIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
export const ADMIN_RATE_LIMIT_MAX = parseIntEnv('ADMIN_RATE_LIMIT_MAX', 50);
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
export const TRUST_PROXY_CIDRS: string[] = parseCIDRListEnv(process.env.TRUST_PROXY_CIDRS);
export const TRUST_PROXY_ENABLED = TRUST_PROXY_CIDRS.length > 0;

export const HYPIXEL_API_BASE_URL = process.env.HYPIXEL_API_BASE_URL ?? 'https://api.hypixel.net';

export const COMMUNITY_SUBMIT_SECRET = process.env.COMMUNITY_SUBMIT_SECRET?.trim() ?? '';

const HOURS = 60 * 60 * 1000;
const defaultCacheTtl = 72 * HOURS;
const rawCacheTtl = parseIntEnv('CACHE_TTL_MS', defaultCacheTtl);
const minimumCacheTtl = 1 * HOURS;
const maximumCacheTtl = 72 * HOURS;

export const CACHE_TTL_MS = Math.min(Math.max(rawCacheTtl, minimumCacheTtl), maximumCacheTtl);

export const PLAYER_L2_TTL_MS = Math.min(
  Math.max(parseIntEnv('PLAYER_L2_TTL_MS', defaultCacheTtl), minimumCacheTtl),
  maximumCacheTtl,
);
export const IGN_L2_TTL_MS = Math.min(
  Math.max(parseIntEnv('IGN_L2_TTL_MS', PLAYER_L2_TTL_MS), minimumCacheTtl),
  maximumCacheTtl,
);
export const PLAYER_L1_TTL_MIN_MS = Math.max(60 * 1000, parseIntEnv('PLAYER_L1_TTL_MIN_MS', 15 * 60 * 1000));
export const PLAYER_L1_TTL_MAX_MS = Math.max(
  PLAYER_L1_TTL_MIN_MS,
  parseIntEnv('PLAYER_L1_TTL_MAX_MS', 6 * 60 * 60 * 1000),
);
export const PLAYER_L1_TTL_FALLBACK_MS = Math.min(
  Math.max(parseIntEnv('PLAYER_L1_TTL_FALLBACK_MS', 2 * 60 * 60 * 1000), PLAYER_L1_TTL_MIN_MS),
  PLAYER_L1_TTL_MAX_MS,
);
export const PLAYER_L1_TARGET_UTILIZATION = Math.min(
  Math.max(parseFloatEnv('PLAYER_L1_TARGET_UTILIZATION', 0.7), 0.1),
  0.95,
);
export const PLAYER_L1_SAFETY_FACTOR = Math.min(
  Math.max(parseFloatEnv('PLAYER_L1_SAFETY_FACTOR', 0.6), 0.1),
  1,
);
export const PLAYER_L1_INFO_REFRESH_MS = Math.max(30 * 1000, parseIntEnv('PLAYER_L1_INFO_REFRESH_MS', 5 * 60 * 1000));
export const REDIS_CACHE_MAX_BYTES = Math.max(0, parseIntEnv('REDIS_CACHE_MAX_BYTES', 30 * 1024 * 1024));
export const CACHE_DB_WARM_WINDOW_MS = Math.max(0, parseIntEnv('CACHE_DB_WARM_WINDOW_MS', 15 * 60 * 1000));
export const CACHE_DB_ALLOW_COLD_READS = parseBooleanEnv('CACHE_DB_ALLOW_COLD_READS', false);

export const CACHE_DB_POOL_MIN = parseIntEnv('CACHE_DB_POOL_MIN', 2);
export const CACHE_DB_POOL_MAX = parseIntEnv('CACHE_DB_POOL_MAX', 20);

export const HYPIXEL_TIMEOUT_MS = parseIntEnv('HYPIXEL_TIMEOUT_MS', 5 * 1000);
export const HYPIXEL_RETRY_DELAY_MIN_MS = parseIntEnv('HYPIXEL_RETRY_DELAY_MIN_MS', 50);
export const HYPIXEL_RETRY_DELAY_MAX_MS = parseIntEnv('HYPIXEL_RETRY_DELAY_MAX_MS', 150);
export const HYPIXEL_API_CALL_WINDOW_MS = parseIntEnv('HYPIXEL_API_CALL_WINDOW_MS', 5 * 60 * 1000);

export const DATABASE_TYPE = CACHE_DB_URL.startsWith('sqlserver://') || CACHE_DB_URL.startsWith('mssql://')
  ? 'AZURE_SQL'
  : 'POSTGRESQL';

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

// Rate limiting Redis requirements for multi-instance deployments
// In production with multiple instances, Redis should be mandatory to ensure
// consistent rate limiting across all instances. Without Redis, each instance
// maintains its own rate limits, allowing attackers to bypass limits by hitting
// different instances.
export const RATE_LIMIT_REQUIRE_REDIS = parseBooleanEnv('RATE_LIMIT_REQUIRE_REDIS', isProduction);

// Fallback mode when Redis is unavailable and RATE_LIMIT_REQUIRE_REDIS=true:
// - 'deny': Reject all requests with 503 (safest for production)
// - 'allow': Allow all requests (dangerous, only use if downtime is worse)
// - 'memory': Use in-memory rate limiting with warnings (per-instance limits)
const validFallbackModes = ['deny', 'allow', 'memory'] as const;
type FallbackMode = typeof validFallbackModes[number];
function parseFallbackModeEnv(name: string, defaultValue: FallbackMode): FallbackMode {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const normalized = raw.toLowerCase().trim();
  if (validFallbackModes.includes(normalized as FallbackMode)) {
    return normalized as FallbackMode;
  }
  console.warn(`[config] Invalid ${name}: "${raw}". Using default: ${defaultValue}`);
  return defaultValue;
}
export const RATE_LIMIT_FALLBACK_MODE: FallbackMode = parseFallbackModeEnv('RATE_LIMIT_FALLBACK_MODE', 'memory');

// Circuit breaker configuration for Hypixel API resilience
// CB_FAILURE_THRESHOLD: Number of consecutive failures before opening the circuit
// CB_RESET_TIMEOUT_MS: Time in milliseconds before attempting to reset (half-open state)
// CB_MIN_REQUESTS: Minimum number of requests required before the circuit can open
export const CB_FAILURE_THRESHOLD = Math.max(1, parseIntEnv('CB_FAILURE_THRESHOLD', 5));
export const CB_RESET_TIMEOUT_MS = Math.max(1000, parseIntEnv('CB_RESET_TIMEOUT_MS', 30000));
export const CB_MIN_REQUESTS = Math.max(0, parseIntEnv('CB_MIN_REQUESTS', 3));

// Submission nonce validation TTL (default 5 minutes = 300000ms)
// Used for replay protection on signed player data submissions
export const SUBMISSION_TTL_MS = Math.max(1000, parseIntEnv('SUBMISSION_TTL_MS', 5 * 60 * 1000));

// Stale-While-Revalidate (SWR) caching configuration
// SWR allows serving stale data immediately while refreshing in the background
export const SWR_ENABLED = parseBooleanEnv('SWR_ENABLED', true);
export const SWR_STALE_TTL_MS = Math.max(0, parseIntEnv('SWR_STALE_TTL_MS', 5 * 60 * 1000));
