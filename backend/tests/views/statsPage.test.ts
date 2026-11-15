import type { StatsPageData } from '../../src/services/lookupStats';
import type { StatsQuery } from '../../src/util/statsQuery';
import {
  renderPlayersCsv,
  renderStatsPage,
  renderUnavailablePage,
  statsHref,
} from '../../src/views/statsPage';
import type { TrackedPlayerTable } from '../../src/services/database/schema';

const query: StatsQuery = { range: '24h', sort: 'recent', search: '', page: 1 };

function player(overrides: Partial<TrackedPlayerTable> = {}): TrackedPlayerTable {
  return {
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
    last_looked_up_at: new Date(Date.now() - 90_000),
    ...overrides,
  };
}

function data(overrides: Partial<StatsPageData> = {}): StatsPageData {
  const chart = Array.from({ length: 24 }, (_, index) => ({
    bucket: new Date(Date.now() - (23 - index) * 3_600_000),
    lookups: index === 23 ? 10 : 0,
  }));

  return {
    summary: {
      lookups: 1_000,
      cacheHits: 750,
      errors: 5,
      averageLatencyMs: 180,
      playersInRange: 42,
      trackedPlayers: 900,
      cacheEntries: 850,
    },
    chart,
    players: [player()],
    matchingPlayers: 42,
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

describe('statsHref', () => {
  it('omits defaults', () => {
    expect(statsHref(query)).toBe('/stats');
  });

  it('keeps non-default filters', () => {
    expect(statsHref(query, { range: '7d', sort: 'stars', search: 'Notch', page: 2 })).toBe(
      '/stats?range=7d&sort=stars&q=Notch&page=2',
    );
  });
});

describe('renderStatsPage', () => {
  it('renders summary tiles, chart and the player row', () => {
    const html = renderStatsPage({ query, data: data(), retentionDays: 90 });

    expect(html).toContain('75.0%'); // cache hit rate
    expect(html).toContain('1,000'); // lookups
    expect(html).toContain('Notch');
    expect(html).toContain('530fa96a…5573');
    expect(html).toContain('90 days');
    expect((html.match(/class="bar/g) ?? []).length).toBe(24);
  });

  it('escapes player-controlled values', () => {
    const html = renderStatsPage({
      query: { ...query, search: '<img onerror=alert(1)>' },
      data: data({ players: [player({ username: '<script>alert("xss")</script>' })] }),
      retentionDays: 90,
    });

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<img onerror');
  });

  it('shows an empty state instead of an empty table', () => {
    const html = renderStatsPage({
      query,
      data: data({ players: [], matchingPlayers: 0 }),
      retentionDays: 90,
    });

    expect(html).toContain('No tracked players match this view');
    expect(html).not.toContain('<tbody></tbody>');
  });

  it('marks the active range tab', () => {
    const html = renderStatsPage({ query: { ...query, range: '7d' }, data: data(), retentionDays: 90 });
    expect(html).toContain('href="/stats?range=7d" aria-current="page"');
  });

  it('renders no pagination links that escape the page bounds', () => {
    const html = renderStatsPage({ query, data: data(), retentionDays: 90 });
    expect(html).toContain('class="pager__link is-disabled" aria-disabled="true"');
  });
});

describe('renderPlayersCsv', () => {
  it('writes a header and one quoted row per player', () => {
    const csv = renderPlayersCsv([player({ username: 'Not,ch' })]);
    const lines = csv.split('\n');

    expect(lines[0]).toContain('"identifier"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Not,ch"');
    expect(lines[1]).toContain('2026-11-01T00:00:00.000Z');
  });

  it('guards against spreadsheet formulas in usernames', () => {
    const csv = renderPlayersCsv([player({ username: '=cmd|calc' })]);
    expect(csv).toContain(`"'=cmd|calc"`);
  });
});

describe('renderUnavailablePage', () => {
  it('explains the missing database without leaking internals', () => {
    const html = renderUnavailablePage('No PostgreSQL connection is configured or reachable.');
    expect(html).toContain('CACHE_DB_URL');
    expect(html).toContain('No PostgreSQL connection is configured');
  });
});
