import {
  chartGranularity,
  parseStatsQuery,
  rangeShortLabel,
  rangeSince,
  STATS_MAX_SEARCH_LENGTH,
} from '../../src/util/statsQuery';

describe('parseStatsQuery', () => {
  it('defaults to the last 24 hours, recent-first, page 1', () => {
    expect(parseStatsQuery({})).toEqual({ range: '24h', sort: 'recent', search: '', page: 1 });
  });

  it('accepts known range and sort values', () => {
    expect(parseStatsQuery({ range: '7d', sort: 'stars', q: 'Notch', page: '3' })).toEqual({
      range: '7d',
      sort: 'stars',
      search: 'Notch',
      page: 3,
    });
  });

  it('falls back instead of rejecting unknown values', () => {
    expect(parseStatsQuery({ range: '90d', sort: 'cheats', page: '-2' })).toEqual({
      range: '24h',
      sort: 'recent',
      search: '',
      page: 1,
    });
  });

  it('uses the first value when a parameter is repeated', () => {
    expect(parseStatsQuery({ range: ['30d', '7d'], q: ['a', 'b'] })).toMatchObject({
      range: '30d',
      search: 'a',
    });
  });

  it('strips control characters and clamps the search length', () => {
    const search = parseStatsQuery({ q: `  bad\u0000name\u001f  ` }).search;
    expect(search).toBe('badname');

    const long = parseStatsQuery({ q: 'x'.repeat(500) }).search;
    expect(long).toHaveLength(STATS_MAX_SEARCH_LENGTH);
  });

  it('clamps the page to a sane maximum', () => {
    expect(parseStatsQuery({ page: '99999999' }).page).toBe(10_000);
  });
});

describe('rangeSince', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');

  it('returns null for all time', () => {
    expect(rangeSince('all', now)).toBeNull();
  });

  it('subtracts the range window', () => {
    expect(rangeSince('24h', now)?.toISOString()).toBe('2026-11-14T12:00:00.000Z');
    expect(rangeSince('7d', now)?.toISOString()).toBe('2026-11-08T12:00:00.000Z');
    expect(rangeSince('30d', now)?.toISOString()).toBe('2026-10-16T12:00:00.000Z');
  });
});

describe('chartGranularity', () => {
  it('plots 24h hourly and everything else daily', () => {
    expect(chartGranularity('24h')).toBe('hour');
    expect(chartGranularity('7d')).toBe('day');
    expect(chartGranularity('all')).toBe('day');
  });
});

describe('rangeShortLabel', () => {
  it('keeps the tab strip compact and single-line', () => {
    expect(rangeShortLabel('24h')).toBe('24h');
    expect(rangeShortLabel('7d')).toBe('7d');
    expect(rangeShortLabel('30d')).toBe('30d');
    expect(rangeShortLabel('all')).toBe('all');
  });
});
