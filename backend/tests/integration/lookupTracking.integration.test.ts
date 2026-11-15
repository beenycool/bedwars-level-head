import { sql } from 'kysely';

/**
 * Opt-in integration suite: exercises the real PostgreSQL statements (multi-row
 * upsert, `excluded` counters, `COUNT(*) FILTER`, `date_trunc`) against a throwaway
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

describeIntegration('lookup tracking against PostgreSQL', () => {
  let db: typeof import('../../src/services/database/db').db;
  let recordLookups: typeof import('../../src/services/lookupTracking').recordLookups;
  let pruneLookupEvents: typeof import('../../src/services/lookupTracking').pruneLookupEvents;
  let loadStatsPage: typeof import('../../src/services/lookupStats').loadStatsPage;

  beforeAll(async () => {
    const databaseModule = await import('../../src/services/database/db');
    const trackingModule = await import('../../src/services/lookupTracking');
    const statsModule = await import('../../src/services/lookupStats');
    const cacheModule = await import('../../src/services/cache');

    db = databaseModule.db;
    recordLookups = trackingModule.recordLookups;
    pruneLookupEvents = trackingModule.pruneLookupEvents;
    loadStatsPage = statsModule.loadStatsPage;

    await cacheModule.ensureInitialized();
  });

  beforeEach(async () => {
    await sql`TRUNCATE tracked_players, lookup_events`.execute(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('upserts per-player counters and one event row per request', async () => {
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
          .selectFrom('tracked_players')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .executeTakeFirst();
        return Number(row?.count ?? 0);
      },
      (count) => count === 2,
    );

    // Second lookup of the same player: a cache hit with a faster response.
    recordLookups([observation({ source: 'cache', latencyMs: 15 })], 'public');

    const notch = await waitFor(
      () => db.selectFrom('tracked_players').selectAll().where('identifier', '=', UUID_NOTCH).executeTakeFirst(),
      (row) => Number(row?.lookups ?? 0) === 2,
    );

    expect(notch).toMatchObject({
      username: 'Notch',
      stars: 5,
      nicked: false,
      cache_hits: 1,
      last_source: 'cache',
      last_status: 200,
      last_latency_ms: 15,
    });

    const jeb = await db
      .selectFrom('tracked_players')
      .selectAll()
      .where('identifier', '=', UUID_JEB)
      .executeTakeFirst();

    expect(jeb).toMatchObject({ stars: 100, cache_hits: 1, lookups: 1 });
    expect(jeb?.first_seen_at).toBeInstanceOf(Date);

    const events = await db.selectFrom('lookup_events').selectAll().orderBy('id').execute();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      route: 'batch',
      players: 2,
      cache_hits: 1,
      errors: 0,
      latency_sum_ms: '130',
      latency_max_ms: 120,
    });
    expect(events[1]).toMatchObject({ route: 'public', players: 1, cache_hits: 1, latency_sum_ms: '15' });
  });

  it('aggregates the page summary, chart and filters from those tables', async () => {
    recordLookups([observation(), observation({ identifier: UUID_JEB, username: 'Jeb', bedwarsExperience: 487_000 })], 'batch');
    recordLookups([observation({ source: 'cache', latencyMs: 15 })], 'public');

    await waitFor(
      () => db.selectFrom('lookup_events').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst(),
      (row) => Number(row?.count ?? 0) === 2,
    );

    const page = await loadStatsPage({ range: '24h', sort: 'recent', search: '', page: 1 });

    expect(page).not.toBeNull();
    expect(page?.summary).toMatchObject({
      lookups: 3,
      cacheHits: 1,
      errors: 0,
      playersInRange: 2,
      trackedPlayers: 2,
    });
    expect(page?.chart).toHaveLength(24);
    expect(page?.chart.reduce((sum, point) => sum + point.lookups, 0)).toBe(3);
    expect(page?.players).toHaveLength(2);
    expect(page?.matchingPlayers).toBe(2);

    const search = await loadStatsPage({ range: '24h', sort: 'stars', search: 'jeb', page: 1 });
    expect(search?.players).toHaveLength(1);
    expect(search?.players[0].username).toBe('Jeb');

    const byStars = await loadStatsPage({ range: '24h', sort: 'stars', search: '', page: 1 });
    expect(byStars?.players[0].stars).toBe(100);
  });

  it('counts failed lookups as errors and keeps the last status', async () => {
    recordLookups([observation({ username: null, bedwarsExperience: null, status: 404, latencyMs: 30 })], 'legacy');

    const page = await waitFor(
      () => loadStatsPage({ range: '24h', sort: 'recent', search: '', page: 1 }),
      (data) => (data?.summary.lookups ?? 0) === 1,
    );

    expect(page?.summary.errors).toBe(1);
    expect(page?.players[0]).toMatchObject({ last_status: 404, username: null, stars: null });
  });

  it('prunes request rows past the retention window but keeps player counters', async () => {
    recordLookups([observation()], 'public');

    await waitFor(
      () => db.selectFrom('lookup_events').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst(),
      (row) => Number(row?.count ?? 0) === 1,
    );

    const deleted = await pruneLookupEvents(Date.now() + 91 * 24 * 60 * 60 * 1000);

    expect(deleted).toBe(1);
    const events = await db.selectFrom('lookup_events').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst();
    const players = await db.selectFrom('tracked_players').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst();

    expect(Number(events?.count ?? -1)).toBe(0);
    expect(Number(players?.count ?? -1)).toBe(1);
  });
});
