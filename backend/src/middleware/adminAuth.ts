import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'crypto';
import { ADMIN_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

// Generate a random salt on startup to ensure these hashes are unique to this process
// and cannot be pre-computed by an attacker.
// This also addresses CodeQL concerns about static hashing of secrets.
const SALT = crypto.randomBytes(32);

// Pre-compute HMACs of allowed keys
// This mitigates timing attacks by ensuring constant-time comparison
// and improves performance.
const ALLOWED_KEY_HMACS = ADMIN_API_KEYS.map((key) =>
  crypto.createHmac('sha256', SALT).update(key).digest()
);

function extractAdminToken(req: Request): string | null {
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
 * Using HMAC-SHA256 with a random salt ensures constant length comparison.
 */
function secureCompare(token: string): boolean {
  if (!token) return false;

  // HMAC the incoming token with the same random salt
  const tokenHmac = crypto.createHmac('sha256', SALT).update(token).digest();
  let match = false;

  for (const keyHmac of ALLOWED_KEY_HMACS) {
    // timingSafeEqual requires buffers of equal length, which SHA-256 guarantees (32 bytes)
    if (crypto.timingSafeEqual(tokenHmac, keyHmac)) {
      match = true;
    }
  }

  return match;
}

export const enforceAdminAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractAdminToken(req);
  if (!token || !secureCompare(token)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid admin API token.'));
    return;
  }

  next();
};
