import express from 'express';
import { createServer } from 'http';
import { AddressInfo } from 'net';

// Mocks must be hoisted
const executionOrder: string[] = [];

// Mock middleware implementations
jest.mock('../../src/middleware/rateLimit', () => ({
  enforceRateLimit: (req: any, res: any, next: any) => {
    executionOrder.push('rateLimit');
    next();
  },
}));

jest.mock('../../src/middleware/adminAuth', () => ({
  enforceAdminAuth: (req: any, res: any, next: any) => {
    executionOrder.push('adminAuth');
    next();
  },
}));

// Mock services to avoid side effects
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

// Import router AFTER mocks
import adminRouter from '../../src/routes/admin';

describe('Admin Route Security Middleware Order', () => {
  let server: any;
  let url: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    server = createServer(app);
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      url = `http://localhost:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    executionOrder.length = 0;
  });

  it('should enforce rate limiting BEFORE authentication to prevent CPU exhaustion DoS', async () => {
    // We need to suppress the error handling in admin.ts for this test since we are not sending valid auth
    // actually, since we mocked adminAuth to calling next(), it will succeed auth check!

    await fetch(`${url}/api/admin/cache/purge`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });

    // This assertion confirms the FIXED state where rate limiting runs before auth (CPU intensive)
    expect(executionOrder).toEqual(['rateLimit', 'adminAuth']);
  });
});
