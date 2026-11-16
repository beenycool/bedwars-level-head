/**
 * The HTML shell for the server-rendered pages.
 *
 * This is the pre-rewrite analytics look: slate canvas, Inter stack, blue/cyan
 * accents and glassy cards. Styles stay inline because Helmet's default CSP
 * permits `style-src 'unsafe-inline'` but forbids inline scripts.
 */

export interface LayoutOptions {
  title: string;
  heading: string;
  subtitle: string;
  body: string;
  refreshSeconds?: number;
}

const STYLES = `
:root {
  color-scheme: dark;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  --chart-height: 190px;
}
* { box-sizing: border-box; }
html, body { overflow-x: clip; }
body { padding: 1.25rem 1rem; margin: 0; width: 100%; }
.wrap { max-width: 1280px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 0.35rem; letter-spacing: -0.015em; }
h2 { font-size: 0.95rem; color: #cbd5f5; margin: 1.25rem 0 0.5rem; }
.card-header h2 { margin: 0; }
p.meta { margin: 0; color: #94a3b8; font-size: 0.85rem; }
p.meta.hero { font-size: 0.92rem; color: #cbd5f5; margin-bottom: 0.75rem; }
a { color: #60a5fa; text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid #38bdf8;
  outline-offset: 2px;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em;
  background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 4px; padding: 0 0.25em;
}

/* Cards and stats --------------------------------------------------------- */
.card {
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 10px;
  padding: 0.9rem;
}
.stat-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.75rem; margin: 0.9rem 0;
}
.stat-card {
  display: flex; flex-direction: column; gap: 0.3rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(34, 211, 238, 0.08));
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.35);
}
.stat-label {
  color: #94a3b8; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.08em; font-size: 0.7rem; margin: 0;
}
.stat-value { font-size: 1.5rem; font-weight: 700; margin: 0; font-variant-numeric: tabular-nums; }
.stat-sub { margin: 0; color: #cbd5f5; font-size: 0.8rem; }
.progress {
  height: 6px; background: rgba(148, 163, 184, 0.2);
  border-radius: 999px; overflow: hidden;
}
.progress span {
  display: block; height: 100%;
  background: linear-gradient(90deg, #22d3ee, #3b82f6);
}

/* Charts ------------------------------------------------------------------ */
.dashboard-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
  gap: 0.75rem; margin-bottom: 1rem;
}
.card-header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.6rem; margin-bottom: 0.5rem; }
.card-header .meta { text-align: right; }
.chart-shell { height: var(--chart-height); }
.chart-shell svg { display: block; width: 100%; height: 100%; }
.chart-frame { display: flex; gap: 0.45rem; height: 100%; }
.chart-yaxis { display: flex; flex-direction: column; justify-content: space-between; flex: 0 0 auto; min-width: 2.1rem; padding: 1px 0; text-align: right; font-size: 0.66rem; line-height: 1; color: #94a3b8; font-variant-numeric: tabular-nums; }
.chart-plot { flex: 1; min-width: 0; }
.chart-plot svg { display: block; width: 100%; height: 100%; }
.chart-axis { display: flex; justify-content: space-between; gap: 0.5rem; margin-top: 0.4rem; font-size: 0.72rem; color: #94a3b8; }
.donut { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; min-height: var(--chart-height); }
.donut svg { width: 132px; height: 132px; flex: 0 0 132px; }
.legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; font-size: 0.82rem; color: #cbd5f5; }
.legend .dot { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 999px; margin-right: 0.4rem; }

/* Filters ----------------------------------------------------------------- */
.filter-controls {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 10px;
  padding: 0.8rem;
  margin-bottom: 1rem;
}
.filter-form { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: flex-end; justify-content: space-between; }
.filter-group { display: flex; flex-direction: column; gap: 0.3rem; }
.filter-group label { color: #cbd5f5; font-size: 0.72rem; font-weight: 600; }
.filter-actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.filter-presets { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.filter-summary { margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px solid rgba(148, 163, 184, 0.2); }
.preset-btn, .apply-btn, button {
  padding: 0.42rem 0.8rem;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(59, 130, 246, 0.15);
  color: #cbd5f5;
  font: inherit; font-size: 0.82rem; font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.preset-btn:hover, .apply-btn:hover, button:hover { background: rgba(59, 130, 246, 0.25); text-decoration: none; }
.preset-btn[aria-current="page"] {
  background: rgba(56, 189, 248, 0.25);
  border-color: rgba(56, 189, 248, 0.6);
  color: #e0f2fe;
}
.preset-btn { display: inline-flex; align-items: center; }
.reset-btn { background: rgba(239, 68, 68, 0.15); border-color: rgba(248, 113, 113, 0.4); }
.reset-btn:hover { background: rgba(239, 68, 68, 0.25); text-decoration: none; }
.metric-form { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.5rem; }
.metric-form select { padding: 0.25rem 0.4rem; font-size: 0.72rem; }
.metric-form button { padding: 0.25rem 0.55rem; font-size: 0.72rem; }

/* Lookup table ------------------------------------------------------------ */
.controls { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; justify-content: space-between; margin-top: 0.5rem; }
.search-box { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
input[type="search"], input[type="datetime-local"], select {
  padding: 0.42rem 0.65rem;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(30, 41, 59, 0.5);
  color: #e2e8f0;
  font: inherit; font-size: 0.82rem;
}
input[type="search"] { min-width: 240px; }
input[type="search"]::placeholder { color: #64748b; }
.pager { display: flex; gap: 0.5rem; align-items: center; font-size: 0.82rem; color: #94a3b8; }
.pager a[aria-disabled="true"] { opacity: 0.4; pointer-events: none; }
.table-wrap {
  overflow-x: auto;
  margin-top: 0.7rem;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 10px;
}
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
thead { background: rgba(30, 41, 59, 0.9); }
th, td { padding: 0.55rem 0.75rem; text-align: left; border-bottom: 1px solid rgba(148, 163, 184, 0.1); }
th {
  font-weight: 600; font-size: 0.72rem; text-transform: uppercase;
  letter-spacing: 0.05em; color: #cbd5f5; white-space: nowrap;
}
tr:last-child td { border-bottom: none; }
tbody tr:nth-child(even) td { background: rgba(148, 163, 184, 0.05); }
.stars, .latency { font-weight: 600; font-variant-numeric: tabular-nums; }
.latency { color: #cbd5f5; }
.lookup-link { color: #60a5fa; }
.status-badge {
  display: inline-flex; align-items: center;
  padding: 0.1rem 0.4rem; border-radius: 6px;
  font-weight: 600; font-size: 0.78rem; line-height: 1.3;
}
.status-2xx { color: #4ade80; background: rgba(74, 222, 128, 0.15); }
.status-3xx { color: #67e8f9; background: rgba(103, 232, 249, 0.15); }
.status-4xx { color: #fde047; background: rgba(253, 224, 71, 0.15); }
.status-5xx { color: #f87171; background: rgba(248, 113, 113, 0.15); }
.status-connected { color: #4ade80; }
.chart-foot { margin: 0.35rem 0 0; font-size: 0.72rem; color: #94a3b8; }
.bar-labels { display: flex; gap: 2px; margin-top: 0.45rem; font-size: 0.62rem; color: #94a3b8; }
.bar-labels span { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.1rem; min-width: 0; white-space: nowrap; }
.bar-labels b { color: #e2e8f0; font-size: 0.7rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.bar-labels small { font-size: 0.62rem; }
.bar-list { list-style: none; margin: 0.4rem 0 0; padding: 0; display: grid; gap: 0.3rem; }
.bar-list li { display: grid; grid-template-columns: minmax(4.5rem, 32%) 1fr auto; gap: 0.4rem; align-items: center; font-size: 0.72rem; color: #cbd5f5; }
.bar-list__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-list__track { height: 6px; background: rgba(148, 163, 184, 0.18); border-radius: 999px; overflow: hidden; }
.bar-list__track span { display: block; height: 100%; background: linear-gradient(90deg, #22d3ee, #3b82f6); }
.bar-list__value { color: #94a3b8; font-variant-numeric: tabular-nums; }
.page-actions { margin-top: 1rem; }
.empty-state { text-align: center; padding: 2.5rem 1rem; color: #94a3b8; }
.empty-state strong { display: block; color: #e2e8f0; margin-bottom: 0.25rem; }
.empty-state .sub-text { font-size: 0.82rem; color: #64748b; }
.notice { margin-top: 1rem; }
.notice h2 { color: #e2e8f0; margin-bottom: 0.5rem; }
.notice p + p { margin-top: 0.5rem; }
.page-foot { margin-top: 1rem; color: #64748b; font-size: 0.75rem; }

@media (max-width: 960px) {
  table { font-size: 0.8rem; }
  th, td { padding: 0.45rem 0.55rem; }
}
@media (max-width: 59.999rem) {
  .col-lookup, .col-source, .col-latency { display: none; }
}
@media (max-width: 40rem) {
  .filter-form { align-items: stretch; }
  .filter-group { flex: 1 1 100%; }
  .filter-group input, .filter-group select { width: 100%; }
  .filter-presets { width: 100%; }
  .filter-actions { width: 100%; }
  .bar-list li { grid-template-columns: minmax(3.5rem, 38%) 1fr auto; }
}
@media (max-width: 22.5rem) {
  .col-seen { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition-duration: 0.01ms !important; }
}
`;

export function renderLayout({ title, heading, subtitle, body, refreshSeconds }: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : ''}
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <h1>${heading}</h1>
  <p class="meta hero">${subtitle}</p>
  ${body}
</div>
</body>
</html>`;
}
