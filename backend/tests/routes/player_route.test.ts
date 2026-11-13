import express, { type Express } from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../src/config', () => ({
  PUBLIC_RATE_LIMIT_MAX: 600,
  PUBLIC_RATE_LIMIT_WINDOW_MS: 60000,
  ADMIN_API_KEYS: [],
  TRUST_PROXY_CIDRS: [],
  TRUST_SINGLE_PROXY_HOP: false,
  PLAYER_CACHE_DB_TTL_MS: 86400000,
  HYPIXEL_API_KEY: 'test-key',
  HYPIXEL_API_BASE_URL: 'https://api.hypixel.net',
  HYPIXEL_TIMEOUT_MS: 5000,
  HYPIXEL_RETRY_DELAY_MIN_MS: 50,
  HYPIXEL_RETRY_DELAY_MAX_MS: 150,
  CB_FAILURE_THRESHOLD: 5,
  CB_RESET_TIMEOUT_MS: 30000,
  OUTBOUND_USER_AGENT: 'Levelhead/Test',
}));

jest.mock('../../src/middleware/rateLimit', () => ({
  enforceRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  enforceBatchRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../src/services/player', () => ({
  resolvePlayer: jest.fn(),
  warmupPlayerCache: jest.fn(),
}));

jest.mock('../../src/services/hypixel', () => ({
  getCircuitBreakerState: jest.fn().mockReturnValue({
    state: 'closed',
    failureCount: 0,
    lastFailureAt: null,
    nextRetryAt: null,
  }),
}));

import playerRouter from '../../src/routes/player';
import { resolvePlayer } from '../../src/services/player';

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/player', playerRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    const status = (err as { status?: number })?.status ?? 500;
    const code = (err as { causeCode?: string })?.causeCode;
    res.status(status).json({ message, ...(code ? { code } : {}) });
  });
  return app;
}

async function makeRequest(
  app: Express,
  method: string,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;

  const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        method,
        path,
        port: address.port,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: data ? JSON.parse(data) : {},
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  return response;
}

const baseResolved = {
  payload: {
    displayname: 'TestPlayer',
    bedwars_experience: 12345,
    bedwars_final_kills: 10,
    bedwars_final_deaths: 5,
    duels_wins: 0,
    duels_losses: 0,
    duels_kills: 0,
    duels_deaths: 0,
    skywars_experience: null,
    skywars_wins: 0,
    skywars_losses: 0,
    skywars_kills: 0,
    skywars_deaths: 0,
  },
  etag: '"base-etag-123"',
  lastModified: Date.now() - 1000,
  source: 'network' as const,
  revalidated: false,
  uuid: '530fa96a303d42199b5a329d493a5573',
  username: 'TestPlayer',
  lookupType: 'uuid' as const,
  lookupValue: '530fa96a303d42199b5a329d493a5573',
  nicked: false,
};

describe('GET /api/player/:identifier happy path', () => {
  const app = createTestApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with a computed ETag instead of throwing ReferenceError', async () => {
    (resolvePlayer as jest.Mock).mockResolvedValue({ ...baseResolved });

    const response = await makeRequest(app, 'GET', '/api/player/530fa96a303d42199b5a329d493a5573');

    expect(response.status).toBe(200);
    expect(response.headers['etag']).toBe('"player-v2-valid-base-etag-123"');
    expect(response.headers['x-cache']).toBe('MISS');
    expect(response.headers['last-modified']).toBeDefined();
    expect(response.body).toMatchObject({
      displayname: 'TestPlayer',
      nicked: false,
    });
    expect(response.body.stale).toBeUndefined();
  });

  it('marks nicked players in the ETag variant and payload', async () => {
    (resolvePlayer as jest.Mock).mockResolvedValue({
      ...baseResolved,
      nicked: true,
      payload: { ...baseResolved.payload, displayname: '(nicked)' },
    });

    const response = await makeRequest(app, 'GET', '/api/player/530fa96a303d42199b5a329d493a5573');

    expect(response.status).toBe(200);
    expect(response.headers['etag']).toBe('"player-v2-nicked-base-etag-123"');
    expect(response.body.nicked).toBe(true);
  });

  it('exposes stale SWR responses with stale headers and payload flag', async () => {
    (resolvePlayer as jest.Mock).mockResolvedValue({
      ...baseResolved,
      source: 'cache' as const,
      isStale: true,
      staleAgeMs: 30_000,
    });

    const response = await makeRequest(app, 'GET', '/api/player/530fa96a303d42199b5a329d493a5573');

    expect(response.status).toBe(200);
    expect(response.headers['x-cache']).toBe('HIT');
    expect(response.headers['x-cache-stale']).toBe('1');
    expect(response.headers['age']).toBe('30');
    expect(response.body.stale).toBe(true);
  });

  it('propagates clean errors from the player service (no ETag written)', async () => {
    const { HttpError } = jest.requireActual<typeof import('../../src/util/httpError')>('../../src/util/httpError');
    (resolvePlayer as jest.Mock).mockRejectedValue(new HttpError(404, 'PLAYER_NOT_FOUND', 'Player not found.'));

    const response = await makeRequest(app, 'GET', '/api/player/530fa96a303d42199b5a329d493a5573');

    expect(response.status).toBe(404);
    // Express may add its own weak ETag for the JSON body; the player ETag must not be present.
    expect(response.headers['etag'] ?? '').not.toContain('player-v2');
    expect(response.body).toMatchObject({ code: 'PLAYER_NOT_FOUND' });
  });
});
