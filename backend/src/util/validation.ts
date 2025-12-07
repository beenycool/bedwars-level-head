/**
 * Validation utilities for player data submissions.
 * Prevents cache poisoning by enforcing strict schema validation.
 */

import { isNonArrayObject } from './typeChecks';

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
    for (const value of Object.values(obj)) {
        const depth = getObjectDepth(value, currentDepth + 1);
        maxDepth = Math.max(maxDepth, depth);
        if (maxDepth > MAX_OBJECT_DEPTH) {
            return maxDepth;
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
 * Validate Bedwars stats schema
 * Ensures known fields match expected types but allows extra Hypixel fields
 */
export function validateBedwarsStats(data: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {
            valid: false,
            errors: [{
                field: 'data',
                message: 'Data must be a non-null object',
            }],
        };
    }

    const record = data as Record<string, unknown>;

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
        (typeof record.Experience === 'number' && Number.isFinite(record.Experience));

    if (!hasExperience) {
        errors.push({
            field: 'bedwars_experience',
            message: 'At least one of bedwars_experience or Experience must be present and valid',
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

export const criticalFields = ['bedwars_experience', 'Experience', 'kills_bedwars', 'wins_bedwars'];

export function matchesCriticalFields(source: Record<string, unknown>, submitted: Record<string, unknown>): boolean {
    for (const field of criticalFields) {
        const sourceValue = source[field];
        const submittedValue = submitted[field];

        if (sourceValue !== undefined && submittedValue !== undefined) {
            if (Number(sourceValue) !== Number(submittedValue)) {
                return false;
            }
        }

        if (sourceValue !== undefined && submittedValue === undefined) {
            return false;
        }
    }

    return true;
}
