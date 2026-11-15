/** Parsing and clamping for the `/stats` query string. Kept free of Express types. */

export const STATS_RANGES = ['24h', '7d', '30d', 'all'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export const STATS_SORTS = ['recent', 'lookups', 'stars'] as const;
export type StatsSort = (typeof STATS_SORTS)[number];

export const STATS_PAGE_SIZE = 50;
export const STATS_MAX_SEARCH_LENGTH = 64;

export interface StatsQuery {
  range: StatsRange;
  sort: StatsSort;
  search: string;
  page: number;
}

const RANGE_LABELS: Record<StatsRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
};

const RANGE_DURATIONS_MS: Record<Exclude<StatsRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function firstValue(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return raw[0];
  }
  return undefined;
}

function isRange(value: string | undefined): value is StatsRange {
  return value !== undefined && (STATS_RANGES as readonly string[]).includes(value);
}

function isSort(value: string | undefined): value is StatsSort {
  return value !== undefined && (STATS_SORTS as readonly string[]).includes(value);
}

/**
 * Unknown or repeated parameters fall back to the defaults rather than returning a
 * 400: the page is meant to be linkable and hand-editable.
 */
export function parseStatsQuery(raw: Record<string, unknown>): StatsQuery {
  const range = firstValue(raw.range);
  const sort = firstValue(raw.sort);

  const rawSearch = firstValue(raw.q) ?? '';
  // Strip control characters so nothing odd reaches the HTML or the SQL pattern.
  const search = rawSearch.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, STATS_MAX_SEARCH_LENGTH);

  const rawPage = Number.parseInt(firstValue(raw.page) ?? '', 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;

  return {
    range: isRange(range) ? range : '24h',
    sort: isSort(sort) ? sort : 'recent',
    search,
    page,
  };
}

export function rangeLabel(range: StatsRange): string {
  return RANGE_LABELS[range];
}

/** Compact label for the tab strip; `rangeLabel` carries the long form. */
export function rangeShortLabel(range: StatsRange): string {
  return range === 'all' ? 'all' : range;
}

/** Inclusive lower bound for a range, or `null` for all time. */
export function rangeSince(range: StatsRange, now: number = Date.now()): Date | null {
  if (range === 'all') {
    return null;
  }
  return new Date(now - RANGE_DURATIONS_MS[range]);
}

/** 24h is plotted hourly; anything longer would draw hundreds of unreadable bars. */
export function chartGranularity(range: StatsRange): 'hour' | 'day' {
  return range === '24h' ? 'hour' : 'day';
}
