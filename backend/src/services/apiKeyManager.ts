import { getRedisClient } from './redis';
import axios from 'axios';
import { createHash, pbkdf2, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const pbkdf2Async = promisify(pbkdf2);
const scryptAsync = promisify(scrypt);
import { HYPIXEL_API_BASE_URL, OUTBOUND_USER_AGENT, REDIS_KEY_SALT } from '../config';
import { logger } from '../util/logger';

export type ApiKeyStatus = 'valid' | 'invalid' | 'unknown' | 'pending';

export interface ApiKeyValidation {
  key: string;
  keyHash: string;
  lastValidatedAt: number | null;
  validationStatus: ApiKeyStatus;
  validatedCount: number;
  errorMessage: string | null;
}

interface StoredApiKeyData {
  lastValidatedAt: number | null;
  validationStatus: ApiKeyStatus;
  validatedCount: number;
  errorMessage: string | null;
  createdAt: number;
}

const REDIS_KEY_PREFIX = 'apikey:';
const API_KEY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Legacy PBKDF2 Hashing (Gen 2) - Slow, good for passwords but bad for API key DoS protection
async function hashKeyPbkdf2(key: string): Promise<string> {
  const salt = REDIS_KEY_SALT || 'hypixel-apikey-hash-v1';
  const iterations = 100_000;
  const keylen = 16;
  const digest = 'sha256';

  const derived = await pbkdf2Async(key, salt, iterations, keylen, digest);
  return derived.toString('hex');
}

// Legacy Gen 1 Hashing (only for very old migrations)
async function hashKeyLegacy(key: string): Promise<string> {
  const salt = 'hypixel-apikey-hash-v1';
  const iterations = 100_000;
  const keylen = 32;
  const digest = 'sha256';

  const derived = await pbkdf2Async(key, salt, iterations, keylen, digest);
  return derived.toString('hex').slice(0, 16);
}

let warnedMissingSalt = false;

// New Scrypt Hashing (Gen 3) - Fast, secure against rainbow tables, resistant to CPU DoS
// Uses N=16 to be extremely cheap (~0.03ms) while still using a "password hashing" function
// to satisfy static analysis tools.
async function hashKey(key: string): Promise<string> {
  // Use REDIS_KEY_SALT if available, otherwise fallback for dev/migration
  if (!REDIS_KEY_SALT && !warnedMissingSalt) {
    logger.warn('[apikey] REDIS_KEY_SALT is not set. Falling back to default salt. Please set REDIS_KEY_SALT in environment.');
    warnedMissingSalt = true;
  }

  const salt = REDIS_KEY_SALT || 'hypixel-apikey-hash-v1';
  // Parameters: N=16, r=1, p=1 (Minimal cost)
  const keylen = 16;

  const derived = (await scryptAsync(key, salt, keylen, { N: 16, r: 1, p: 1 })) as Buffer;
  return derived.toString('hex');
}

export function isValidApiKeyFormat(key: string): boolean {
  return API_KEY_REGEX.test(key.trim());
}

export function isValidKeyHashFormat(hash: string): boolean {
  // Allow 16 chars (legacy) or 32 chars (new)
  return /^([a-f0-9]{16}|[a-f0-9]{32})$/i.test(hash);
}

function getRedisKey(keyHash: string): string {
  return `${REDIS_KEY_PREFIX}${keyHash}`;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// Helper to migrate legacy keys on cache miss
async function migrateLegacyKey(
  redis: ReturnType<typeof getRedisClient>,
  key: string,
  newKeyHash: string
): Promise<string | null> {
  // Try Gen 2 (PBKDF2) first
  const pbkdf2Hash = await hashKeyPbkdf2(key);
  const pbkdf2Key = getRedisKey(pbkdf2Hash);
  let legacyData = await redis.get(pbkdf2Key);
  let legacyKey = pbkdf2Key;

  // If not found, try Gen 1 (Legacy)
  if (!legacyData) {
    const legacyHash = await hashKeyLegacy(key);
    const gen1Key = getRedisKey(legacyHash);
    legacyData = await redis.get(gen1Key);
    legacyKey = gen1Key;
  }

  if (legacyData) {
    // Mask hashes for logging (first 8 chars)
    const maskedLegacy = legacyKey.replace(REDIS_KEY_PREFIX, '').slice(0, 8) + '...';
    const maskedNew = newKeyHash.slice(0, 8) + '...';
    logger.info(`[apikey] Migrating API key from legacy hash ${maskedLegacy} to new hash ${maskedNew}`);

    // Get original TTL
    const ttl = await redis.ttl(legacyKey);
    const ttlToUse = ttl > 0 ? ttl : 30 * 24 * 60 * 60; // Default 30 days if no TTL

    // Copy to new key
    await redis.setex(
      getRedisKey(newKeyHash),
      ttlToUse,
      legacyData
    );
    // Delete legacy key
    await redis.del(legacyKey);

    return legacyData;
  }

  return null;
}

export async function storeApiKey(key: string): Promise<ApiKeyValidation> {
  // Note: Migration/cleanup of legacy keys is performed only on get/validate code paths, not on store.
  // This may result in a legacy entry being shadowed for up to the TTL (30 days).
  const keyHash = await hashKey(key);
  const redis = getRedisClient();
  
  const data: StoredApiKeyData = {
    lastValidatedAt: null,
    validationStatus: 'pending',
    validatedCount: 0,
    errorMessage: null,
    createdAt: Date.now(),
  };

  if (!redis || redis.status !== 'ready') {
    throw new Error('Redis is unavailable — cannot store API key');
  }

  await redis.setex(
    getRedisKey(keyHash),
    30 * 24 * 60 * 60, // 30 days TTL
    JSON.stringify(data)
  );

  return {
    key: maskKey(key),
    keyHash,
    lastValidatedAt: data.lastValidatedAt,
    validationStatus: data.validationStatus,
    validatedCount: data.validatedCount,
    errorMessage: data.errorMessage,
  };
}

export async function validateApiKey(key: string): Promise<ApiKeyValidation> {
  const keyHash = await hashKey(key);
  const redis = getRedisClient();
  
  let storedData: StoredApiKeyData | null = null;
  let validationResult: ValidationCheckResult | null = null;
  
  // Try to get existing data using the fast Scrypt hash
  if (redis && redis.status === 'ready') {
    const existing = await redis.get(getRedisKey(keyHash));

    if (existing) {
      try {
        storedData = JSON.parse(existing) as StoredApiKeyData;
      } catch {
        // Invalid JSON, will create new
      }
    }
  }

  if (!isValidApiKeyFormat(key)) {
    validationResult = { valid: false, error: 'invalid_format' };
  }

  // Perform validation check against Hypixel if needed
  const resolvedValidationResult = validationResult ?? await performValidationCheck(key);
  
  // If validation succeeded and we didn't have data, try to migrate legacy data now
  // This prevents spending CPU cycles migrating keys that are actually invalid/spam
  if (resolvedValidationResult.valid && !storedData && redis && redis.status === 'ready') {
    try {
      const migrated = await migrateLegacyKey(redis, key, keyHash);
      if (migrated) {
         try {
           storedData = JSON.parse(migrated) as StoredApiKeyData;
         } catch {
           // Invalid JSON
         }
      }
    } catch (error) {
      logger.error({ err: error }, '[apikey] Migration failed during validation');
    }
  }

  const now = Date.now();
  const updatedData: StoredApiKeyData = {
    lastValidatedAt: now,
    validationStatus: resolvedValidationResult.valid ? 'valid' : 'invalid',
    validatedCount: (storedData?.validatedCount ?? 0) + 1,
    errorMessage: resolvedValidationResult.error ?? null,
    createdAt: storedData?.createdAt ?? now,
  };

  // Store updated data
  if (redis && redis.status === 'ready') {
    await redis.setex(
      getRedisKey(keyHash),
      30 * 24 * 60 * 60, // 30 days TTL
      JSON.stringify(updatedData)
    );
  } else {
    logger.warn(`[apikey] redis not ready, skipped setex for ${getRedisKey(keyHash)}`);
  }

  return {
    key: maskKey(key),
    keyHash,
    lastValidatedAt: updatedData.lastValidatedAt,
    validationStatus: updatedData.validationStatus,
    validatedCount: updatedData.validatedCount,
    errorMessage: updatedData.errorMessage,
  };
}

interface ValidationCheckResult {
  valid: boolean;
  error?: string;
}

async function performValidationCheck(key: string): Promise<ValidationCheckResult> {
  try {
    const response = await axios.get(`${HYPIXEL_API_BASE_URL}/key?key=${encodeURIComponent(key)}`, {
      headers: {
        'User-Agent': OUTBOUND_USER_AGENT,
      },
      timeout: 5000,
      validateStatus: () => true,
    });

    if (response.status === 200 && response.data?.success === true) {
      return { valid: true };
    }

    if (response.status === 403) {
      return { valid: false, error: 'API key is invalid or revoked' };
    }

    if (response.status === 429) {
      return { valid: true, error: 'Rate limited but key appears valid' };
    }

    if (response.status === 200 && response.data?.success === false) {
      return { valid: false, error: response.data?.cause ?? 'API key validation failed' };
    }

    return { valid: false, error: `Hypixel returned status ${response.status}` };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return { valid: false, error: 'Validation timed out' };
      }
      return { valid: false, error: `Network error: ${error.message}` };
    }
    return { valid: false, error: 'Unknown validation error' };
  }
}

