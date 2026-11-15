import {
  buildTrackedPlayerRows,
  buildTrackedPlayersUpsert,
  summarizeObservations,
  type LookupObservation,
} from '../../src/services/lookupTracking';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';

/** Kysely's documented compile-only dialect: no socket, no `pg` driver. */
function compileOnlyDb(): Kysely<never> {
  return new Kysely<never>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

function observation(overrides: Partial<LookupObservation> = {}): LookupObservation {
  return {
    identifier: '530fa96a303d42199b5a329d493a5573',
    username: 'Notch',
    bedwarsExperience: 12_345,
    nicked: false,
    source: 'network',
    status: 200,
    latencyMs: 100,
    ...overrides,
  };
}

describe('summarizeObservations', () => {
  it('counts cache hits, errors and latency for a request', () => {
    const summary = summarizeObservations([
      observation({ source: 'cache', latencyMs: 200 }),
      observation({ identifier: 'a'.repeat(32), status: 404, latencyMs: 60 }),
      observation({ identifier: 'b'.repeat(32), latencyMs: 40 }),
    ]);

    expect(summary).toEqual({
      players: 3,
      cacheHits: 1,
      errors: 1,
      latencySumMs: 300,
      latencyMaxMs: 200,
    });
  });

  it('treats 5xx as errors and ignores non-finite latencies', () => {
    const summary = summarizeObservations([
      observation({ status: 503, latencyMs: Number.NaN }),
    ]);

    expect(summary.players).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.latencySumMs).toBe(0);
    expect(summary.latencyMaxMs).toBe(0);
  });

  it('is empty for an empty request', () => {
    expect(summarizeObservations([])).toEqual({
      players: 0,
      cacheHits: 0,
      errors: 0,
      latencySumMs: 0,
      latencyMaxMs: 0,
    });
  });
});

describe('buildTrackedPlayerRows', () => {
  it('derives stars from experience and records the source', () => {
    const [row] = buildTrackedPlayerRows([observation({ bedwarsExperience: 12_000, source: 'cache' })]);

    expect(row).toMatchObject({
      identifier: '530fa96a303d42199b5a329d493a5573',
      username: 'Notch',
      stars: 5,
      cacheHit: true,
      lastSource: 'cache',
      lastStatus: 200,
      latencyMs: 100,
    });
  });

  it('stores no stars for nicked players', () => {
    const [row] = buildTrackedPlayerRows([
      observation({ nicked: true, username: null, bedwarsExperience: null }),
    ]);

    expect(row.stars).toBeNull();
    expect(row.nicked).toBe(true);
    expect(row.username).toBeNull();
  });

  it('collapses duplicate identifiers to a single row (last wins) so the upsert is legal', () => {
    const rows = buildTrackedPlayerRows([
      observation({ username: 'Notch' }),
      observation({ source: 'cache', username: 'Notch2' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username: 'Notch2', lastStatus: 200, lastSource: 'cache' });
  });

  it('skips failed lookups so random UUID scans cannot grow the table', () => {
    expect(
      buildTrackedPlayerRows([
        observation({ status: 404 }),
        observation({ identifier: 'b'.repeat(32), status: 502 }),
      ]),
    ).toEqual([]);
  });
});

describe('buildTrackedPlayersUpsert', () => {
  it('compiles one VALUES tuple per row and increments counters on conflict', () => {
    const rows = buildTrackedPlayerRows([
      observation(),
      observation({ identifier: 'b'.repeat(32), username: 'Player2' }),
    ]);

    const compiled = buildTrackedPlayersUpsert(rows, new Date('2026-11-15T12:00:00Z')).compile(
      compileOnlyDb(),
    );

    expect(compiled.sql).toContain('INSERT INTO tracked_players');
    expect(compiled.sql).toContain('ON CONFLICT (identifier) DO UPDATE SET');
    expect(compiled.sql).toContain('lookups = tracked_players.lookups + 1');
    expect(compiled.sql).toContain("CASE WHEN excluded.last_source = 'cache'");
    expect(compiled.sql).toContain('COALESCE(excluded.username, tracked_players.username)');
    // Nine bound parameters per row, none inlined.
    expect(compiled.parameters).toHaveLength(18);
  });
});
