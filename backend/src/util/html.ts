
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

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

export function formatLatency(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return '—';
  }
  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)} s`;
  }
  return `${Math.round(milliseconds)} ms`;
}

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

export function formatIsoMinute(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function shortenUuid(identifier: string): string {
  if (identifier.length <= 12) {
    return identifier;
  }
  return `${identifier.slice(0, 8)}…${identifier.slice(-4)}`;
}
