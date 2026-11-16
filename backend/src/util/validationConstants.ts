export const IDENTIFIER_MAX_LENGTH = 64;
export const MAX_BATCH_SIZE = 20;

const UUID_PATTERN = /^[0-9a-f]{32}$/i;

/**
 * A 32-character hex UUID with optional dashes (canonical or not). Minecraft
 * usernames are intentionally not accepted: the proxy only resolves UUIDs.
 */
export const IDENTIFIER_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** True for a 32-character hex UUID with no dashes. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Strips every dash and lowercases the result. Both the canonical dashed UUID and
 * the undashed form normalize to the same cache/tracking key.
 */
export function normalizeIdentifier(identifier: string): string {
  return identifier.replace(/-/g, '').toLowerCase();
}

/**
 * Normalizes an identifier and returns it only when the result is a UUID.
 * Returns `null` for usernames and malformed input.
 */
export function normalizeUuid(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!IDENTIFIER_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.replace(/-/g, '').toLowerCase();
}
