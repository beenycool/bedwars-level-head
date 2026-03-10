import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { HttpError } from '../util/httpError';
import { validateApiKey, isValidApiKeyFormat } from '../services/apiKeyManager';
import { MAX_TOKEN_LENGTH } from './authConstants';
import { logger } from '../util/logger';

export function extractApiKey(req: Request): string | null {
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

  const customHeader = req.get('x-api-key');
  if (typeof customHeader === 'string' && customHeader.trim().length > 0) {
    return customHeader.trim();
  }

  return null;
}

export const enforceApiKeyAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractApiKey(req);

  if (!token) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing API key.'));
    return;
  }

  if (token.length > MAX_TOKEN_LENGTH || !isValidApiKeyFormat(token)) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Invalid API key format.'));
    return;
  }

  try {
    const validation = await validateApiKey(token);
    if (validation.validationStatus !== 'valid') {
      next(new HttpError(403, 'FORBIDDEN', validation.errorMessage || 'Invalid API key.'));
      return;
    }

    next();
  } catch (error) {
    logger.error({ err: error }, 'Error validating API key in middleware');
    next(new HttpError(500, 'INTERNAL_ERROR', 'Failed to validate API key.'));
  }
};
