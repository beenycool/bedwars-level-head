import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../src/config', () => ({
  PUBLIC_RATE_LIMIT_MAX: 3,
  PUBLIC_RATE_LIMIT_WINDOW_MS: 60000,
  PUBLIC_REQUEST_LIMIT_MAX: 1200,
  DYNAMIC_RATE_LIMIT_ENABLED: false,
  DYNAMIC_RATE_LIMIT_MIN: 1,
  DYNAMIC_RATE_LIMIT_MAX: 3,
  DYNAMIC_RATE_LIMIT_CACHE_TTL_MS: 10000,
  HYPIXEL_HOURLY_QUOTA: 7200,
  ADMIN_API_KEYS: [],
  TRUST_PROXY_CIDRS: [],
  TRUST_SINGLE_PROXY_HOP: false,
  PLAYER_CACHE_DB_TTL_MS: 86400000,
  CACHE_DB_URL: '',
  LOOKUP_TRACKING_ENABLED: true,
  LOOKUP_LOG_RETENTION_DAYS: 7,
  HYPIXEL_API_KEY: 'test-key',
  HYPIXEL_API_BASE_URL: 'https://api.hypixel.net',
  HYPIXEL_TIMEOUT_MS: 5000,
  HYPIXEL_RETRY_DELAY_MIN_MS: 50,
  HYPIXEL_RETRY_DELAY_MAX_MS: 150,
  CB_FAILURE_THRESHOLD: 5,
  CB_RESET_TIMEOUT_MS: 30000,
  OUTBOUND_USER_AGENT: 'Levelhead/Test',
}));

jest.mock('../../src/services/cache', () => ({
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  isDatabaseReady: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/hypixel', () => ({
  checkHypixelReachability: jest.fn().mockResolvedValue(true),
  getCircuitBreakerState: jest.fn().mockReturnValue({
    state: 'closed',
    failureCount: 0,
    lastFailureAt: null,
    nextRetryAt: null,
  }),
}));

jest.mock('../../src/services/player', () => ({
  resolvePlayer: jest.fn(),
  warmupPlayerCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/statsCache', () => ({
  buildPlayerCacheKey: (uuid: string) => `player:${uuid}`,
  clearAllPlayerStatsCaches: jest.fn(),
  deletePlayerStatsEntries: jest.fn(),
}));

import { createApp } from '../../src/app';
import { TokenBucketLimiter, publicRateLimiter } from '../../src/middleware/rateLimit';
import { resolvePlayer } from '../../src/services/player';

const UUID = '530fa96a303d42199b5a329d493a5573';

describe('TokenBucketLimiter', () => {
  it('admits a full lobby-sized burst and denies the next identifier', () => {
    const limiter = new TokenBucketLimiter({ capacity: 600, windowMs: 60_000 });
    const now = 1_000_000;

    for (let i = 0; i < 600; i++) {
      expect(limiter.consume('public:1.2.3.4', 1, now).allowed).toBe(true);
    }

    const denied = limiter.consume('public:1.2.3.4', 1, now);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('charges one token per identifier and refills over the window', () => {
    const limiter = new TokenBucketLimiter({ capacity: 100, windowMs: 60_000 });
    expect(limiter.consume('ip', 100, 0).allowed).toBe(true);
    expect(limiter.consume('ip', 1, 0).allowed).toBe(false);

    // 60s later the bucket is full again.
    expect(limiter.consume('ip', 100, 60_000).allowed).toBe(true);
  });

  it('keeps buckets isolated per client', () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, windowMs: 60_000 });
    expect(limiter.consume('a', 1, 0).allowed).toBe(true);
    expect(limiter.consume('a', 1, 0).allowed).toBe(false);
    expect(limiter.consume('b', 1, 0).allowed).toBe(true);
  });

  it('follows a dynamic ceiling without letting it exceed the hard cap', () => {
    let ceiling = 10;
    const limiter = new TokenBucketLimiter({
      capacity: 10,
      windowMs: 60_000,
      getCapacity: () => ceiling,
    });

    expect(limiter.consume('ip', 10, 0).allowed).toBe(true);
    expect(limiter.consume('ip', 1, 0).allowed).toBe(false);

    // Clamped to the hard cap even if the provider asks for more.
    ceiling = 1_000;
    expect(limiter.consume('ip', 10, 60_000).allowed).toBe(true);

    // A smaller ceiling takes effect on the next refill.
    ceiling = 2;
    expect(limiter.consume('ip', 2, 120_000).allowed).toBe(true);
    expect(limiter.consume('ip', 1, 120_000).allowed).toBe(false);
  });

  it('counts only clients active inside the current window', () => {
    const limiter = new TokenBucketLimiter({ capacity: 5, windowMs: 1_000 });

    limiter.consume('a', 1, 0);
    limiter.consume('b', 1, 500);
    expect(limiter.activeClients(500)).toBe(2);
    expect(limiter.activeClients(2_000)).toBe(0);
  });

  it('refunds cached identifiers without exceeding the bucket ceiling', () => {
    const limiter = new TokenBucketLimiter({ capacity: 3, windowMs: 60_000 });

    expect(limiter.consume('ip', 3, 0).allowed).toBe(true);
    expect(limiter.consume('ip', 1, 0).allowed).toBe(false);

    limiter.refund('ip', 2, 0);
    expect(limiter.consume('ip', 2, 0).allowed).toBe(true);
    expect(limiter.consume('ip', 1, 0).allowed).toBe(false);

    // A refund for an unknown key is a no-op, not a crash.
    expect(() => limiter.refund('missing', 5, 0)).not.toThrow();
  });
});

describe('/healthz is never rate limited', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    publicRateLimiter.reset();
    (resolvePlayer as jest.Mock).mockResolvedValue({
      payload: { displayname: 'TestPlayer', bedwars_experience: 1 },
      etag: null,
      lastModified: null,
      source: 'network',
      username: 'TestPlayer',
      nicked: false,
    });
  });

  it('still answers 200 after the public bucket is exhausted', async () => {
    const first = await request(app, '/api/public/player/' + UUID);
    const second = await request(app, '/api/public/player/' + UUID);
    const third = await request(app, '/api/public/player/' + UUID);
    const throttled = await request(app, '/api/public/player/' + UUID);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(throttled.status).toBe(429);
    expect(throttled.headers['retry-after']).toBeDefined();

    const health = await request(app, '/healthz');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
  });
});

describe('cached lookups refund their identifier tokens', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    publicRateLimiter.reset();
    (resolvePlayer as jest.Mock).mockResolvedValue({
      payload: { displayname: 'TestPlayer', bedwars_experience: 1 },
      etag: null,
      lastModified: null,
      source: 'cache',
      username: 'TestPlayer',
      nicked: false,
    });
  });

  it('serves more than the three-token budget when every lookup is cached', async () => {
    for (let i = 0; i < 6; i += 1) {
      const response = await request(app, '/api/public/player/' + UUID);
      expect(response.status).toBe(200);
    }
  });
});

async function request(
  app: express.Express,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;

  const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', method: 'GET', path, port: address.port }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data ? JSON.parse(data) : {} }),
      );
    });
    req.on('error', reject);
    req.end();
  });

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return response;
}
