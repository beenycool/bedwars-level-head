/**
 * Small formatting helpers shared by the server-rendered pages.
 *
 * The pages are pure strings on purpose: no template engine, no client-side
 * JavaScript (Helmet's default CSP forbids inline scripts), and every value that
 * comes from the database goes through {@link escapeHtml}.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

const HTML_SPECIAL = /[&<>"'`]/g;

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(HTML_SPECIAL, (character) => HTML_ESCAPES[character] ?? character);
}

/** `12345` -> `12,345`. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

/** `numerator / denominator` as a one-decimal percentage, or an em dash. */
export function formatPercent(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return '—';
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Sub-second values stay in milliseconds; anything else reads better in seconds. */
export function formatLatency(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return '—';
  }
  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)} s`;
  }
  return `${Math.round(milliseconds)} ms`;
}

/** Coarse "3m ago" label used in the tracked-players table. */
export function formatRelativeTime(value: Date | null | undefined, now: number = Date.now()): string {
  if (!value) {
    return '—';
  }
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp)) {
    return '—';
  }
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return value instanceof Date ? value.toISOString().slice(0, 10) : '—';
}

/** `2026-11-15 18:02 UTC`, used in the CSV export and chart tooltips. */
export function formatIsoMinute(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/**
 * Quotes one CSV field. Values starting with `=`, `+`, `-` or `@` are prefixed with
 * an apostrophe so spreadsheet software treats them as text instead of a formula.
 */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** `530fa96a303d42199b5a329d493a5573` -> `530fa96a…5573`. */
export function shortenUuid(identifier: string): string {
  if (identifier.length <= 12) {
    return identifier;
  }
  return `${identifier.slice(0, 8)}…${identifier.slice(-4)}`;
}
