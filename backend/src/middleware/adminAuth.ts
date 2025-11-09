import type { NextFunction, Request, RequestHandler, Response } from 'express';
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

export const enforceAdminAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractAdminToken(req);
  if (!token || !ADMIN_API_KEYS.includes(token)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid admin API token.'));
    return;
  }

  next();
};
