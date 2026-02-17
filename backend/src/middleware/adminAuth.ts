import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'crypto';
import { ADMIN_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

// Generate a random salt on startup to ensure these hashes are unique to this process
// and cannot be pre-computed by an attacker.
// PBKDF2 is used to satisfy CodeQL's requirement for secure password hashing.
const SALT = crypto.randomBytes(16);
const ITERATIONS = 10000; // Sufficient for API keys, fast enough for per-request
const KEYLEN = 32; // SHA-256 output length
const DIGEST = 'sha256';

// Pre-compute PBKDF2 hashes of allowed keys
// This mitigates timing attacks by ensuring constant-time comparison
// and improves performance.
const ALLOWED_KEY_HASHES = ADMIN_API_KEYS.map((key) =>
  crypto.pbkdf2Sync(key, SALT, ITERATIONS, KEYLEN, DIGEST)
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
 * Using PBKDF2 ensures constant length comparison and cryptographic strength.
 */
export function validateAdminToken(token: string): boolean {
  if (!token) return false;

  // Hash the incoming token with the same salt and parameters
  const tokenHash = crypto.pbkdf2Sync(token, SALT, ITERATIONS, KEYLEN, DIGEST);
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
