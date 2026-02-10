import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'crypto';
import { ADMIN_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

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
 * Using SHA-256 hashing ensures constant length comparison, mitigating timing attacks.
 */
function secureCompare(token: string, allowedKeys: string[]): boolean {
  if (!token) return false;

  const tokenHash = crypto.createHash('sha256').update(token).digest();
  let match = false;

  for (const key of allowedKeys) {
    // Hash key as well to ensure constant length comparison
    const keyHash = crypto.createHash('sha256').update(key).digest();
    // timingSafeEqual requires buffers of equal length, which SHA-256 guarantees (32 bytes)
    if (crypto.timingSafeEqual(tokenHash, keyHash)) {
      match = true;
    }
  }

  return match;
}

export const enforceAdminAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractAdminToken(req);
  if (!token || !secureCompare(token, ADMIN_API_KEYS)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid admin API token.'));
    return;
  }

  next();
};
