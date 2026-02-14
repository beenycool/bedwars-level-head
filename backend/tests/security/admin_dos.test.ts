import express, { type Express } from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const executionOrder: string[] = [];


jest.mock('../../src/config', () => ({
  CRON_RATE_LIMIT_MAX: 5,
  CRON_RATE_LIMIT_WINDOW_MS: 60_000,
}));

jest.mock('../../src/middleware/rateLimit', () => ({
  enforceRateLimit: (_req: unknown, _res: unknown, next: () => void) => {
    executionOrder.push('rateLimit');
    next();
  },
  enforceAdminRateLimit: (_req: unknown, _res: unknown, next: () => void) => {
    executionOrder.push('adminRateLimit');
    next();
  },
  createRateLimitMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    executionOrder.push('rateLimit');
    next();
  },
  getClientIpAddress: () => '127.0.0.1',
}));

jest.mock('../../src/middleware/adminAuth', () => ({
  enforceAdminAuth: (_req: unknown, _res: unknown, next: () => void) => {
    executionOrder.push('apiKeyAuth');
    next();
  },
}));

jest.mock('../../src/middleware/cronAuth', () => ({
  enforceCronAuth: (_req: unknown, _res: unknown, next: () => void) => {
    executionOrder.push('cronAuth');
    next();
  },
}));

jest.mock('../../src/services/statsCache', () => ({
  buildPlayerCacheKey: jest.fn(),
  clearAllPlayerStatsCaches: jest.fn().mockResolvedValue(0),
  deleteIgnMappings: jest.fn().mockResolvedValue(0),
  deletePlayerStatsEntries: jest.fn().mockResolvedValue(0),
  getIgnMapping: jest.fn(),
  getPlayerStatsFromCache: jest.fn(),
}));

jest.mock('../../src/services/player', () => ({
  clearInMemoryPlayerCache: jest.fn(),
}));

jest.mock('../../src/services/apiKeyManager', () => ({
  storeApiKey: jest.fn().mockResolvedValue({
    keyHash: 'a'.repeat(16),
    lastValidatedAt: Date.now(),
    validationStatus: 'valid',
    validatedCount: 1,
    errorMessage: null,
  }),
  validateApiKey: jest.fn().mockResolvedValue({
    keyHash: 'a'.repeat(16),
    lastValidatedAt: Date.now(),
    validationStatus: 'valid',
    validatedCount: 1,
    errorMessage: null,
  }),
  getApiKeyValidation: jest.fn(),
  getApiKeyValidationByHash: jest.fn(),
  listApiKeys: jest.fn().mockResolvedValue([]),
  deleteApiKey: jest.fn(),
  formatTimeAgo: jest.fn().mockReturnValue('just now'),
  summarizeApiKeyStatuses: jest.fn().mockResolvedValue({ total: 0, valid: 0, invalid: 0, pending: 0, unknown: 0 }),
  isValidApiKeyFormat: jest.fn().mockReturnValue(true),
}));

import adminRouter from '../../src/routes/admin';
import apikeyRouter from '../../src/routes/apikey';
import cronRouter from '../../src/routes/cron';

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use('/api/admin/apikey', apikeyRouter);
  app.use('/api/cron', cronRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    res.status(500).json({ message });
  });
  return app;
}

async function makeRequest(app: Express, method: string, path: string, body?: unknown) {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;

  const payload = body ? JSON.stringify(body) : undefined;

  const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        method,
        path,
        port: address.port,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: data ? JSON.parse(data) : undefined,
          });
        });
      },
    );

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  return response;
}

describe('Middleware order regression tests for CPU exhaustion protection', () => {
  const app = createTestApp();

  beforeEach(() => {
    executionOrder.length = 0;
  });

  it('runs rate limiting before admin auth on /api/admin/cache/purge', async () => {
    const response = await makeRequest(app, 'POST', '/api/admin/cache/purge', {});

    expect(response.status).toBe(202);
    expect(executionOrder).toEqual(['adminRateLimit', 'apiKeyAuth']);
  });

  it('runs rate limiting before admin auth on /api/admin/apikey/validate', async () => {
    const response = await makeRequest(app, 'POST', '/api/admin/apikey/validate', {
      key: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(response.status).toBe(200);
    expect(executionOrder).toEqual(['adminRateLimit', 'apiKeyAuth']);
  });

  it('runs rate limiting before cron auth on /api/cron/ping', async () => {
    const response = await makeRequest(app, 'POST', '/api/cron/ping');

    expect(response.status).toBe(200);
    expect(executionOrder).toEqual(['rateLimit', 'cronAuth']);
  });
});
