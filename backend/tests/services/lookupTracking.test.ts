import {
  buildLookupLogInsert,
  buildLookupLogRows,
  buildTrackedPlayerRows,
  buildTrackedPlayersUpsert,
  type LookupObservation,
} from '../../src/services/lookupTracking';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';

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

describe('buildLookupLogRows', () => {
  it('keeps every observation, including failures, with derived stars', () => {
    const at = new Date('2026-11-15T12:00:00Z');
    const rows = buildLookupLogRows(
      [
        observation(),
        observation({ identifier: 'b'.repeat(32), status: 404, username: null, bedwarsExperience: null }),
      ],
      'batch',
      at,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      lookedUpAt: at,
      identifier: '530fa96a303d42199b5a329d493a5573',
      stars: 5,
      source: 'network',
      route: 'batch',
      status: 200,
      latencyMs: 100,
    });
    expect(rows[1]).toMatchObject({ stars: null, status: 404, route: 'batch' });
  });

  it('clamps negative and fractional latencies', () => {
    const [row] = buildLookupLogRows([observation({ latencyMs: -12.6 })], 'public', new Date());
    expect(row.latencyMs).toBe(0);
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

describe('compiled SQL', () => {
  it('inserts one log tuple per lookup', () => {
    const rows = buildLookupLogRows(
      [observation(), observation({ identifier: 'b'.repeat(32) })],
      'public',
      new Date('2026-11-15T12:00:00Z'),
    );
    const compiled = buildLookupLogInsert(rows).compile(compileOnlyDb());

    expect(compiled.sql).toContain('INSERT INTO lookup_log');
    expect(compiled.sql).not.toContain('ON CONFLICT');
    expect(compiled.parameters).toHaveLength(18);
  });

  it('increments player counters on conflict', () => {
    const rows = buildTrackedPlayerRows([observation(), observation({ identifier: 'b'.repeat(32) })]);
    const compiled = buildTrackedPlayersUpsert(rows, new Date('2026-11-15T12:00:00Z')).compile(
      compileOnlyDb(),
    );

    expect(compiled.sql).toContain('INSERT INTO tracked_players');
    expect(compiled.sql).toContain('ON CONFLICT (identifier) DO UPDATE SET');
    expect(compiled.sql).toContain('lookups = tracked_players.lookups + 1');
    expect(compiled.sql).toContain("CASE WHEN excluded.last_source = 'cache'");
    expect(compiled.parameters).toHaveLength(18);
  });
});
