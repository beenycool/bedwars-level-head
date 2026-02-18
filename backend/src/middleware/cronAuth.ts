import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'crypto';
import { CRON_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

// Generate a random salt on startup to ensure these hashes are unique to this process
// and cannot be pre-computed by an attacker.
const SALT = crypto.randomBytes(32);

// Pre-compute HMAC-SHA256 hashes of allowed keys.
// Using HMAC-SHA256 provides cryptographic strength and prevents pre-computation attacks
// (unlike simple SHA-256) while being significantly faster than PBKDF2 to prevent CPU exhaustion DoS.
const ALLOWED_KEY_HASHES = CRON_API_KEYS.map((key) =>
  crypto.createHmac('sha256', SALT).update(key).digest()
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
 * Using HMAC-SHA256 ensures constant length comparison and cryptographic strength
 * without the CPU overhead of PBKDF2.
 */
export function validateCronToken(token: string): boolean {
  if (!token) return false;

  // Hash the incoming token using HMAC-SHA256 with the process-local salt
  const tokenHash = crypto.createHmac('sha256', SALT).update(token).digest();

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
