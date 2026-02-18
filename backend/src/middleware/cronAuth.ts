import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'crypto';
import { CRON_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

// Pre-compute SHA-256 hashes of allowed keys
// This mitigates timing attacks by ensuring constant-time comparison.
const ALLOWED_KEY_HASHES = CRON_API_KEYS.map((key) =>
  crypto.createHash('sha256').update(key).digest()
);

export function extractCronToken(req: Request): string | null {
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
 * Using SHA-256 ensures constant length comparison and cryptographic strength.
 */
export function validateCronToken(token: string): boolean {
  if (!token) return false;

  // Hash the incoming token using SHA-256
  const tokenHash = crypto.createHash('sha256').update(token).digest();

  // To prevent timing attacks, we must iterate through all keys and not short-circuit.
  // Using reduce with a bitwise OR ensures we process every key without conditional branching.
  const match = ALLOWED_KEY_HASHES.reduce(
    (acc, keyHash) => acc | Number(crypto.timingSafeEqual(tokenHash, keyHash)),
    0
  );

  return Boolean(match);
}

export const enforceCronAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractCronToken(req);
  if (!token || !validateCronToken(token)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid cron API token.'));
    return;
  }

  next();
};
