import { Request, Response } from 'express';
import crypto from 'crypto';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock config before importing the middleware
jest.mock('../../src/config', () => ({
  CRON_API_KEYS: ['secret1', 'secret2'],
}));

// Import the middleware AFTER mocking config
import { enforceCronAuth } from '../../src/middleware/cronAuth';

describe('Cron Auth Timing Attack Protection', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;
  let timingSafeEqualSpy: jest.SpyInstance;

  beforeEach(() => {
    req = {
      get: jest.fn(),
    };
    res = {};
    next = jest.fn();
    // Spy on crypto.timingSafeEqual
    timingSafeEqualSpy = jest.spyOn(crypto, 'timingSafeEqual');
  });

  afterEach(() => {
    timingSafeEqualSpy.mockRestore();
  });

  it('should use crypto.timingSafeEqual for token comparison', () => {
    (req.get as jest.Mock).mockImplementation((header: string) => {
        if (header.toLowerCase() === 'authorization') return 'Bearer secret1';
        return undefined;
    });

    enforceCronAuth(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(); // Should succeed
    // This expectation will fail before the fix
    expect(timingSafeEqualSpy).toHaveBeenCalled();
  });
});
