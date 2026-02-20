/**
 * Validation utilities for player data submissions.
 * Prevents cache poisoning by enforcing strict schema validation.
 */

import { isNonArrayObject } from './typeChecks';
import { getRedisClient } from '../services/redis';
import { SUBMISSION_TTL_MS } from '../config';
import { logger } from './logger';

export interface NonceValidationResult {
    valid: boolean;
    error?: string;
    statusCode: number;
}

export interface ValidationError {
    field: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

/**
 * Maximum allowed JSON string length (1MB)
 */
const MAX_PAYLOAD_SIZE_BYTES = 1024 * 1024;

/**
 * Maximum allowed object nesting depth
 */
const MAX_OBJECT_DEPTH = 10;

/**
 * Expected Bedwars stats schema fields with their types
 */
const BEDWARS_STATS_SCHEMA: Record<string, 'number' | 'string' | 'boolean' | 'object'> = {
    // Core experience and level fields
    bedwars_experience: 'number',
    Experience: 'number',
    experience: 'number',

    // Kill/Death stats
    kills_bedwars: 'number',
    deaths_bedwars: 'number',
    final_kills_bedwars: 'number',
    final_deaths_bedwars: 'number',

    // Win/Loss stats
    wins_bedwars: 'number',
    losses_bedwars: 'number',
    games_played_bedwars: 'number',

    // Bed stats
    beds_broken_bedwars: 'number',
    beds_lost_bedwars: 'number',

    // Computed stats
    fkdr: 'number',
    winstreak: 'number',

    // Display fields
    displayname: 'string',
    display: 'string',

    // Nicked flag
    nicked: 'boolean',

    // Mode-specific stats (nested objects)
    eight_one_: 'object',
    eight_two_: 'object',
    four_three_: 'object',
    four_four_: 'object',
    two_four_: 'object',

    // Cosmetics and achievements
    activeProjectileTrail: 'string',
    activeDeathCry: 'string',
    activeGlyph: 'string',
    activeVictoryDance: 'string',
    activeSprays: 'string',
    activeKillEffect: 'string',
    activeIslandTopper: 'string',

    // Coins and resources
    coins: 'number',

    // Achievements
    bedwars_level: 'number',

    // Other common fields
    items_purchased_bedwars: 'number',
    resources_collected_bedwars: 'number',

    // Castle mode
    castle_: 'object',
};

/**
 * Check if payload size exceeds maximum allowed
 */
export function validatePayloadSize(jsonString: string): ValidationResult {
    const sizeBytes = Buffer.byteLength(jsonString, 'utf8');

    if (sizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
        return {
            valid: false,
            errors: [{
                field: '_payload',
                message: `Payload size (${sizeBytes} bytes) exceeds maximum allowed (${MAX_PAYLOAD_SIZE_BYTES} bytes)`,
            }],
        };
    }

    return { valid: true, errors: [] };
}

/**
 * Calculate the maximum depth of an object
 */
function getObjectDepth(obj: unknown, currentDepth = 0): number {
    if (currentDepth > MAX_OBJECT_DEPTH) {
        return currentDepth;
    }

    // Only recurse into non-array objects
    if (!isNonArrayObject(obj)) {
        return currentDepth;
    }

    let maxDepth = currentDepth;
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = (obj as Record<string, unknown>)[key];
            const depth = getObjectDepth(value, currentDepth + 1);
            maxDepth = Math.max(maxDepth, depth);
            if (maxDepth > MAX_OBJECT_DEPTH) {
                return maxDepth;
            }
        }
    }

    return maxDepth;
}

/**
 * Validate object depth doesn't exceed maximum
 */
export function validateObjectDepth(data: unknown): ValidationResult {
    const depth = getObjectDepth(data);

    if (depth > MAX_OBJECT_DEPTH) {
        return {
            valid: false,
            errors: [{
                field: '_structure',
                message: `Object nesting depth (${depth}) exceeds maximum allowed (${MAX_OBJECT_DEPTH})`,
            }],
        };
    }

    return { valid: true, errors: [] };
}

/**
 * Validate that a value matches the expected type
 */
function validateType(value: unknown, expectedType: string): boolean {
    if (value === null || value === undefined) {
        return true; // Allow optional fields
    }

    switch (expectedType) {
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'string':
            return typeof value === 'string';
        case 'boolean':
            return typeof value === 'boolean';
        case 'object':
            return typeof value === 'object' && !Array.isArray(value);
        default:
            return false;
    }
}

/**
 * Helper to extract bedwars stats object from various nested structures.
 * Uses isNonArrayObject helper to standardize validation.
 */
export function extractBedwarsRecord(data: any): Record<string, unknown> | null {
    if (!isNonArrayObject(data)) return null;

    // Check player.stats.Bedwars
    if (isNonArrayObject(data.player)) {
        const stats = (data.player as any).stats;
        if (isNonArrayObject(stats)) {
            const bedwars = stats.Bedwars;
            if (isNonArrayObject(bedwars)) {
                return bedwars;
            }
        }
    }

    // Check data.bedwars (often from proxy payloads)
    if (isNonArrayObject(data.data)) {
        const bedwars = (data.data as any).bedwars;
        if (isNonArrayObject(bedwars)) {
            return bedwars;
        }
    }

    // Check direct bedwars property
    if (isNonArrayObject(data.bedwars)) {
        return (data.bedwars as any);
    }

    // Fallback: assume data itself is the record, since we verified it's a non-array object
    return data;
}

/**
 * Validate Bedwars stats schema
 * Ensures known fields match expected types but allows extra Hypixel fields
 */
