import {
  buildLookupLogInsert,
  buildLookupLogRows,
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
});
