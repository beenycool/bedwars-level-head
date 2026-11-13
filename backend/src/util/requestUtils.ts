import ipaddr from 'ipaddr.js';
import { isNonArrayObject } from './typeChecks';
import { IDENTIFIER_PATTERN, IDENTIFIER_MAX_LENGTH } from './validationConstants';

/** Safely extracts the `uuids` array from a request body without inline casts. */
export function extractBatchIdentifiersFromBody(body: unknown): unknown[] | undefined {
  if (isNonArrayObject(body) && Array.isArray(body.uuids)) {
    return body.uuids;
  }
  return undefined;
}

/**
 * Trims, length-checks, dedupes and validates batch identifiers.
 * Non-strings, empty strings and over-length values set `hasInvalid`.
 */
export function parseAndValidateBatchIdentifiers(
  uuidsValue: unknown[],
): { uniqueUuids: string[]; hasInvalid: boolean } {
  const uniqueUuids: string[] = [];
  const seen = new Set<string>();
  let hasInvalid = false;

  for (const value of uuidsValue) {
    if (typeof value !== 'string') {
      hasInvalid = true;
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0 || value.length > IDENTIFIER_MAX_LENGTH) {
      hasInvalid = true;
      continue;
    }

    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    uniqueUuids.push(trimmed);
    if (!IDENTIFIER_PATTERN.test(trimmed)) {
      hasInvalid = true;
    }
  }

  return { uniqueUuids, hasInvalid };
}

export function isIPInCIDR(ip: string, cidr: string): boolean {
  try {
    const parsed = ipaddr.parseCIDR(cidr);
    const network = parsed[0];
    const prefix = parsed[1];
    let parsedIp = ipaddr.parse(ip);

    if (parsedIp.kind() === 'ipv6') {
      const ipv6 = parsedIp as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        parsedIp = ipv6.toIPv4Address();
      }
    }

    if (parsedIp.kind() !== network.kind()) {
      return false;
    }

    return parsedIp.kind() === 'ipv4'
      ? (parsedIp as ipaddr.IPv4).match([network as ipaddr.IPv4, prefix])
      : (parsedIp as ipaddr.IPv6).match([network as ipaddr.IPv6, prefix]);
  } catch {
    return false;
  }
}

// Control characters (newlines, escapes, unicode line separators) are replaced with
// their hex escape sequence (e.g. \x0a) to prevent log injection.
const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F-\x9F\u0085\u2028\u2029]/g;

function escapeControlChar(char: string): string {
  return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
}

export function sanitizeUrlForLogs(target: string): string {
  const sanitized = target.replace(CONTROL_CHAR_REGEX, escapeControlChar);
  const queryIndex = sanitized.indexOf('?');
  return queryIndex === -1 ? sanitized : `${sanitized.slice(0, queryIndex)}?<redacted>`;
}
