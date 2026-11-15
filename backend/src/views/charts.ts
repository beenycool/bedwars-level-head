/**
 * Server-rendered SVG charts. The old analytics page used Chart.js from a CDN and a
 * nonce-enabled script policy; these primitives keep the same look with no client
 * JavaScript, no CSP exception and a fraction of the code.
 */

const WIDTH = 640;
const HEIGHT = 180;
const PAD = 8;

export interface LineSeries {
  values: number[];
  color: string;
  fill?: boolean;
}

function niceMax(values: number[]): number {
  return Math.max(1, ...values.map((value) => (Number.isFinite(value) ? value : 0)));
}

function grid(): string {
  return [0.25, 0.5, 0.75]
    .map(
      (fraction) =>
        `<line x1="0" y1="${(HEIGHT * fraction).toFixed(0)}" x2="${WIDTH}" y2="${(HEIGHT * fraction).toFixed(0)}" stroke="rgba(148,163,184,0.12)" stroke-width="1" />`,
    )
    .join('');
}

export function lineChart(series: LineSeries[], ariaLabel: string): string {
  // A single sample would otherwise draw a triangle from the point to the baseline.
  const prepared = series.map((entry) => ({
    ...entry,
    values: entry.values.length === 1 ? [entry.values[0], entry.values[0]] : entry.values,
  }));
  const max = niceMax(prepared.flatMap((entry) => entry.values));
  const count = Math.max(...prepared.map((entry) => entry.values.length), 2);
  const step = (WIDTH - PAD * 2) / (count - 1);

  const paths = prepared
    .map((entry, index) => {
      const points = entry.values.map((value, position) => ({
        x: PAD + position * step,
        y: HEIGHT - PAD - (Math.max(0, value) / max) * (HEIGHT - PAD * 2),
      }));
      const line = points
        .map((point, position) => `${position === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ');
      const area = entry.fill
        ? `<path d="${line} L${(WIDTH - PAD).toFixed(1)},${HEIGHT - PAD} L${PAD},${HEIGHT - PAD} Z" fill="url(#chart-fill-${index})" />`
        : '';
      const gradient = entry.fill
        ? `<defs><linearGradient id="chart-fill-${index}" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="${entry.color}" stop-opacity="0.20" />
             <stop offset="100%" stop-color="${entry.color}" stop-opacity="0.01" />
           </linearGradient></defs>`
        : '';
      return `${gradient}${area}<path d="${line}" fill="none" stroke="${entry.color}" stroke-width="2" vector-effect="non-scaling-stroke" />`;
    })
    .join('');

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="${escapeAttr(ariaLabel)}">
    ${grid()}${paths}
  </svg>`;
}

export function barChart(bars: { label: string; value: number }[], ariaLabel: string): string {
  const max = niceMax(bars.map((bar) => bar.value));
  const slot = WIDTH / Math.max(1, bars.length);
  const barWidth = Math.min(46, slot * 0.6);

  const rendered = bars
    .map((bar, index) => {
      const height = (Math.max(0, bar.value) / max) * (HEIGHT - 10);
      const x = index * slot + (slot - barWidth) / 2;
      const y = HEIGHT - 4 - height;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, height).toFixed(1)}" rx="2" fill="#3b82f6" />`;
    })
    .join('');

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeAttr(ariaLabel)}">
    ${grid()}${rendered}
  </svg>`;
}

/** Label row for bar charts: HTML keeps the text readable at card widths. */
export function barLabels(labels: string[]): string {
  return `<div class="bar-labels">${labels.map((label) => `<span>${escapeText(label)}</span>`).join('')}</div>`;
}

export function donut(
  slices: { label: string; value: number; color: string }[],
  centerValue: string,
  centerLabel: string,
  ariaLabel: string,
): string {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments =
    total > 0
      ? slices
          .map((slice) => {
            const length = (Math.max(0, slice.value) / total) * circumference;
            const segment = `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${slice.color}" stroke-width="14"
              stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}"
              stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)" />`;
            offset += length;
            return segment;
          })
          .join('')
      : `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="#334155" stroke-width="14" />`;

  return `<svg viewBox="0 0 160 160" role="img" aria-label="${escapeAttr(ariaLabel)}">
    ${segments}
    <text x="80" y="82" text-anchor="middle" fill="#e2e8f0" font-size="20" font-weight="700">${escapeText(centerValue)}</text>
    <text x="80" y="98" text-anchor="middle" fill="#94a3b8" font-size="9">${escapeText(centerLabel)}</text>
  </svg>`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}
