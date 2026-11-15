import { sql } from 'kysely';

/**
 * Opt-in integration suite: exercises the real PostgreSQL statements (multi-row
 * inserts, percentile aggregates, grouped charts, prune) against a throwaway
 * database. Skipped unless `TEST_DB_URL` is set, so `npm test` stays offline.
 *
 *   TEST_DB_URL=postgresql://postgres@127.0.0.1:55432/levelhead_test npx jest integration
 */

const TEST_DB_URL = process.env.TEST_DB_URL;
const describeIntegration = TEST_DB_URL ? describe : describe.skip;

const UUID_NOTCH = 'a'.repeat(32);
const UUID_JEB = 'b'.repeat(32);

const observation = (overrides: Record<string, unknown> = {}) => ({
  identifier: UUID_NOTCH,
  username: 'Notch',
  bedwarsExperience: 12_345,
  nicked: false,
  source: 'network' as const,
  status: 200,
  latencyMs: 120,
  ...overrides,
});

const query = (overrides: Record<string, unknown> = {}) => ({
  range: '24h' as const,
  from: null,
  to: null,
  limit: 50,
  metric: 'p95' as const,
  sort: 'recent' as const,
  search: '',
  page: 1,
  refresh: 0,
  ...overrides,
});

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) {
      return value;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('timed out waiting for the tracking write');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describeIntegration('lookup analytics against PostgreSQL', () => {
  let db: typeof import('../../src/services/database/db').db;
  let recordLookups: typeof import('../../src/services/lookupTracking').recordLookups;
  let pruneLookupLogs: typeof import('../../src/services/lookupTracking').pruneLookupLogs;
  let loadStatsPage: typeof import('../../src/services/lookupStats').loadStatsPage;

  beforeAll(async () => {
    const databaseModule = await import('../../src/services/database/db');
    const trackingModule = await import('../../src/services/lookupTracking');
    const statsModule = await import('../../src/services/lookupStats');
    const cacheModule = await import('../../src/services/cache');

    db = databaseModule.db;
    recordLookups = trackingModule.recordLookups;
    pruneLookupLogs = trackingModule.pruneLookupLogs;
    loadStatsPage = statsModule.loadStatsPage;

    await cacheModule.ensureInitialized();
  });

  beforeEach(async () => {
    await sql`TRUNCATE lookup_log, tracked_players`.execute(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('writes one log row per lookup and keeps player counters', async () => {
    recordLookups(
      [
        observation(),
        observation({
          identifier: UUID_JEB,
          username: 'Jeb',
          bedwarsExperience: 487_000,
          source: 'cache',
          latencyMs: 10,
        }),
      ],
      'batch',
    );

    await waitFor(
      async () => {
        const row = await db
          .selectFrom('lookup_log')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .executeTakeFirst();
        return Number(row?.count ?? 0);
      },
      (count) => count === 2,
    );

    recordLookups([observation({ source: 'cache', latencyMs: 15 })], 'public');

    const notch = await waitFor(
      () => db.selectFrom('tracked_players').selectAll().where('identifier', '=', UUID_NOTCH).executeTakeFirst(),
      (row) => Number(row?.lookups ?? 0) === 2,
    );

    expect(notch).toMatchObject({
      username: 'Notch',
      stars: 5,
      cache_hits: 1,
      last_source: 'cache',
      last_status: 200,
      last_latency_ms: 15,
    });

    const log = await db.selectFrom('lookup_log').selectAll().orderBy('id').execute();
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ identifier: UUID_NOTCH, source: 'network', route: 'batch', status: 200, latency_ms: 120 });
    expect(log[1]).toMatchObject({ identifier: UUID_JEB, stars: 100, source: 'cache', route: 'batch' });
    expect(log[2]).toMatchObject({ identifier: UUID_NOTCH, source: 'cache', route: 'public', latency_ms: 15 });
  });

  it('aggregates the summary, percentiles and every chart', async () => {
    recordLookups(
      [
        observation(),
        observation({ identifier: UUID_JEB, username: 'Jeb', bedwarsExperience: 487_000, source: 'cache', latencyMs: 10 }),
      ],
      'batch',
    );
    await waitFor(
      () => db.selectFrom('lookup_log').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst(),
      (row) => Number(row?.count ?? 0) === 2,
    );
    recordLookups([observation({ source: 'cache', latencyMs: 15 })], 'public');
    await waitFor(
      () => db.selectFrom('lookup_log').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst(),
      (row) => Number(row?.count ?? 0) === 3,
    );

    const page = await loadStatsPage(query());

    expect(page).not.toBeNull();
    expect(page?.summary).toMatchObject({
      total: 3,
      cacheHits: 2,
      success: 3,
      errors: 0,
      players: 2,
    });
    expect(page?.summary.latency.avg).toBeCloseTo(145 / 3, 1);
    expect(page?.summary.latency.p50).toBe(15);
    expect(page?.summary.latency.max).toBe(120);
    expect(page?.summary.databaseSize).toMatch(/kB|MB|GB/);
    expect(page?.charts.series).toHaveLength(1);
    expect(page?.charts.series[0].total).toBe(3);
    expect(page?.charts.statuses).toEqual([{ label: '200', count: 3 }]);
    expect(page?.charts.stars).toEqual(
      expect.arrayContaining([
        { label: '0-9', count: 2 },
        { label: '100-199', count: 1 },
      ]),
    );
    expect(page?.charts.routes).toEqual(
      expect.arrayContaining([
        { label: 'batch', count: 2 },
        { label: 'public', count: 1 },
      ]),
    );
    expect(page?.charts.topPlayers[0]).toMatchObject({ identifier: UUID_NOTCH, count: 2 });
    expect(page?.charts.latencyHistogram).toEqual(
      expect.arrayContaining([{ label: '100-250', count: 1 }]),
    );
    expect(page?.rows).toHaveLength(3);
    expect(page?.matching).toBe(3);

    const search = await loadStatsPage(query({ search: 'jeb' }));
    expect(search?.rows).toHaveLength(1);
    expect(search?.rows[0].username).toBe('Jeb');
    expect(search?.matching).toBe(1);

    const slowest = await loadStatsPage(query({ sort: 'slowest' }));
    expect(slowest?.rows[0].latency_ms).toBe(120);
  });

  it('logs failures and counts them as errors without creating a player row', async () => {
    recordLookups([observation({ username: null, bedwarsExperience: null, status: 404, latencyMs: 30 })], 'legacy');

    const page = await waitFor(
      () => loadStatsPage(query()),
      (data) => (data?.summary.total ?? 0) === 1,
    );

    expect(page?.summary.errors).toBe(1);
    expect(page?.summary.players).toBe(1);
    expect(page?.rows[0]).toMatchObject({ status: 404, username: null, stars: null });
    expect(await db.selectFrom('tracked_players').selectAll().execute()).toHaveLength(0);
  });

  it('filters by explicit dates', async () => {
    recordLookups([observation()], 'public');
    await waitFor(
      () => db.selectFrom('lookup_log').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst(),
      (row) => Number(row?.count ?? 0) === 1,
    );

    const inWindow = await loadStatsPage(
      query({ from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) }),
    );
    expect(inWindow?.summary.total).toBe(1);

    const outside = await loadStatsPage(
      query({ from: new Date(Date.now() - 7_200_000), to: new Date(Date.now() - 3_600_000) }),
    );
    expect(outside?.summary.total).toBe(0);
  });

  it('prunes log rows past retention but keeps player counters', async () => {
    recordLookups([observation()], 'public');

    await waitFor(
      () => db.selectFrom('lookup_log').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst(),
      (row) => Number(row?.count ?? 0) === 1,
    );

    const deleted = await pruneLookupLogs(Date.now() + 8 * 24 * 60 * 60 * 1000);

    expect(deleted).toBe(1);
    const log = await db.selectFrom('lookup_log').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst();
    const players = await db.selectFrom('tracked_players').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst();

    expect(Number(log?.count ?? -1)).toBe(0);
    expect(Number(players?.count ?? -1)).toBe(1);
  });
});
