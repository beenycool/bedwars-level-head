import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'crypto';
import { ADMIN_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

// Pre-compute hashes of allowed keys to avoid hashing secrets repeatedly in the request path
// This mitigates timing attacks by ensuring constant-time comparison
// and improves performance.
const ALLOWED_KEY_HASHES = ADMIN_API_KEYS.map((key) =>
  crypto.createHash('sha256').update(key).digest()
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
 * Using SHA-256 hashing ensures constant length comparison.
 */
function secureCompare(token: string): boolean {
  if (!token) return false;

  // Hash the incoming token to compare against pre-computed hashes
  const tokenHash = crypto.createHash('sha256').update(token).digest();
  let match = false;

  for (const keyHash of ALLOWED_KEY_HASHES) {
    // timingSafeEqual requires buffers of equal length, which SHA-256 guarantees (32 bytes)
    if (crypto.timingSafeEqual(tokenHash, keyHash)) {
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
