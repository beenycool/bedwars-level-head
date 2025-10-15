import type { Request, Response, NextFunction } from 'express';
import { PROXY_AUTH_TOKENS } from '../config';
import { HttpError } from '../util/httpError';

const installIdRegex = /^[0-9a-f]{32}$/i;

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token.trim();
}

export function requireModHandshake(req: Request, _res: Response, next: NextFunction): void {
  const userAgent = req.header('User-Agent') ?? '';
  if (!userAgent.startsWith('Levelhead/')) {
    throw new HttpError(403, 'INVALID_USER_AGENT', 'Requests must originate from the Levelhead mod.');
  }

  const installId = req.header('X-Levelhead-Install') ?? '';
  if (!installIdRegex.test(installId)) {
    throw new HttpError(400, 'INVALID_INSTALL_ID', 'Missing or malformed X-Levelhead-Install header.');
  }

  const providedToken = extractBearerToken(req.header('Authorization'));
  if (!providedToken) {
    throw new HttpError(401, 'MISSING_TOKEN', 'Proxy authorization token is required.');
  }

  if (!PROXY_AUTH_TOKENS.includes(providedToken)) {
    throw new HttpError(403, 'INVALID_TOKEN', 'Proxy authorization token is not recognized.');
  }

  req.installId = installId;
  req.proxyToken = providedToken;

  next();
}