export function validateBedwarsStats(data: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    // Removed redundant isNonArrayObject check here.
    // extractBedwarsRecord handles the check internally and returns null if invalid.

    const record = extractBedwarsRecord(data);

    if (!record) {
         return {
            valid: false,
            errors: [{
                field: 'data',
                message: 'Data must be a non-null object',
            }],
        };
    }

    // Validate known fields have correct types
    for (const [field, expectedType] of Object.entries(BEDWARS_STATS_SCHEMA)) {
        const value = record[field];

        if (value !== undefined && value !== null) {
            if (!validateType(value, expectedType)) {
                errors.push({
                    field,
                    message: `Field '${field}' must be of type ${expectedType}, got ${typeof value}`,
                });
            }

            // Additional validation for numeric fields
            if (expectedType === 'number' && typeof value === 'number') {
                if (value < 0) {
                    errors.push({
                        field,
                        message: `Field '${field}' must be non-negative, got ${value}`,
                    });
                }
            }
        }
    }

    // Require at least one of the core experience fields
    const hasExperience =
        (typeof record.bedwars_experience === 'number' && Number.isFinite(record.bedwars_experience)) ||
        (typeof record.Experience === 'number' && Number.isFinite(record.Experience)) ||
        (typeof record.experience === 'number' && Number.isFinite(record.experience));

    if (!hasExperience) {
        errors.push({
            field: 'bedwars_experience',
            message: 'At least one of bedwars_experience, Experience or experience must be present and valid',
        });
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Comprehensive validation for player data submission
 */
export function validatePlayerSubmission(
    jsonString: string,
    data: unknown,
): ValidationResult {
    // Check payload size
    const sizeValidation = validatePayloadSize(jsonString);
    if (!sizeValidation.valid) {
        return sizeValidation;
    }

    // Check object depth
    const depthValidation = validateObjectDepth(data);
    if (!depthValidation.valid) {
        return depthValidation;
    }

    // Validate Bedwars stats schema
    const schemaValidation = validateBedwarsStats(data);
    if (!schemaValidation.valid) {
        return schemaValidation;
    }

    return { valid: true, errors: [] };
}

export const criticalFields = [
    'bedwars_experience',
    'Experience',
    'experience',
    'final_kills_bedwars',
    'final_deaths_bedwars',
];

export function matchesCriticalFields(source: Record<string, unknown>, submitted: Record<string, unknown>): boolean {
    let hasMatchedAnyField = false;

    const normalizedSource = extractBedwarsRecord(source);
    const normalizedSubmitted = extractBedwarsRecord(submitted);

    if (!normalizedSource || !normalizedSubmitted) return false;

    for (const field of criticalFields) {
        const sourceValue = normalizedSource[field];
        const submittedValue = normalizedSubmitted[field];

        if (sourceValue !== undefined) {
            // Source has data for this field
            hasMatchedAnyField = true;

            if (submittedValue !== undefined) {
                // Both have data, must match
                if (Number(sourceValue) !== Number(submittedValue)) {
                    return false;
                }
            } else {
                // Source has data but submission doesn't -> mismatch
                return false;
            }
        }
    }

    // If source had NO critical fields (e.g. empty stats for new player),
    // we cannot verify the submission against it.
    // In this case, we should reject the submission to prevent poisoning.
    if (!hasMatchedAnyField) {
        return false;
    }

    return true;
}

/**
 * Validates timestamp and nonce for replay protection.
 * Checks that timestamp is within the allowed window and nonce hasn't been used.
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @param nonce - Unique nonce string
 * @param keyId - Identifier for the key used (e.g., api key hash or identifier)
 * @returns NonceValidationResult with validation status and error details
 */
export async function validateTimestampAndNonce(
    timestamp: number,
    nonce: string,
    keyId: string,
): Promise<NonceValidationResult> {
    const now = Date.now();

    // Validate timestamp is within allowed window
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > SUBMISSION_TTL_MS) {
        return {
            valid: false,
            error: `Timestamp expired or too far in future. Max allowed diff: ${SUBMISSION_TTL_MS}ms`,
            statusCode: 400,
        };
    }

    // Validate nonce format (alphanumeric, reasonable length)
    if (!nonce || typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(nonce)) {
        return {
            valid: false,
            error: 'Invalid nonce format. Must be 8-128 characters and alphanumeric.',
            statusCode: 400,
        };
    }

    const redis = getRedisClient();
    if (!redis) {
        // Redis unavailable - fail closed for security (reject submission)
        logger.warn('[nonce-validation] Redis unavailable, rejecting submission for replay protection');
        return {
            valid: false,
            error: 'Replay protection service temporarily unavailable. Please retry.',
            statusCode: 503,
        };
    }

    try {
        // Use SET with NX (only if not exists) and EX (expire) for atomic nonce check
        // Key format: nonce:{keyId}:{nonce}
        const nonceKey = `nonce:${keyId}:${nonce}`;
        const ttlSeconds = Math.ceil((SUBMISSION_TTL_MS * 2) / 1000);
        
        const result = await redis.set(nonceKey, '1', 'EX', ttlSeconds, 'NX');
        
        if (result !== 'OK') {
            // Key already exists - replay attack detected
            return {
                valid: false,
                error: 'Replay attack detected: nonce has already been used',
                statusCode: 409,
            };
        }

        return { valid: true, statusCode: 200 };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[nonce-validation] Redis operation failed:', message);
        
        // Redis error - fail closed for security
        return {
            valid: false,
            error: 'Replay protection check failed. Please retry.',
            statusCode: 503,
        };
    }
}
