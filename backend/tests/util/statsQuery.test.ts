import {
  chartGranularity,
  parseStatsQuery,
  rangeLabel,
  STATS_MAX_SEARCH_LENGTH,
  statsWindow,
} from '../../src/util/statsQuery';

const defaults = {
  range: '24h' as const,
  from: null,
  to: null,
  limit: 50,
  metric: 'p95' as const,
  sort: 'recent' as const,
  search: '',
  page: 1,
  refresh: 0,
};

describe('parseStatsQuery', () => {
  it('defaults to the last 24 hours, p95 and 50 rows', () => {
    expect(parseStatsQuery({})).toEqual(defaults);
  });

  it('accepts every known filter', () => {
    expect(
      parseStatsQuery({
        range: '7d',
        from: '2026-11-01T10:00',
        to: '2026-11-15T10:00',
        limit: '100',
        metric: 'p99',
        sort: 'slowest',
        q: 'Notch',
        page: '3',
        refresh: '30',
      }),
    ).toEqual({
      range: '7d',
      from: new Date('2026-11-01T10:00'),
      to: new Date('2026-11-15T10:00'),
      limit: 100,
      metric: 'p99',
      sort: 'slowest',
      search: 'Notch',
      page: 3,
      refresh: 30,
    });
  });

  it('falls back instead of rejecting unknown values', () => {
    expect(
      parseStatsQuery({ range: '90d', metric: 'p42', sort: 'cheats', limit: '999', refresh: '7' }),
    ).toEqual(defaults);

    expect(parseStatsQuery({ from: 'not-a-date', to: 'nope' })).toMatchObject({ from: null, to: null });
  });

  it('uses the first value when a parameter is repeated', () => {
    expect(parseStatsQuery({ range: ['30d', '7d'], q: ['a', 'b'] })).toMatchObject({
      range: '30d',
      search: 'a',
    });
  });

  it('strips control characters and clamps the search length', () => {
    expect(parseStatsQuery({ q: '  bad\u0000name\u001f  ' }).search).toBe('badname');
    expect(parseStatsQuery({ q: 'x'.repeat(500) }).search).toHaveLength(STATS_MAX_SEARCH_LENGTH);
  });

  it('clamps the page to a sane maximum', () => {
    expect(parseStatsQuery({ page: '99999999' }).page).toBe(10_000);
  });
});

describe('rangeLabel', () => {
  it('spells out each preset', () => {
    expect(rangeLabel('24h')).toBe('Last 24 hours');
    expect(rangeLabel('all')).toBe('All time');
  });
});

describe('statsWindow', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');

  it('derives the window from the preset', () => {
    expect(statsWindow(parseStatsQuery({ range: '24h' }), now)).toEqual({
      since: new Date('2026-11-14T12:00:00.000Z'),
      until: null,
    });
    expect(statsWindow(parseStatsQuery({ range: 'all' }), now)).toEqual({ since: null, until: null });
  });

  it('lets explicit dates win over the preset', () => {
    const query = parseStatsQuery({ range: '30d', from: '2026-11-01T00:00', to: '2026-11-02T00:00' });
    expect(statsWindow(query, now)).toEqual({
      since: new Date('2026-11-01T00:00'),
      until: new Date('2026-11-02T00:00'),
    });
  });
});

describe('chartGranularity', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');

  it('plots short windows hourly and long windows daily', () => {
    expect(chartGranularity(new Date('2026-11-14T12:00:00Z'), null, now)).toBe('hour');
    expect(chartGranularity(new Date('2026-11-01T12:00:00Z'), null, now)).toBe('day');
    expect(chartGranularity(null, null, now)).toBe('day');
  });
});
