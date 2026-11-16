/**
 * Server-rendered SVG charts. The old analytics page used Chart.js from a CDN and a
 * nonce-enabled script policy; these primitives keep the same look with no client
 * JavaScript, no CSP exception and a fraction of the code.
 *
 * Axis labels are plain HTML next to the plot rather than `<text>` in the SVG: the
 * plot is stretched to the card width, which would also stretch any text inside it.
 * HTML keeps the numbers readable on phones.
 */

const WIDTH = 640;
const HEIGHT = 180;
const PAD = 8;

export interface LineSeries {
  values: number[];
  color: string;
  fill?: boolean;
  /** Name shown in the hover tooltip, e.g. "Average". */
  name?: string;
  /** Optional exact-value formatter for the hover tooltip. */
  format?: (value: number) => string;
}

/** Rounds a maximum up to 1/2/5×10ⁿ so the midpoint tick is a readable number. */
function niceMax(values: number[]): number {
  const raw = Math.max(0, ...values.map((value) => (Number.isFinite(value) ? value : 0)));
  if (raw <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Compact axis labels: 950 → 950, 1200 → 1.2k, 1500000 → 1.5M, 0.5 → 0.5. */
function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${trimZero(value / 1_000_000, abs >= 10_000_000 ? 0 : 1)}M`;
  }
  if (abs >= 1_000) {
    return `${trimZero(value / 1_000, abs >= 10_000 ? 0 : 1)}k`;
  }
  if (abs >= 10 || Number.isInteger(value)) {
    return String(Math.round(value));
  }
  return trimZero(value, 1);
}

function trimZero(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0$/, '');
}

/** Exact number for a tooltip, unlike the compact axis labels. */
function formatValue(value: number): string {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(Math.round(value)) : '0';
}

function grid(): string {
  return [0, 0.5, 1]
    .map((fraction) => {
      const y = Math.min(HEIGHT - 1, Math.max(1, HEIGHT * fraction));
      const opacity = fraction === 0.5 ? 0.12 : 0.2;
      return `<line x1="0" y1="${y.toFixed(0)}" x2="${WIDTH}" y2="${y.toFixed(0)}" stroke="rgba(148,163,184,${opacity})" stroke-width="1" />`;
    })
    .join('');
}

function yAxis(max: number): string {
  return `<div class="chart-yaxis" aria-hidden="true"><span>${formatTick(max)}</span><span>${formatTick(max / 2)}</span><span>0</span></div>`;
}

export function lineChart(series: LineSeries[], ariaLabel: string, labels?: string[]): string {
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
        y: HEIGHT - 1 - (Math.min(max, Math.max(0, value)) / max) * (HEIGHT - 2),
      }));
      const line = points
        .map((point, position) => `${position === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ');
      const area = entry.fill
        ? `<path d="${line} L${(WIDTH - PAD).toFixed(1)},${HEIGHT - 1} L${PAD},${HEIGHT - 1} Z" fill="url(#chart-fill-${index})" />`
        : '';
      const gradient = entry.fill
        ? `<defs><linearGradient id="chart-fill-${index}" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="${entry.color}" stop-opacity="0.20" />
             <stop offset="100%" stop-color="${entry.color}" stop-opacity="0.01" />
           </linearGradient></defs>`
        : '';
      // Keep small dots on readable charts; the hover bands below carry the
      // values for every bucket, including the dense all-time view.
      const dots =
        points.length <= 64
          ? points
              .map(
                (point) =>
                  `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.2" fill="${entry.color}" opacity="0.85" />`,
              )
              .join('')
          : '';
      return `${gradient}${area}<path d="${line}" fill="none" stroke="${entry.color}" stroke-width="2" vector-effect="non-scaling-stroke" />${dots}`;
    })
    .join('');

  // One full-height transparent band per x bucket, so hovering anywhere in a
  // column shows every series' value there. Sample the bands on dense charts;
  // the line still draws all buckets.
  const hasPoints = prepared.some((entry) => entry.values.length > 0);
  const hoverStride = Math.max(1, Math.ceil(count / 48));
  const hoverBands = !hasPoints
    ? ''
    : Array.from({ length: count }, (_, position) => position)
        .filter((position) => position % hoverStride === 0 || position === count - 1)
        .map((position) => {
      const x = PAD + position * step;
      const x0 = Math.max(0, x - step / 2);
      const x1 = Math.min(WIDTH, x + step / 2);
      const label = labels?.[Math.min(position, Math.max(0, (labels?.length ?? 1) - 1))];
      const values = prepared
        .map((entry) => {
          const value = entry.values[position];
          if (value === undefined) {
            return null;
          }
          const text = entry.format ? entry.format(value) : formatTick(value);
          return `${entry.name ? `${entry.name}: ` : ''}${text}`;
        })
        .filter((value): value is string => value !== null)
        .join(' · ');
      const tooltip = `${label ? `${label} — ` : ''}${values}`;
      return `<rect class="chart-hit" x="${x0.toFixed(1)}" y="0" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${HEIGHT}" fill="transparent" pointer-events="all"><title>${escapeText(tooltip)}</title></rect>`;
    })
    .join('');

  const svg = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="${escapeAttr(ariaLabel)}">
    ${grid()}${paths}${hoverBands}
  </svg>`;

  return `<div class="chart-frame">${yAxis(max)}<div class="chart-plot">${svg}</div></div>`;
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
      return `<rect class="chart-hit" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, height).toFixed(1)}" rx="2" fill="#3b82f6"><title>${escapeText(`${bar.label}: ${formatValue(bar.value)}`)}</title></rect>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeAttr(ariaLabel)}">
    ${grid()}${rendered}
  </svg>`;
}

/**
 * Value + label row for bar charts. The values are rendered as text here, not in the
 * SVG, so they stay legible when the chart is squeezed onto a phone.
 */
export function barLabels(labels: string[], values: number[]): string {
  return `<div class="bar-labels">${labels
    .map(
      (label, index) =>
        `<span><b>${formatTick(values[index] ?? 0)}</b><small>${escapeText(label)}</small></span>`,
    )
    .join('')}</div>`;
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
            const percent = ((Math.max(0, slice.value) / total) * 100).toFixed(1);
            const segment = `<circle class="chart-hit" cx="80" cy="80" r="${radius}" fill="none" stroke="${slice.color}" stroke-width="14"
              stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}"
              stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)"><title>${escapeText(`${slice.label}: ${formatValue(slice.value)} (${percent}%)`)}</title></circle>`;
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
