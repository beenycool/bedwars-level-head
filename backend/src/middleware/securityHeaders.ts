import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME-sniffing
  res.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.set('X-Frame-Options', 'DENY');

  // Control referrer information
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // HTTP Strict Transport Security (HSTS)
  // Enforce HTTPS for 1 year, including subdomains
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Permissions Policy
  // Disable sensitive features that are not used
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');

  // Generate a random nonce for this request
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' https://cdn.jsdelivr.net 'nonce-${nonce}'`,
    `style-src 'self' https://cdn.jsdelivr.net 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  res.set('Content-Security-Policy', cspDirectives.join('; '));

  next();
}
