/**
 * Small collection of type-check helpers used across the backend.
 * Keeps common object/array checks in one place to avoid duplication.
 */

export function isNonArrayObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
