import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'crypto';
import { CRON_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

// Generate a random salt on startup to ensure these hashes are unique to this process
// and cannot be pre-computed by an attacker.
// Using PBKDF2 ensures cryptographic strength and constant length for comparison.
const SALT = crypto.randomBytes(16);
const ITERATIONS = 10000;
const KEYLEN = 32; // SHA-256 output length
const DIGEST = 'sha256';

// Pre-compute PBKDF2 hashes of allowed keys
// This mitigates timing attacks by ensuring constant-time comparison.
const ALLOWED_KEY_HASHES = CRON_API_KEYS.map((key) =>
  crypto.pbkdf2Sync(key, SALT, ITERATIONS, KEYLEN, DIGEST)
);

function extractCronToken(req: Request): string | null {
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

  const customHeader = req.get('x-cron-token');
  if (typeof customHeader === 'string' && customHeader.trim().length > 0) {
    return customHeader.trim();
  }

  return null;
}

/**
 * Compares a provided token against a list of allowed keys in a timing-safe manner.
 * Using PBKDF2 ensures constant length comparison and cryptographic strength.
 */
function secureCompare(token: string): boolean {
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

export const enforceCronAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractCronToken(req);
  if (!token || !secureCompare(token)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid cron API token.'));
    return;
  }

  next();
};
