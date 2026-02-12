import { Request, Response, NextFunction } from 'express';

// Define the mock implementation directly in the factory
jest.mock('../../src/middleware/rateLimit', () => ({
  enforceRateLimit: jest.fn((req: Request, res: Response, next: NextFunction) => next()),
}));

jest.mock('../../src/middleware/adminAuth', () => ({
  enforceAdminAuth: jest.fn((req: Request, res: Response, next: NextFunction) => next()),
}));

// Mock other dependencies
jest.mock('../../src/services/player', () => ({
  clearInMemoryPlayerCache: jest.fn(),
}));

jest.mock('../../src/services/statsCache', () => ({
  buildPlayerCacheKey: jest.fn(),
  clearAllPlayerStatsCaches: jest.fn(),
  deleteIgnMappings: jest.fn(),
  deletePlayerStatsEntries: jest.fn(),
  getIgnMapping: jest.fn(),
  getPlayerStatsFromCache: jest.fn(),
}));

jest.mock('../../src/services/apiKeyManager', () => ({
  storeApiKey: jest.fn(),
  validateApiKey: jest.fn(),
  getApiKeyValidation: jest.fn(),
  getApiKeyValidationByHash: jest.fn(),
  listApiKeys: jest.fn(),
  deleteApiKey: jest.fn(),
  formatTimeAgo: jest.fn(),
  summarizeApiKeyStatuses: jest.fn(),
  isValidApiKeyFormat: jest.fn(),
}));

// Import the mocked modules to get reference to the mock functions
import { enforceRateLimit } from '../../src/middleware/rateLimit';
import { enforceAdminAuth } from '../../src/middleware/adminAuth';

import adminRouter from '../../src/routes/admin';
import apikeyRouter from '../../src/routes/apikey';

function getMiddlewareIndices(router: any, path: string, method: string = 'post') {
    let routeLayer: any;
    // Iterate over router stack to find the layer for the given path
    for (const layer of router.stack) {
        if (layer.route && layer.route.path === path) {
            // Check method if needed
            if (layer.route.methods[method]) {
                 routeLayer = layer;
                 break;
            }
        }
    }

    if (!routeLayer) return { rateLimitIndex: -1, adminAuthIndex: -1 };

    const stack = routeLayer.route.stack;
    let rateLimitIndex = -1;
    let adminAuthIndex = -1;

    for (let i = 0; i < stack.length; i++) {
        const handle = stack[i].handle;
        if (handle === enforceRateLimit) rateLimitIndex = i;
        if (handle === enforceAdminAuth) adminAuthIndex = i;
    }

    return { rateLimitIndex, adminAuthIndex };
}

describe('Middleware Order Security Check', () => {
  it('should have rateLimit BEFORE adminAuth for /admin/cache/purge', () => {
    const { rateLimitIndex, adminAuthIndex } = getMiddlewareIndices(adminRouter, '/cache/purge');

    expect(rateLimitIndex).not.toBe(-1);
    expect(adminAuthIndex).not.toBe(-1);
    expect(rateLimitIndex).toBeLessThan(adminAuthIndex);
  });

  it('should have rateLimit BEFORE adminAuth for /apikey/validate', () => {
    const { rateLimitIndex, adminAuthIndex } = getMiddlewareIndices(apikeyRouter, '/validate');

    expect(rateLimitIndex).not.toBe(-1);
    expect(adminAuthIndex).not.toBe(-1);
    expect(rateLimitIndex).toBeLessThan(adminAuthIndex);
  });
});
