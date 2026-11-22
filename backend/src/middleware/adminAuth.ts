import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'node:crypto';
import { ADMIN_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

export const MAX_TOKEN_LENGTH = 128;

const TOKEN_HEADER = 'x-admin-token';

function hashToken(token: string): Buffer {
  // @codeql-suppress [js/insufficient-password-hash] API keys are high-entropy random
  // values, not passwords, so a fast hash is appropriate and avoids a CPU DoS vector.
  return crypto.createHash('sha256').update(token).digest();
}

const allowedHashes = ADMIN_API_KEYS.map(hashToken);

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

  const customHeader = req.get(TOKEN_HEADER);
  if (typeof customHeader === 'string' && customHeader.trim().length > 0) {
    return customHeader.trim();
  }

  return null;
}

function validateAdminToken(token: string): boolean {
  if (!token || token.length > MAX_TOKEN_LENGTH || allowedHashes.length === 0) {
    return false;
  }

  const tokenHash = hashToken(token);
  // Iterate every key without short-circuiting so the comparison stays constant-time.
  let match = 0;
  for (const allowed of allowedHashes) {
    match |= Number(crypto.timingSafeEqual(tokenHash, allowed));
  }
  return match === 1;
}

export const enforceAdminAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractAdminToken(req);
  if (!token || !validateAdminToken(token)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid admin API token.'));
    return;
  }
  next();
};