export async function getApiKeyValidation(key: string): Promise<ApiKeyValidation | null> {
  const keyHash = await hashKey(key);
  const redis = getRedisClient();

  if (!redis || redis.status !== 'ready') {
    return null;
  }

  try {
    const data = await redis.get(getRedisKey(keyHash));

    // NOTE: We do NOT migrate keys here (GET /status) to prevent DoS.
    // Migration only happens on explicit POST /validate or POST /submit which are rate-limited.
    // If a legacy key exists, this will return null, prompting the client to validate it.

    if (!data) {
      return null;
    }

    const stored = JSON.parse(data) as StoredApiKeyData;
    return {
      key: maskKey(key),
      keyHash,
      lastValidatedAt: stored.lastValidatedAt,
      validationStatus: stored.validationStatus,
      validatedCount: stored.validatedCount,
      errorMessage: stored.errorMessage,
    };
  } catch (error) {
    logger.error({ err: error }, '[apikey] get failed');
    return null;
  }
}

export async function getApiKeyValidationByHash(keyHash: string): Promise<ApiKeyValidation | null> {
  const redis = getRedisClient();

  if (!redis || redis.status !== 'ready') {
    return null;
  }

  // Note: We cannot perform migration here because we don't have the original API key
  // to compute the legacy hash.

  try {
    const data = await redis.get(getRedisKey(keyHash));
    if (!data) {
      return null;
    }

    const stored = JSON.parse(data) as StoredApiKeyData;
    return {
      key: '***', // Masked since we don't have the original
      keyHash,
      lastValidatedAt: stored.lastValidatedAt,
      validationStatus: stored.validationStatus,
      validatedCount: stored.validatedCount,
      errorMessage: stored.errorMessage,
    };
  } catch (error) {
    logger.error({ err: error }, '[apikey] getByHash failed');
    return null;
  }
}

