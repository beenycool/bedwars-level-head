export const IDENTIFIER_MAX_LENGTH = 64;
export const MAX_BATCH_SIZE = 20;

const UUID_PATTERN = /^[0-9a-f]{32}$/i;
const IGN_PATTERN = /^[a-zA-Z0-9_]{1,16}$/;

export const IDENTIFIER_PATTERN = /^(?:[0-9a-f]{32}|[a-zA-Z0-9_]{1,16})$/i;
/** True for a 32-character hex UUID with no dashes. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** True for a Minecraft username (1-16 chars, letters/digits/underscore). */
export function isIgn(value: string): boolean {
  return IGN_PATTERN.test(value);
}

/**
 * Strips dashes from a canonical dashed UUID (kept only when the dashes sit at the
 * canonical indices) and lowercases the result. Non-UUID input is lowercased as-is.
 */
export function normalizeIdentifier(identifier: string): string {
  let key = identifier;
  if (key.length === 36 && key[8] === '-' && key[13] === '-' && key[18] === '-' && key[23] === '-') {
    key = key.slice(0, 8) + key.slice(9, 13) + key.slice(14, 18) + key.slice(19, 23) + key.slice(24);
  }
  return key.toLowerCase();
}
