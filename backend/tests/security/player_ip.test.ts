import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

// Mock dependencies
jest.mock('../../src/services/cache', () => ({}));
jest.mock('../../src/services/redis', () => ({
  getRedisClient: jest.fn(),
}));
jest.mock('../../src/services/hypixelTracker', () => ({}));
jest.mock('../../src/services/statsCache', () => ({
  getPlayerStatsFromCache: jest.fn().mockResolvedValue({}),
  setPlayerStatsBoth: jest.fn(),
  setIgnMapping: jest.fn(),
}));
jest.mock('../../src/services/history', () => ({
  recordQuerySafely: jest.fn(),
}));

const mockGetClientIpAddress = jest.fn().mockReturnValue('127.0.0.1');

jest.mock('../../src/middleware/rateLimit', () => ({
  enforceRateLimit: (req: any, res: any, next: any) => next(),
  enforceBatchRateLimit: (req: any, res: any, next: any) => next(),
  getClientIpAddress: (...args: any[]) => mockGetClientIpAddress(...args),
}));

// Mock validation util to bypass Redis checks
jest.mock('../../src/util/validation', () => ({
  validatePlayerSubmission: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  validateTimestampAndNonce: jest.fn().mockResolvedValue({ valid: true }),
  matchesCriticalFields: jest.fn().mockReturnValue(true),
}));

// Mock hypixel service to avoid external calls
jest.mock('../../src/services/hypixel', () => ({
  fetchHypixelPlayer: jest.fn().mockResolvedValue({
    payload: { player: { displayname: 'TestPlayer' } },
    notModified: false,
  }),
  isValidBedwarsObject: jest.fn().mockReturnValue(true),
}));

import playerRouter from '../../src/routes/player';

const app = express();
app.use(express.json());
app.use('/api/player', playerRouter);
// Add error handler to prevent 500s from crashing test
app.use((err: any, req: any, res: any, next: any) => {
    res.status(500).json({ error: err.message });
});

async function makeRequest(app: express.Express, method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      const payload = body ? JSON.stringify(body) : undefined;

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
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              body: data ? JSON.parse(data) : undefined,
            });
          });
        },
      );

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (payload) {
        req.write(payload);
      }

      req.end();
    });
  });
}

describe('Security: Player Submission IP Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use getClientIpAddress for resolving submitter identity', async () => {
    const payload = {
      uuid: '550e8400e29b41d4a716446655440000',
      data: {
        bedwars_experience: 1000,
        final_kills_bedwars: 10,
        final_deaths_bedwars: 5,
        displayname: 'TestPlayer',
      },
      signature: 'test-signature',
    };

    // In the current implementation (before fix), getClientIpAddress is NOT called for keyId generation.
    // It uses req.ip directly.
    // getClientIpAddress IS called by enforceRateLimit middleware, but we mocked enforceRateLimit to bypass it.
    // So if getClientIpAddress is called, it MUST be from buildSubmitterKeyId.

    await makeRequest(app, 'POST', '/api/player/submit', payload);

    // Verification: getClientIpAddress should have been called
    expect(mockGetClientIpAddress).toHaveBeenCalled();
  });
});
