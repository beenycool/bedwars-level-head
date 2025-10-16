import type { Request, Response, NextFunction } from 'express';
import { PROXY_AUTH_TOKENS } from '../config';
import { HttpError } from '../util/httpError';

const installIdRegex = /^[0-9a-f]{32}$/i;
const tokenInstallBindings = new Map<string, string>();

function extractBearerToken(headerValue?: string): string | null {
  if (!headerValue) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1].trim() : null;
}

export function requireModHandshake(req: Request, res: Response, next: NextFunction): void {
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
    res.set('WWW-Authenticate', 'Bearer realm="Levelhead proxy"');
    throw new HttpError(401, 'MISSING_TOKEN', 'Proxy authorization token is required.');
  }

  if (!PROXY_AUTH_TOKENS.has(providedToken)) {
    throw new HttpError(403, 'INVALID_TOKEN', 'Proxy authorization token is not recognized.');
  }

  const boundInstall = tokenInstallBindings.get(providedToken);
  if (boundInstall && boundInstall !== installId) {
    throw new HttpError(403, 'TOKEN_INSTALL_MISMATCH', 'Proxy token is bound to a different install identifier.');
  }

  const canonicalInstall = boundInstall ?? installId;
  if (!boundInstall) {
    tokenInstallBindings.set(providedToken, canonicalInstall);
  }
  req.installId = canonicalInstall;
  req.proxyToken = providedToken;

  next();
}