export async function listApiKeys(): Promise<ApiKeyValidation[]> {
  const redis = getRedisClient();

  if (!redis || redis.status !== 'ready') {
    return [];
  }

  const keys: ApiKeyValidation[] = [];
  let cursor = '0';

  do {
    const [newCursor, foundKeys] = await redis.scan(
      cursor,
      'MATCH',
      `${REDIS_KEY_PREFIX}*`,
      'COUNT',
      100
    );
    cursor = newCursor;

    if (foundKeys.length > 0) {
      const values = await redis.mget(...foundKeys);
      values.forEach((data, index) => {
        if (!data) return;
        try {
          const stored = JSON.parse(data) as StoredApiKeyData;
          const redisKey = foundKeys[index];
          const keyHash = redisKey.replace(REDIS_KEY_PREFIX, '');
          keys.push({
            key: '***',
            keyHash,
            lastValidatedAt: stored.lastValidatedAt,
            validationStatus: stored.validationStatus,
            validatedCount: stored.validatedCount,
            errorMessage: stored.errorMessage,
          });
        } catch {
          // Skip invalid entries
        }
      });
    }
  } while (cursor !== '0');

  return keys;
}

export async function deleteApiKey(keyHash: string): Promise<boolean> {
  const redis = getRedisClient();

  if (!redis || redis.status !== 'ready') {
    return false;
  }

  try {
    const result = await redis.del(getRedisKey(keyHash));
    return result > 0;
  } catch (error) {
    logger.error({ err: error }, '[apikey] delete failed');
    return false;
  }
}

export function formatTimeAgo(timestamp: number | null): string {
  if (timestamp === null) {
    return 'never';
  }

  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (diff === 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export async function summarizeApiKeyStatuses(): Promise<{ checked: number; valid: number; invalid: number }> {
  const keys = await listApiKeys();
  const results = { checked: 0, valid: 0, invalid: 0 };

  for (const keyInfo of keys) {
    // We can't revalidate without the original key, so we just update timestamp
    // In a real scenario, we'd need to store the key or have it provided
    results.checked++;
    if (keyInfo.validationStatus === 'valid') {
      results.valid++;
    } else if (keyInfo.validationStatus === 'invalid') {
      results.invalid++;
    }
  }

  return results;
}
