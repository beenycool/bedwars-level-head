import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MONITORING_ALLOWED_CIDRS } from '../config';
import { getClientIpAddress } from './rateLimit';
import { isIPInCIDR } from '../util/requestUtils';
import { extractAdminToken, validateAdminToken } from './adminAuth';
import { extractCronToken, validateCronToken } from './cronAuth';
import { HttpError } from '../util/httpError';

/**
 * Checks if the request originates from a CIDR allowed for monitoring.
 */
export function isInternalRequest(req: Request): boolean {
  try {
    const ip = getClientIpAddress(req);
    return MONITORING_ALLOWED_CIDRS.some((cidr) => isIPInCIDR(ip, cidr));
  } catch (error) {
    console.warn('[monitoring-auth] failed to resolve client IP for monitoring allowlist check', error);
    return false;
  }
}

/**
 * Checks if the request is authorized for monitoring (internal OR valid token).
 */
export function isAuthorizedMonitoring(req: Request): boolean {
  if (isInternalRequest(req)) {
    return true;
  }

  const adminToken = extractAdminToken(req);
  if (adminToken && validateAdminToken(adminToken)) {
    return true;
  }

  const cronToken = extractCronToken(req);
  if (cronToken && validateCronToken(cronToken)) {
    return true;
  }

  return false;
}

/**
 * Middleware that blocks unauthorized monitoring requests.
 */
export const enforceMonitoringAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (!isAuthorizedMonitoring(req)) {
    next(new HttpError(403, 'FORBIDDEN', 'Access to operational metrics is restricted.'));
    return;
  }

  next();
};
