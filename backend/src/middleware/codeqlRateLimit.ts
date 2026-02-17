import rateLimit from 'express-rate-limit';
import { ADMIN_RATE_LIMIT_MAX, ADMIN_RATE_LIMIT_WINDOW_MS } from '../config';
import { getClientIpAddress } from './rateLimit';

export const enforceCodeqlAdminRateLimit = rateLimit({
  windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
  max: ADMIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return `admin:${getClientIpAddress(req)}`;
  },
});
