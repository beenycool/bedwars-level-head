import { Request, Response } from 'express';
import { HttpError } from '../../src/util/httpError';

// Mock config before importing the middleware
jest.mock('../../src/config', () => ({
  ADMIN_API_KEYS: ['secret1', 'secret2'],
}));

import { enforceAdminAuth } from '../../src/middleware/adminAuth';

describe('Admin Auth Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    req = {
      get: jest.fn(),
    };
    res = {};
    next = jest.fn();
  });

  it('should call next() for valid Bearer token', () => {
    (req.get as jest.Mock).mockImplementation((header: string) => {
        if (header.toLowerCase() === 'authorization') return 'Bearer secret1';
        return undefined;
    });
    enforceAdminAuth(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next() for valid x-admin-token header', () => {
    (req.get as jest.Mock).mockImplementation((header: string) => {
        if (header.toLowerCase() === 'authorization') return undefined;
        if (header.toLowerCase() === 'x-admin-token') return 'secret2';
        return undefined;
    });

    enforceAdminAuth(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next(error) for invalid token', () => {
    (req.get as jest.Mock).mockImplementation((header: string) => {
        if (header.toLowerCase() === 'authorization') return 'Bearer wrongsecret';
        return undefined;
    });
    enforceAdminAuth(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect(next.mock.calls[0][0].status).toBe(401);
  });

  it('should call next(error) for missing token', () => {
    (req.get as jest.Mock).mockReturnValue(undefined);
    enforceAdminAuth(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect(next.mock.calls[0][0].status).toBe(401);
  });
});
