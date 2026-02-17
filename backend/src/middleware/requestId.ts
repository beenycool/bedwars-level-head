import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const headerName = 'X-Request-ID';
  const incomingId = req.header(headerName);
  const id = Array.isArray(incomingId) ? incomingId[0] : incomingId || randomUUID();

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
