import express, { type Express } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';

/**
 * Contract test: the backend side of contract/player-stats.json.
 *
 * Hypixel is mocked at the service boundary with the fixture's upstream payload.
 * Everything below that boundary is production code: the handler, resolvePlayer,
 * shapePayload, extractMinimalStats and the HTTP response assembly.
 */
jest.mock('../../src/services/statsCache', () => ({
  buildPlayerCacheKey: (uuid: string) => `player:${uuid}`,
  getPlayerStats: jest.fn().mockResolvedValue(null),
  getManyPlayerStats: jest.fn().mockResolvedValue(new Map()),
  setPlayerStats: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/hypixel', () => {
  const actual = jest.requireActual('../../src/services/hypixel');
  return {
    ...actual,
    fetchHypixelPlayer: jest.fn(),
  };
});

import { createPlayerBatchHandler, createPlayerLookupHandler } from '../../src/routes/playerHandlers';
import { clearInMemoryPlayerCache } from '../../src/services/player';
import { fetchHypixelPlayer, shapePayload } from '../../src/services/hypixel';
import { MAX_BATCH_SIZE } from '../../src/util/validationConstants';

interface ContractCase {
  mode: 'BEDWARS' | 'DUELS' | 'SKYWARS';
  uuid: string;
  upstream: Record<string, unknown>;
  minimalStats: Record<string, unknown>;
  expectedTag: string;
}

interface ContractFixture {
  schemaVersion: number;
  cases: ContractCase[];
}

const fixturePath = path.resolve(__dirname, '../../../contract/player-stats.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ContractFixture;

function upstreamFor(uuid: string): ContractCase {
  const contractCase = fixture.cases.find((entry) => entry.uuid === uuid);
  if (!contractCase) {
    throw new Error(`No contract fixture for ${uuid}`);
  }
  return contractCase;
}

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.get(
    '/player/:identifier',
    createPlayerLookupHandler({
      private: false,
      setStaleHeaders: false,
      cacheControl: 'no-store',
    }),
  );
  app.post(
    '/player/batch',
    createPlayerBatchHandler({
      batchSize: MAX_BATCH_SIZE,
    }),
  );
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number })?.status ?? 500;
    const cause = (err as { causeCode?: string })?.causeCode;
    res.status(status).json({ success: false, cause, message: (err as Error)?.message });
  });
  return app;
}

async function request(
  app: Express,
  method: string,
  requestPath: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const serialized = body === undefined ? undefined : JSON.stringify(body);

  const response = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        method,
        path: requestPath,
        port: address.port,
        headers: serialized
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) }
          : undefined,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} }));
      },
    );
    req.on('error', reject);
    req.end(serialized);
  });

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return response;
}

describe('player-stats contract fixture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearInMemoryPlayerCache();

    (fetchHypixelPlayer as jest.Mock).mockImplementation(async (uuid: string) => {
      const contractCase = upstreamFor(uuid);
      return {
        // Production reshaping runs; only the upstream HTTP call is mocked.
        payload: shapePayload(contractCase.upstream as unknown as Parameters<typeof shapePayload>[0]),
        etag: null,
        lastModified: null,
      };
    });
  });

  it('emits exactly the fixture minimal stats for every mode in a batch', async () => {
    const app = createTestApp();
    const uuids = fixture.cases.map((entry) => entry.uuid);

    const response = await request(app, 'POST', '/player/batch', { uuids });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const data = response.body.data as Record<string, Record<string, unknown>>;
    expect(Object.keys(data).sort()).toEqual([...uuids].sort());

    for (const contractCase of fixture.cases) {
      expect(data[contractCase.uuid]).toEqual({ ...contractCase.minimalStats, nicked: false });
    }
  });

  it.each(fixture.cases.map((entry) => [entry.mode, entry] as const))(
    'emits the fixture minimal stats for a single %s lookup',
    async (_mode, contractCase) => {
      const app = createTestApp();

      const response = await request(app, 'GET', `/player/${contractCase.uuid}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...contractCase.minimalStats, nicked: false });
    },
  );
});
