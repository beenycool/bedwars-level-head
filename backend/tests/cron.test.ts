import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { enforceCronAuth } from '../src/middleware/cronAuth';
import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../src/util/httpError';

// Mock config
jest.mock('../src/config', () => ({
  CRON_API_KEYS: ['valid-token'],
}));

describe('Cron Auth Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      get: jest.fn((name: string) => {
        if (name === 'authorization') return undefined;
        if (name === 'x-cron-token') return undefined;
        return undefined;
      }) as any,
    };
    mockResponse = {};
    nextFunction = jest.fn();
  });

  it('should allow access with valid Bearer token', () => {
    mockRequest.get = jest.fn((name: string) => {
      if (name === 'authorization') return 'Bearer valid-token';
      return undefined;
    }) as any;

    enforceCronAuth(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalledWith();
  });

  it('should allow access with valid X-Cron-Token', () => {
    mockRequest.get = jest.fn((name: string) => {
      if (name === 'x-cron-token') return 'valid-token';
      return undefined;
    }) as any;

    enforceCronAuth(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalledWith();
  });

  it('should deny access with invalid token', () => {
    mockRequest.get = jest.fn((name: string) => {
      if (name === 'authorization') return 'Bearer invalid-token';
      return undefined;
    }) as any;

    enforceCronAuth(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalledWith(expect.any(HttpError));
  });

  it('should deny access with missing token', () => {
    enforceCronAuth(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalledWith(expect.any(HttpError));
  });
});
