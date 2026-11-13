import express, { type Express } from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../src/services/player', () => ({
  resolvePlayer: jest.fn(),
  warmupPlayerCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/hypixel', () => ({
  getCircuitBreakerState: jest.fn().mockReturnValue({ state: 'closed', failureCount: 0, lastFailureAt: null, nextRetryAt: null }),
}));

jest.mock('../../src/middleware/rateLimitPublic', () => ({
  enforcePublicRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  enforcePublicBatchRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import playerPublicRouter from '../../src/routes/playerPublic';
import { resolvePlayer } from '../../src/services/player';
import { getCircuitBreakerState } from '../../src/services/hypixel';
import { HttpError } from '../../src/util/httpError';

const UUIDS = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(32, '0'));

function payloadFor(uuid: string) {
  return {
    displayname: `Player${uuid.slice(-1)}`,
    bedwars_experience: 1000,
    bedwars_final_kills: 1,
    bedwars_final_deaths: 1,
    duels_wins: 0,
    duels_losses: 0,
    duels_kills: 0,
    duels_deaths: 0,
    skywars_experience: null,
    skywars_wins: 0,
    skywars_losses: 0,
    skywars_kills: 0,
    skywars_deaths: 0,
  };
}

function resolvedFor(uuid: string) {
  return {
    payload: payloadFor(uuid),
    etag: null,
    lastModified: null,
    source: 'network' as const,
    revalidated: false,
    uuid,
    username: `Player${uuid.slice(-1)}`,
    lookupType: 'uuid' as const,
    lookupValue: uuid,
    nicked: false,
  };
}

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/public/player', playerPublicRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number })?.status ?? 500;
    const cause = (err as { causeCode?: string })?.causeCode;
    res.status(status).json({ success: false, cause, message: (err as Error)?.message });
  });
  return app;
}

async function postBatch(app: Express, uuids: string[]) {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;

  const response = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const body = JSON.stringify({ uuids });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        method: 'POST',
        path: '/api/public/player/batch',
        port: address.port,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return response;
}

describe('POST /api/public/player/batch failure isolation', () => {
  const app = createTestApp();

  beforeEach(() => {
    jest.clearAllMocks();
    (getCircuitBreakerState as jest.Mock).mockReturnValue({
      state: 'closed',
      failureCount: 0,
      lastFailureAt: null,
      nextRetryAt: null,
    });
  });

  it('keeps the other nine players when one identifier hits an upstream 5xx', async () => {
    (resolvePlayer as jest.Mock).mockImplementation(async (identifier: string) => {
      if (identifier === UUIDS[4]) {
        throw new HttpError(502, 'HYPIXEL_ERROR', 'Hypixel responded with status 500.');
      }
      return resolvedFor(identifier);
    });

    const response = await postBatch(app, UUIDS);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const data = response.body.data as Record<string, unknown>;
    expect(Object.keys(data)).toHaveLength(9);
    expect(data[UUIDS[4]]).toBeUndefined();
  });

  it('keeps the batch alive when one identifier is rate limited by Hypixel', async () => {
    (resolvePlayer as jest.Mock).mockImplementation(async (identifier: string) => {
      if (identifier === UUIDS[0]) {
        throw new HttpError(429, 'HYPIXEL_RATE_LIMIT', 'Hypixel rate limited the backend.');
      }
      return resolvedFor(identifier);
    });

    const response = await postBatch(app, UUIDS);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data as Record<string, unknown>)).toHaveLength(9);
  });

  it('keeps the batch alive when one identifier hits an upstream 503', async () => {
    (resolvePlayer as jest.Mock).mockImplementation(async (identifier: string) => {
      if (identifier === UUIDS[7]) {
        throw new HttpError(503, 'UPSTREAM_UNAVAILABLE', 'Upstream unavailable.');
      }
      return resolvedFor(identifier);
    });

    const response = await postBatch(app, UUIDS);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data as Record<string, unknown>)).toHaveLength(9);
  });

  it('fails the whole batch with 503 when the upstream is unusable for every identifier', async () => {
    (resolvePlayer as jest.Mock).mockRejectedValue(
      new HttpError(503, 'HYPIXEL_CIRCUIT_OPEN', 'Hypixel circuit breaker is open.'),
    );

    const response = await postBatch(app, UUIDS);

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, cause: 'UPSTREAM_UNAVAILABLE' });
  });

  it('fails fast with 503 when the circuit breaker is already open', async () => {
    (getCircuitBreakerState as jest.Mock).mockReturnValue({
      state: 'open',
      failureCount: 5,
      lastFailureAt: Date.now(),
      nextRetryAt: Date.now() + 30000,
    });

    const response = await postBatch(app, UUIDS);

    expect(response.status).toBe(503);
    expect(resolvePlayer).not.toHaveBeenCalled();
  });
});
