import express, { type Express } from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../src/config', () => ({
  LOOKUP_LOG_RETENTION_DAYS: 7,
}));

// Rate limiting has its own suite; here it only needs to let requests through.
jest.mock('../../src/middleware/rateLimit', () => ({
  TokenBucketLimiter: class {},
  createRateLimitMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getClientIpAddress: () => '127.0.0.1',
}));

jest.mock('../../src/services/lookupStats', () => ({
  loadStatsPage: jest.fn(),
  loadLookupRowsForExport: jest.fn(),
}));

import statsRouter from '../../src/routes/stats';
import { loadLookupRowsForExport, loadStatsPage } from '../../src/services/lookupStats';
import type { StatsPageData } from '../../src/services/lookupStats';
import type { LookupLogTable } from '../../src/services/database/schema';

const lookup: LookupLogTable = {
  id: '1',
  looked_up_at: new Date('2026-11-15T10:00:00Z'),
  identifier: '530fa96a303d42199b5a329d493a5573',
  username: 'Notch',
  stars: 123,
  nicked: false,
  source: 'cache',
  route: 'public',
  status: 200,
  latency_ms: 240,
};

const pageData: StatsPageData = {
  summary: {
    total: 100,
    cacheHits: 60,
    success: 99,
    errors: 1,
    players: 12,
    apiCallsLastHour: 40,
    latency: { p50: 100, p95: 120, p99: 200, min: 10, max: 400, avg: 130 },
    cacheEntries: 30,
    databaseSize: '8.9 MB',
    indexSize: '1.2 MB',
  },
  charts: {
    series: [{ bucket: new Date('2026-11-15T10:00:00Z'), total: 100, cacheHits: 60, avgLatency: 130, p95Latency: 120 }],
    statuses: [{ label: '200', count: 99 }],
    stars: [{ label: '100-199', count: 1 }],
    latencyHistogram: [{ label: '100-250', count: 1 }],
    routes: [{ label: 'public', count: 100 }],
    topPlayers: [{ identifier: lookup.identifier, username: 'Notch', count: 1 }],
  },
  rows: [lookup],
  matching: 12,
  page: 1,
  pageSize: 50,
  runtime: {
    rssMb: 90,
    heapMb: 40,
    heapTotalMb: 70,
    cpuPercent: 1,
    bufferSize: 2,
    samples: [],
    rateLimitKeys: 1,
    rateLimitBudget: 600,
    rateLimitWindowMs: 60_000,
    rateLimitMode: 'dynamic',
    rateLimitMin: 20,
    rateLimitMax: 600,
    rateLimitActiveClients: 1,
    rateLimitNetworkCalls: 40,
    rateLimitCacheHitRate: 0.6,
    rateLimitHypixelRemaining: 7_160,
  },
};

const defaultQuery = {
  range: '24h',
  from: null,
  to: null,
  limit: 50,
  metric: 'p95',
  sort: 'recent',
  search: '',
  page: 1,
  refresh: 0,
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

  it('renders the analytics page for the default filters', async () => {
    (loadStatsPage as jest.Mock).mockResolvedValue(pageData);

    const response = await makeRequest(app, '/stats');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('Levelhead Analytics');
    expect(response.body).toContain('Recent Player Lookups');
    expect(response.body).toContain('Notch');
    expect(loadStatsPage).toHaveBeenCalledWith(defaultQuery);
  });

  it('passes parsed filters through to the query layer', async () => {
    (loadStatsPage as jest.Mock).mockResolvedValue(pageData);

    const response = await makeRequest(app, '/stats?range=7d&sort=stars&q=Notch&page=2&metric=p99');

    expect(response.status).toBe(200);
    expect(loadStatsPage).toHaveBeenCalledWith({
      ...defaultQuery,
      range: '7d',
      sort: 'stars',
      search: 'Notch',
      page: 2,
      metric: 'p99',
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
    (loadLookupRowsForExport as jest.Mock).mockResolvedValue([lookup]);

    const response = await makeRequest(app, '/stats/export.csv?range=7d&q=Notch');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment; filename="levelhead-lookups-');
    expect(response.body.split('\n')).toHaveLength(2);
    expect(response.body).toContain('"looked_up_at"');
    expect(response.body).toContain('"Notch"');
    expect(loadLookupRowsForExport).toHaveBeenCalledWith({
      ...defaultQuery,
      range: '7d',
      search: 'Notch',
    });
  });

  it('returns 503 when tracking storage is unavailable', async () => {
    (loadLookupRowsForExport as jest.Mock).mockResolvedValue(null);

    const response = await makeRequest(app, '/stats/export.csv');

    expect(response.status).toBe(503);
    expect(response.body).toContain('Tracking database unavailable');
  });
});
