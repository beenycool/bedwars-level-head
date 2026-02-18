import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'crypto';
import { ADMIN_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

// Generate a random salt on startup to ensure these hashes are unique to this process
// and cannot be pre-computed by an attacker.
const SALT = crypto.randomBytes(32);

// Pre-compute HMAC-SHA256 hashes of allowed keys.
// Using HMAC-SHA256 provides cryptographic strength and prevents pre-computation attacks
// (unlike simple SHA-256) while being significantly faster than PBKDF2 to prevent CPU exhaustion DoS.
const ALLOWED_KEY_HASHES = ADMIN_API_KEYS.map((key) =>
  crypto.createHmac('sha256', SALT).update(key).digest()
);

export function extractAdminToken(req: Request): string | null {
  const header = req.get('authorization');
  if (typeof header === 'string') {
    const [scheme, ...rest] = header.split(' ');
    if (scheme && scheme.toLowerCase() === 'bearer') {
      const token = rest.join(' ').trim();
      if (token.length > 0) {
        return token;
      }
    }
  }

  const customHeader = req.get('x-admin-token');
  if (typeof customHeader === 'string' && customHeader.trim().length > 0) {
    return customHeader.trim();
  }

  return null;
}

/**
 * Compares a provided token against a list of allowed keys in a timing-safe manner.
 * Using HMAC-SHA256 ensures constant length comparison and cryptographic strength
 * without the CPU overhead of PBKDF2 (which caused DoS vulnerabilities).
 */
export function validateAdminToken(token: string): boolean {
  if (!token) return false;

  // Hash the incoming token using HMAC-SHA256 with the process-local salt
  const tokenHash = crypto.createHmac('sha256', SALT).update(token).digest();
  let match = false;

  for (const keyHash of ALLOWED_KEY_HASHES) {
    // timingSafeEqual requires buffers of equal length
    if (crypto.timingSafeEqual(tokenHash, keyHash)) {
      match = true;
    }
  }

  return match;
}

export const enforceAdminAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractAdminToken(req);
  if (!token || !validateAdminToken(token)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid admin API token.'));
    return;
  }

  next();
};
