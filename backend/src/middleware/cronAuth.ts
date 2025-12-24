import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CRON_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

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

export const enforceCronAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractCronToken(req);
  if (!token || !CRON_API_KEYS.includes(token)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid cron API token.'));
    return;
  }

  next();
};
