import type { StatsPageData } from '../../src/services/lookupStats';
import type { StatsQuery } from '../../src/util/statsQuery';
import {
  renderLookupCsv,
  renderStatsPage,
  renderUnavailablePage,
  statsHref,
} from '../../src/views/statsPage';
import type { LookupLogTable } from '../../src/services/database/schema';

const query: StatsQuery = {
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

function row(overrides: Partial<LookupLogTable> = {}): LookupLogTable {
  return {
    id: '1',
    looked_up_at: new Date(Date.now() - 90_000),
    identifier: '530fa96a303d42199b5a329d493a5573',
    username: 'Notch',
    stars: 123,
    nicked: false,
    source: 'cache',
    route: 'public',
    status: 200,
    latency_ms: 240,
    ...overrides,
  };
}

function data(overrides: Partial<StatsPageData> = {}): StatsPageData {
  return {
    summary: {
      total: 1_000,
      cacheHits: 750,
      success: 995,
      errors: 5,
      players: 42,
      apiCallsLastHour: 120,
      latency: { p50: 100, p95: 180, p99: 300, min: 12, max: 900, avg: 140 },
      cacheEntries: 850,
      databaseSize: '8.9 MB',
      indexSize: '1.2 MB',
    },
    charts: {
      series: [{ bucket: new Date('2026-11-15T10:00:00Z'), total: 10, cacheHits: 5, avgLatency: 120, p95Latency: 200 }],
      statuses: [
        { label: '200', count: 995 },
        { label: '502', count: 5 },
      ],
      stars: [{ label: '0-9', count: 3 }],
      latencyHistogram: [{ label: '0-50', count: 4 }],
      routes: [
        { label: 'public', count: 800 },
        { label: 'batch', count: 200 },
      ],
      topPlayers: [{ identifier: '530fa96a303d42199b5a329d493a5573', username: 'Notch', count: 10 }],
    },
    rows: [row()],
    matching: 42,
    page: 1,
    pageSize: 50,
    runtime: {
      rssMb: 100,
      heapMb: 50,
      heapTotalMb: 80,
      cpuPercent: 1.5,
      bufferSize: 10,
      samples: [{ at: new Date('2026-11-15T10:00:00Z'), rssMb: 99, heapMb: 48, cpuPercent: 1.2 }],
      rateLimitKeys: 3,
      rateLimitBudget: 600,
      rateLimitWindowMs: 60_000,
      rateLimitMode: 'dynamic',
      rateLimitMin: 20,
      rateLimitMax: 600,
      rateLimitActiveClients: 2,
      rateLimitNetworkCalls: 120,
      rateLimitCacheHitRate: 0.75,
      rateLimitHypixelRemaining: 7_080,
      rateLimitRequestBudget: 1_200,
    },
    ...overrides,
  };
}

describe('statsHref', () => {
  it('omits defaults', () => {
    expect(statsHref(query)).toBe('/stats');
  });

  it('keeps non-default filters', () => {
    expect(
      statsHref(query, { range: '7d', sort: 'slowest', search: 'Notch', page: 2, metric: 'p99', limit: 100 }),
    ).toBe('/stats?range=7d&limit=100&metric=p99&sort=slowest&q=Notch&page=2');
  });
});

function formSection(html: string, marker: string): string {
  return html.split(marker)[1]?.split('</form>')[0] ?? '';
}

describe('renderStatsPage', () => {
  it('renders every section of the analytics page', () => {
    const html = renderStatsPage({ query, data: data(), retentionDays: 7 });

    expect(html).toContain('Levelhead Analytics');
    expect(html).toContain('Total Lookups');
    expect(html).toContain('75.0%'); // cache hit rate
    expect(html).toContain('99.5%'); // success rate
    expect(html).toContain('180 ms'); // p95 latency
    expect(html).toContain('Infrastructure Health');
    expect(html).toContain('Process Resources');
    expect(html).toContain('Rate Limiting');
    expect(html).toContain('Dynamic per IP');
    expect(html).toContain('Upstream Signal');
    for (const chart of [
      'Cache Performance',
      'Star Distribution',
      'Latency Pulse',
      'Status Breakdown',
      'Request Routes',
      'Requests Over Time',
      'Cache Hit Rate Over Time',
      'Latency Distribution',
      'Top Queried Players',
      'Process Memory Over Time',
    ]) {
      expect(html).toContain(chart);
    }
    expect(html).toContain('Recent Player Lookups');
    expect(html).toContain('Notch');
    expect(html).toContain('530fa96a…5573');
  });

  it('labels every axis and bar with readable numbers', () => {
    const html = renderStatsPage({ query, data: data(), retentionDays: 7 });

    // Line charts get a 0 / midpoint / maximum axis in HTML beside the plot.
    expect(html).toContain('class="chart-yaxis"');
    expect(html).toContain('<span>200</span><span>100</span><span>0</span>');
    // Bar charts print the count above each bucket.
    expect(html).toContain('<span><b>3</b><small>0-9</small></span>');
    // Card headers carry the latest reading too.
    expect(html).toContain('avg 120 ms · p95 200 ms');
    expect(html).toContain('Latest 10');
  });

  it('escapes player-controlled values', () => {
    const html = renderStatsPage({
      query: { ...query, search: '<img onerror=alert(1)>' },
      data: data({ rows: [row({ username: '<script>alert("xss")</script>' })] }),
      retentionDays: 7,
    });

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<img onerror');
  });

  it('shows an empty state instead of an empty table', () => {
    const html = renderStatsPage({
      query,
      data: data({ rows: [], matching: 0 }),
      retentionDays: 7,
    });

    expect(html).toContain('No lookups recorded yet');
    expect(html).not.toContain('<tbody></tbody>');
  });

  it('marks the active preset and disables pager edges', () => {
    const html = renderStatsPage({ query: { ...query, range: '7d' }, data: data(), retentionDays: 7 });
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-disabled="true"');
  });

  it('adds a meta refresh only when auto-refresh is on', () => {
    const off = renderStatsPage({ query, data: data(), retentionDays: 7 });
    const on = renderStatsPage({ query: { ...query, refresh: 30 }, data: data(), retentionDays: 7 });

    expect(off).not.toContain('http-equiv="refresh"');
    expect(on).toContain('http-equiv="refresh" content="30"');
  });

  it('does not shadow the search form with hidden q/sort inputs', () => {
    const html = renderStatsPage({
      query: { ...query, range: '7d', search: 'Notch', sort: 'slowest', page: 2 },
      data: data({ page: 2 }),
      retentionDays: 7,
    });
    const form = formSection(html, 'class="search-box"');

    expect(form).not.toContain('type="hidden" name="q"');
    expect(form).not.toContain('type="hidden" name="sort"');
    expect(form).toContain('type="search" name="q"');
    expect(form).toContain('<option value="slowest" selected>');
    expect(form).toContain('<input type="hidden" name="range" value="7d">');
  });

  it('keeps the range preset when the filter form is applied', () => {
    const html = renderStatsPage({ query: { ...query, range: '7d' }, data: data(), retentionDays: 7 });
    const form = formSection(html, 'id="filterForm"');

    expect(form).toContain('<input type="hidden" name="range" value="7d">');
  });

  it('keeps an active custom window when the filter form is submitted', () => {
    const html = renderStatsPage({
      query: {
        ...query,
        from: new Date('2026-11-01T10:00:00Z'),
        to: new Date('2026-11-02T10:00:00Z'),
      },
      data: data(),
      retentionDays: 7,
    });
    const form = formSection(html, 'id="filterForm"');

    expect(form).toContain('name="from" value="2026-11-01T10:00"');
    expect(form).toContain('name="to" value="2026-11-02T10:00"');
  });

  it('labels a custom date window instead of the range preset', () => {
    const html = renderStatsPage({
      query: {
        ...query,
        from: new Date('2026-11-01T10:00:00Z'),
        to: new Date('2026-11-02T10:00:00Z'),
      },
      data: data(),
      retentionDays: 7,
    });

    expect(html).toContain('2026-11-01T10:00 → 2026-11-02T10:00');
    expect(html).not.toContain('Last 24 hours');
  });

  it('uses clock labels for a short custom window', () => {
    const base = data();
    const series = [
      { bucket: new Date('2026-11-15T10:00:00Z'), total: 1, cacheHits: 0, avgLatency: 10, p95Latency: 10 },
      { bucket: new Date('2026-11-15T11:00:00Z'), total: 0, cacheHits: 0, avgLatency: 0, p95Latency: 0 },
      { bucket: new Date('2026-11-15T12:00:00Z'), total: 2, cacheHits: 1, avgLatency: 10, p95Latency: 10 },
    ];
    const html = renderStatsPage({
      query: {
        ...query,
        from: new Date('2026-11-15T10:00:00Z'),
        to: new Date('2026-11-15T12:00:00Z'),
      },
      data: data({ charts: { ...base.charts, series } }),
      retentionDays: 7,
    });

    expect(html).toContain('<span>10:00</span><span>12:00</span>');
  });
});

describe('renderLookupCsv', () => {
  it('writes a header and one quoted row per lookup', () => {
    const csv = renderLookupCsv([row({ username: 'Not,ch' })]);
    const lines = csv.split('\n');

    expect(lines[0]).toContain('"looked_up_at"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Not,ch"');
    expect(lines[1]).toContain('"cache"');
  });

  it('guards against spreadsheet formulas in usernames', () => {
    expect(renderLookupCsv([row({ username: '=cmd|calc' })])).toContain(`"'=cmd|calc"`);
  });
});

describe('renderUnavailablePage', () => {
  it('explains the missing database without leaking internals', () => {
    const html = renderUnavailablePage('No PostgreSQL connection is configured or reachable.');
    expect(html).toContain('CACHE_DB_URL');
    expect(html).toContain('No PostgreSQL connection is configured');
  });
});
