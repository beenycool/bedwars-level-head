import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const headerName = 'X-Request-ID';
  // Use existing request ID if present (e.g., from upstream proxy), otherwise generate new one
  const id = (req.header(headerName) || randomUUID()) as string;

  // Add to request object for easy access
  req.id = id;
  // Add to response headers
  res.setHeader(headerName, id);
  // Store in res.locals for potential template/route use
  res.locals.requestId = id;

  next();
};

// Extend Express Request type to include id
declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}
