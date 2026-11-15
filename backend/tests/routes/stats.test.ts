import express, { type Express } from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../src/config', () => ({
  LOOKUP_EVENT_RETENTION_DAYS: 90,
}));

// Rate limiting has its own suite; here it only needs to let requests through.
jest.mock('../../src/middleware/rateLimit', () => ({
  TokenBucketLimiter: class {},
  createRateLimitMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getClientIpAddress: () => '127.0.0.1',
}));

jest.mock('../../src/services/lookupStats', () => ({
  loadStatsPage: jest.fn(),
  loadTrackedPlayersForExport: jest.fn(),
}));

import statsRouter from '../../src/routes/stats';
import { loadStatsPage, loadTrackedPlayersForExport } from '../../src/services/lookupStats';
import type { StatsPageData } from '../../src/services/lookupStats';
import type { TrackedPlayerTable } from '../../src/services/database/schema';

const player: TrackedPlayerTable = {
  identifier: '530fa96a303d42199b5a329d493a5573',
  username: 'Notch',
  stars: 123,
  nicked: false,
  lookups: 40,
  cache_hits: 30,
  last_source: 'cache',
  last_status: 200,
  last_latency_ms: 240,
  first_seen_at: new Date('2026-11-01T00:00:00Z'),
  last_looked_up_at: new Date('2026-11-15T10:00:00Z'),
};

const pageData: StatsPageData = {
  summary: {
    lookups: 100,
    cacheHits: 60,
    errors: 1,
    averageLatencyMs: 120,
    playersInRange: 12,
    trackedPlayers: 34,
    cacheEntries: 30,
  },
  chart: Array.from({ length: 24 }, (_, index) => ({
    bucket: new Date(Date.UTC(2026, 10, 15, index)),
    lookups: index,
  })),
  players: [player],
  matchingPlayers: 12,
  page: 1,
  pageSize: 50,
};

function createTestApp(): Express {
  const app = express();
  app.use('/stats', statsRouter);
  return app;
}

interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function makeRequest(app: Express, path: string): Promise<TestResponse> {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;

  const response = await new Promise<TestResponse>((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', method: 'GET', path, port: address.port },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  return response;
}

describe('GET /stats', () => {
  const app = createTestApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the tracking page for the default range', async () => {
    (loadStatsPage as jest.Mock).mockResolvedValue(pageData);

    const response = await makeRequest(app, '/stats');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('Tracked players');
    expect(response.body).toContain('Notch');
    expect(loadStatsPage).toHaveBeenCalledWith({
      range: '24h',
      sort: 'recent',
      search: '',
      page: 1,
    });
  });

  it('passes parsed filters through to the query layer', async () => {
    (loadStatsPage as jest.Mock).mockResolvedValue(pageData);

    const response = await makeRequest(app, '/stats?range=7d&sort=stars&q=Notch&page=2');

    expect(response.status).toBe(200);
    expect(loadStatsPage).toHaveBeenCalledWith({
      range: '7d',
      sort: 'stars',
      search: 'Notch',
      page: 2,
    });
  });

  it('explains a missing database instead of throwing', async () => {
    (loadStatsPage as jest.Mock).mockResolvedValue(null);

    const response = await makeRequest(app, '/stats');

    expect(response.status).toBe(503);
    expect(response.body).toContain('Tracking database unavailable');
    expect(response.body).toContain('CACHE_DB_URL');
  });

  it('degrades to the same page when the query layer throws', async () => {
    (loadStatsPage as jest.Mock).mockRejectedValue(new Error('connection reset'));

    const response = await makeRequest(app, '/stats');

    expect(response.status).toBe(503);
    expect(response.body).toContain('did not answer');
  });
});

describe('GET /stats/export.csv', () => {
  const app = createTestApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a CSV attachment with the same filters', async () => {
    (loadTrackedPlayersForExport as jest.Mock).mockResolvedValue([player]);

    const response = await makeRequest(app, '/stats/export.csv?range=7d&q=Notch');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment; filename="levelhead-tracking-');
    expect(response.body.split('\n')).toHaveLength(2);
    expect(response.body).toContain('"Notch"');
    expect(loadTrackedPlayersForExport).toHaveBeenCalledWith({
      range: '7d',
      sort: 'recent',
      search: 'Notch',
      page: 1,
    });
  });

  it('returns 503 when tracking storage is unavailable', async () => {
    (loadTrackedPlayersForExport as jest.Mock).mockResolvedValue(null);

    const response = await makeRequest(app, '/stats/export.csv');

    expect(response.status).toBe(503);
    expect(response.body).toContain('Tracking database unavailable');
  });
});
