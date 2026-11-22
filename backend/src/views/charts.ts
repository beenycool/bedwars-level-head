const WIDTH = 640;
const HEIGHT = 180;
const PAD = 8;

export interface LineSeries {
  values: (number | null)[];
  color: string;
  fill?: boolean;
  name?: string;
  format?: (value: number) => string;
}

interface Point {
  x: number;
  y: number;
}

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

function segmentsOf(values: (number | null)[], max: number, step: number): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];
  values.forEach((value, position) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      return;
    }
    current.push({
      x: PAD + position * step,
      y: HEIGHT - 1 - (Math.min(max, Math.max(0, value)) / max) * (HEIGHT - 2),
    });
  });
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

let chartSequence = 0;

export function lineChart(series: LineSeries[], ariaLabel: string, labels?: string[], chartId?: string): string {
  const idBase = chartId ?? `chart-${chartSequence++}`;
  const prepared = series.map((entry) => ({
    ...entry,
    values: entry.values.length === 1 ? [entry.values[0], entry.values[0]] : entry.values,
  }));
  const max = niceMax(
    prepared.flatMap((entry) => entry.values.filter((value): value is number => value !== null)),
  );
  const count = Math.max(...prepared.map((entry) => entry.values.length), 2);
  const step = (WIDTH - PAD * 2) / (count - 1);

  const paths = prepared
    .map((entry, index) => {
      const segments = segmentsOf(entry.values, max, step);
      const points = segments.flat();
      const line = segments
        .filter((segment) => segment.length > 1)
        .map((segment) =>
          segment
            .map((point, position) => `${position === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
            .join(' '),
        )
        .join(' ');
      const area = entry.fill
        ? segments
            .filter((segment) => segment.length > 1)
            .map((segment) => {
              const start = segment[0];
              const end = segment[segment.length - 1];
              const body = segment
                .map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`)
                .join(' ');
              return `<path d="M${start.x.toFixed(1)},${start.y.toFixed(1)} ${body} L${end.x.toFixed(1)},${HEIGHT - 1} L${start.x.toFixed(1)},${HEIGHT - 1} Z" fill="url(#${idBase}-fill-${index})" />`;
            })
            .join('')
        : '';
      const gradient = entry.fill
        ? `<defs><linearGradient id="${idBase}-fill-${index}" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="${entry.color}" stop-opacity="0.20" />
             <stop offset="100%" stop-color="${entry.color}" stop-opacity="0.01" />
           </linearGradient></defs>`
        : '';
      const dots =
        points.length <= 64
          ? points
              .map(
                (point) =>
                  `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.2" fill="${entry.color}" opacity="0.85" />`,
              )
              .join('')
          : '';
      return `${gradient}${area}${line ? `<path d="${line}" fill="none" stroke="${entry.color}" stroke-width="2" vector-effect="non-scaling-stroke" />` : ''}${dots}`;
    })
    .join('');

  const hasPoints = prepared.some((entry) => entry.values.some((value) => value !== null));
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
              if (value === null || value === undefined) {
                return null;
              }
              const text = entry.format ? entry.format(value) : formatTick(value);
              return `${entry.name ? `${entry.name}: ` : ''}${text}`;
            })
            .filter((value): value is string => value !== null)
            .join(' · ');
          const tooltip = `${label ? `${label} — ` : ''}${values || 'no samples'}`;
          return `<rect class="chart-hit" x="${x0.toFixed(1)}" y="0" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${HEIGHT}" fill="transparent" pointer-events="all" data-tip="${escapeAttr(tooltip)}" />`;
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
      if (!(bar.value > 0)) {
        return '';
      }
      const height = (bar.value / max) * (HEIGHT - 10);
      const x = index * slot + (slot - barWidth) / 2;
      const y = HEIGHT - 4 - height;
      return `<rect class="chart-hit" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, height).toFixed(1)}" rx="2" fill="#3b82f6" data-tip="${escapeAttr(`${bar.label}: ${formatValue(bar.value)}`)}" />`;
    })
    .join('');

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeAttr(ariaLabel)}">
    ${grid()}${rendered}
  </svg>`;
}

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
              stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)" data-tip="${escapeAttr(`${slice.label}: ${formatValue(slice.value)} (${percent}%)`)}" />`;
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
