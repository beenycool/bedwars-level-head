import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const headerName = 'X-Request-ID';
  const incomingId = req.header(headerName);
  let id = Array.isArray(incomingId) ? incomingId[0] : incomingId;

  // 🛡️ Sentinel: Validate incoming request ID to prevent HTTP response splitting and XSS
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id) || id.length > 64) {
    id = randomUUID();
  }

  req.id = id;
  res.setHeader(headerName, id);
  res.locals.requestId = id;

  next();
};

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}
