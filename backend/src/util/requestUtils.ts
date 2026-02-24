
import ipaddr from 'ipaddr.js';
import { recordPlayerQuery } from '../services/history';
import { ResolvedPlayer } from '../services/player';
import { isValidBedwarsObject } from './typeChecks';
import { logger } from './logger';

export function isIPInCIDR(ip: string, cidr: string): boolean {
  try {
    const parsed = ipaddr.parseCIDR(cidr);
    const network = parsed[0];
    const prefix = parsed[1];
    let parsedIp = ipaddr.parse(ip);

    // Handle IPv4-mapped IPv6 addresses
    if (parsedIp.kind() === 'ipv6') {
      const ipv6 = parsedIp as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        parsedIp = ipv6.toIPv4Address();
      }
    }

    // Match requires same address family
    if (parsedIp.kind() !== network.kind()) {
      return false;
    }

    // Use the match method with array format [address, prefix]
    if (parsedIp.kind() === 'ipv4') {
      return (parsedIp as ipaddr.IPv4).match([network as ipaddr.IPv4, prefix]);
    } else {
      return (parsedIp as ipaddr.IPv6).match([network as ipaddr.IPv6, prefix]);
    }
  } catch {
    return false;
  }
}

/**
 * Parses the If-Modified-Since header string into a timestamp number.
 * Returns undefined if the header is missing or invalid.
 */
export function parseIfModifiedSince(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Records a player query to the history service, handling any errors gracefully.
 */
export async function recordQuerySafely(payload: Parameters<typeof recordPlayerQuery>[0]): Promise<void> {
    try {
        recordPlayerQuery(payload);
    } catch (error) {
        logger.error('Failed to record player query', {
            error,
            identifier: payload.identifier,
            lookupType: payload.lookupType,
            responseStatus: payload.responseStatus,
        });
    }
}

/**
 * Extracts Bedwars experience from a resolved player payload.
 * Returns null if the experience cannot be found or is invalid.
 */
export function extractBedwarsExperience(payload: ResolvedPlayer['payload']): number | null {
    if (payload && typeof payload === 'object' && 'bedwars_experience' in payload) {
        const rawValue = (payload as { bedwars_experience?: unknown }).bedwars_experience;
        if (rawValue === undefined || rawValue === null) {
            return null;
        }
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric) || numeric < 0) {
            return null;
        }
        return numeric;
    }

    if (!payload) {
        return null;
    }

    const payloadRecord = payload as Record<string, unknown>;
    const dataCandidate = (payloadRecord as { data?: unknown }).data;
    const bedwarsCandidate = (payloadRecord as { bedwars?: unknown }).bedwars;
    const bedwars =
        (dataCandidate as { bedwars?: unknown } | undefined)?.bedwars ??
        bedwarsCandidate ??
        (isValidBedwarsObject(dataCandidate) ? dataCandidate : undefined);
    if (!isValidBedwarsObject(bedwars)) {
        return null;
    }

    const record = bedwars as Record<string, unknown>;
    const rawValue = record.bedwars_experience ?? record.Experience ?? record.experience;
    if (rawValue === undefined || rawValue === null) {
        return null;
    }

    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return null;
    }

    return numeric;
}

export function sanitizeUrlForLogs(target: string): string {
  // Prevent Log Injection: Remove control characters (newlines, etc.)
  // We replace control characters (ASCII 0-31 and 127) with their hex escape sequence (e.g. \x0a)
  const sanitized = target.replace(/[\x00-\x1F\x7F-\x9F\u0085\u2028\u2029]/g, (char) => {
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });

  const queryIndex = sanitized.indexOf('?');
  if (queryIndex === -1) {
    return sanitized;
  }

  const path = sanitized.slice(0, queryIndex);
  return `${path}?<redacted>`;
}

/**
 * Sanitizes and validates a search query parameter.
 * Trims whitespace and truncates to a maximum length to prevent resource exhaustion.
 *
 * @param query - The raw query parameter (usually from req.query.q)
 * @param maxLength - Maximum allowed length (default: 100)
 * @returns The sanitized query string, or empty string if invalid
 */
export function sanitizeSearchQuery(query: unknown, maxLength = 100): string {
  if (typeof query !== 'string') {
    return '';
  }

  return query.trim().slice(0, maxLength);
}
