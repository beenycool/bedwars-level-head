/**
 * The HTML shell for the server-rendered pages.
 *
 * Styles are inline because Helmet's default CSP permits `style-src 'unsafe-inline'`
 * but forbids inline scripts. Everything below is plain CSS: no scripts, no external
 * requests except the two font families.
 */

export interface LayoutOptions {
  title: string;
  subtitle: string;
  body: string;
}

const STYLES = `
/* Hallmark · genre: modern-minimal · surface: app · theme: amber telemetry
 * structure: controls → tiles → volume → table · contrast: pass (40–41)
 * tokens: pass (48) · responsive: pass (34, 49, 50–57)
 * pre-emit critique: P5 H4 E5 S4 R5 V4
 */
:root {
  --color-paper: oklch(16% 0.010 85);
  --color-paper-2: oklch(20% 0.011 85);
  --color-paper-3: oklch(24% 0.012 85);
  --color-rule: oklch(30% 0.012 85);
  --color-rule-strong: oklch(40% 0.014 85);
  --color-control-border: oklch(54% 0.014 85);
  --color-ink: oklch(94% 0.008 85);
  --color-muted: oklch(72% 0.012 85);
  --color-dim: oklch(64% 0.010 85);
  --color-accent: oklch(82% 0.155 85);
  --color-accent-ink: oklch(20% 0.030 85);
  --color-accent-active: oklch(74% 0.140 85);
  --color-chart: oklch(62% 0.100 85);
  --color-focus: oklch(88% 0.160 85);
  --color-good: oklch(78% 0.140 150);
  --color-warn: oklch(80% 0.120 75);
  --color-bad: oklch(70% 0.170 25);

  --font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-body: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-md: 1.25rem;
  --text-lg: 1.5rem;
  --text-xl: 1.875rem;

  --space-3xs: 0.25rem;
  --space-2xs: 0.5rem;
  --space-xs: 0.75rem;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --space-2xl: 4rem;

  --control-height: 2.75rem;
  --radius-card: 8px;
  --radius-input: 6px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 120ms;
}
* { box-sizing: border-box; }
html, body { overflow-x: clip; }
html { background: var(--color-paper); color-scheme: dark; }
body {
  margin: 0;
  background: var(--color-paper);
  color: var(--color-ink);
  font: 400 var(--text-base)/1.55 var(--font-body);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: inherit; text-decoration: none; }
h1, h2 { font-family: var(--font-display); overflow-wrap: anywhere; min-width: 0; }
.wrap {
  max-width: 68rem;
  margin-inline: auto;
  padding: var(--space-xl) var(--space-md) var(--space-2xl);
}
.masthead {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: var(--space-sm); flex-wrap: wrap;
  padding-bottom: var(--space-sm); border-bottom: 1px solid var(--color-rule);
  margin-bottom: var(--space-md);
}
h1 { margin: 0; font-size: var(--text-lg); font-weight: 700; letter-spacing: -0.02em; }
h1 .slash {
  font-family: var(--font-mono); font-weight: 500;
  color: var(--color-accent); padding-inline: 0.2em;
}
.lede {
  margin: var(--space-3xs) 0 0;
  font-family: var(--font-body); font-size: var(--text-sm);
  color: var(--color-muted);
}
.masthead nav {
  display: flex; gap: 0;
  font-family: var(--font-body); font-size: var(--text-xs);
  text-transform: uppercase; letter-spacing: 0.08em;
}
.masthead nav a { color: var(--color-muted); white-space: nowrap; }
.masthead nav a + a::before {
  content: "·"; color: var(--color-dim);
  padding-inline: var(--space-2xs);
}
.masthead nav a:hover { color: var(--color-accent); }

/* Controls ---------------------------------------------------------------- */
.controls {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: var(--space-xs); margin-bottom: var(--space-sm);
}
.tabs {
  display: inline-flex; border: 1px solid var(--color-rule);
  border-radius: var(--radius-input);
}
.tabs a {
  display: inline-flex; align-items: center;
  height: var(--control-height); padding-inline: var(--space-xs);
  border-inline-end: 1px solid var(--color-rule);
  font-family: var(--font-body); font-size: var(--text-sm);
  color: var(--color-muted); white-space: nowrap;
}
.tabs a:first-child { border-start-start-radius: calc(var(--radius-input) - 1px); border-end-start-radius: calc(var(--radius-input) - 1px); }
.tabs a:last-child {
  border-inline-end: 0;
  border-start-end-radius: calc(var(--radius-input) - 1px);
  border-end-end-radius: calc(var(--radius-input) - 1px);
}
.tabs a:hover { color: var(--color-ink); background: var(--color-paper-3); }
.tabs a[aria-current="page"] { color: var(--color-accent-ink); background: var(--color-accent); }
form { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2xs); }
.controls form { flex: 1 1 20rem; }
input[type="search"], select, button { height: var(--control-height); }
input[type="search"], select {
  background: var(--color-paper-2);
  border: 1px solid var(--color-control-border);
  border-radius: var(--radius-input);
  color: var(--color-ink);
  padding-inline: var(--space-xs);
}
input[type="search"] {
  flex: 1 1 12rem; min-width: 0;
  font-family: var(--font-mono); font-size: var(--text-sm);
}
select {
  font-family: var(--font-body); font-size: var(--text-sm);
}
input[type="search"]::placeholder { color: var(--color-dim); }
input[type="search"]:hover, select:hover { border-color: var(--color-rule-strong); }
input[type="search"]:focus-visible, select:focus-visible,
button:focus-visible, a:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
}
button {
  background: var(--color-accent); color: var(--color-accent-ink);
  border: 0; border-radius: var(--radius-input);
  padding-inline: var(--space-sm);
  font-family: var(--font-body); font-size: var(--text-sm); font-weight: 600;
  white-space: nowrap; cursor: pointer;
  transition: background-color var(--dur-short) var(--ease-out);
}
button:hover { background: var(--color-focus); }
button:active { background: var(--color-accent-active); }

/* Tiles ------------------------------------------------------------------- */
.tiles {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2xs); margin-bottom: var(--space-sm);
}
.tile {
  background: var(--color-paper-2); border: 1px solid var(--color-rule);
  border-radius: var(--radius-card);
  padding: var(--space-xs) var(--space-sm);
}
.tile .label {
  font-family: var(--font-body); font-size: var(--text-xs);
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--color-muted); font-weight: 600;
}
.tile .value {
  margin-top: var(--space-2xs);
  font-family: var(--font-mono); font-size: var(--text-lg); font-weight: 500;
  font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
}
.tile .sub { margin-top: var(--space-3xs); font-size: var(--text-xs); color: var(--color-muted); }
.tile--lead .value { color: var(--color-accent); font-size: var(--text-xl); }
@media (min-width: 40rem) {
  .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (min-width: 64rem) {
  .tiles { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}

/* Panels ------------------------------------------------------------------ */
.panel {
  background: var(--color-paper-2); border: 1px solid var(--color-rule);
  border-radius: var(--radius-card); padding: var(--space-sm);
}
.panel + .panel { margin-top: var(--space-2xs); }
.panel p { max-width: 65ch; }
.panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-sm); flex-wrap: wrap; }
.panel-head h2 { margin: 0; font-size: var(--text-base); font-weight: 700; letter-spacing: -0.01em; }
.hint { font-family: var(--font-body); font-size: var(--text-xs); color: var(--color-muted); }

/* Chart ------------------------------------------------------------------- */
.chart {
  display: flex; align-items: flex-end; gap: var(--space-3xs);
  height: 7rem; margin-top: var(--space-sm);
  border-bottom: 1px solid var(--color-rule);
}
.bar {
  flex: 1; min-height: 2px;
  background: var(--color-chart);
  border-radius: 2px 2px 0 0;
  transition: background-color var(--dur-short) var(--ease-out);
}
.bar:hover { background: var(--color-accent); }
.chart-axis {
  display: flex; justify-content: space-between; gap: var(--space-xs);
  margin-top: var(--space-2xs);
  font-family: var(--font-body); font-size: var(--text-xs);
  color: var(--color-muted);
}

/* Table ------------------------------------------------------------------- */
.table-wrap { overflow-x: auto; margin-top: var(--space-sm); }
table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
@media (min-width: 60rem) { table { min-width: 40rem; } }
@media (max-width: 59.999rem) {
  /* Keep the four columns that answer "who, how good, how often, when". */
  .col-cache, .col-latency, .col-status { display: none; }
}
@media (max-width: 22.5rem) {
  /* Three columns are all a 320 px viewport can hold without clipping. */
  .col-seen { display: none; }
}
.col-seen { white-space: nowrap; }
thead th {
  text-align: left; padding: 0 var(--space-2xs) var(--space-2xs);
  border-bottom: 1px solid var(--color-rule-strong);
  font-family: var(--font-body); font-size: var(--text-xs); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--color-muted); white-space: nowrap;
}
thead th.num { text-align: right; }
tbody td { padding: var(--space-xs) var(--space-2xs); border-bottom: 1px solid var(--color-rule); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: var(--color-paper-3); }
.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.player { display: block; font-weight: 600; }
.uuid {
  display: block; color: var(--color-muted);
  font-family: var(--font-mono); font-size: var(--text-xs);
  white-space: nowrap;
}
.player__flag {
  font-family: var(--font-body); font-size: var(--text-xs); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--color-accent);
}
.muted { color: var(--color-muted); }
.note {
  margin: var(--space-sm) 0 0;
  font-family: var(--font-body); font-size: var(--text-xs);
  color: var(--color-muted);
}
.status { display: inline-flex; align-items: center; gap: var(--space-3xs); font-family: var(--font-mono); font-size: var(--text-xs); }
.status__mark { width: 0.5rem; height: 0.5rem; border-radius: 1px; background: currentColor; }
.status--ok { color: var(--color-good); }
.status--idle { color: var(--color-muted); }
.status--warn { color: var(--color-warn); }
.status--bad { color: var(--color-bad); }
.empty {
  padding: var(--space-xl) var(--space-sm); margin-top: var(--space-sm);
  border-top: 1px solid var(--color-rule);
  text-align: center; color: var(--color-muted);
}
.empty strong { display: block; margin-bottom: var(--space-3xs); color: var(--color-ink); font-weight: 600; }
.export {
  font-family: var(--font-body); font-size: var(--text-xs); font-weight: 600;
  color: var(--color-muted);
  border-bottom: 1px dashed var(--color-rule-strong); padding-bottom: 1px;
  white-space: nowrap;
}
.export:hover, .export:focus-visible { color: var(--color-accent); border-color: var(--color-accent); }
.pager {
  display: flex; justify-content: space-between; align-items: center;
  gap: var(--space-sm); flex-wrap: wrap;
  margin-top: var(--space-sm);
  font-family: var(--font-body); font-size: var(--text-xs); color: var(--color-muted);
}
.pager__link { color: var(--color-accent); white-space: nowrap; }
.pager__link:hover { text-decoration: underline; text-underline-offset: 3px; }
.pager__link.is-disabled { color: var(--color-dim); pointer-events: none; text-decoration: none; }
footer {
  display: flex; justify-content: space-between; gap: var(--space-sm); flex-wrap: wrap;
  margin-top: var(--space-md); padding-top: var(--space-xs);
  border-top: 1px solid var(--color-rule);
  font-family: var(--font-body); font-size: var(--text-xs); color: var(--color-muted);
}
code {
  font-family: var(--font-mono); font-size: 0.9em;
  background: var(--color-paper-3); border: 1px solid var(--color-rule);
  border-radius: 4px; padding: 0.1em 0.35em;
}
@media (max-width: 40rem) {
  .wrap { padding-inline: var(--space-sm); }
  .masthead nav { gap: 0; }
  .controls form { flex-basis: 100%; }
  input[type="search"] { flex-basis: 100%; }
  select { flex: 1 1 auto; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
`;

export function renderLayout({ title, subtitle, body }: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;700&display=swap">
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div>
      <h1>BedWars Levelhead<span class="slash">/</span>tracking</h1>
      <p class="lede">${subtitle}</p>
    </div>
    <nav>
      <a href="/stats">Tracking</a>
      <a href="/healthz">Health</a>
      <a href="https://modrinth.com/mod/bedwars-level-head">Modrinth</a>
    </nav>
  </header>
  ${body}
  <footer>
    <span>BedWars Levelhead proxy</span>
    <span>Player data from the Hypixel API</span>
  </footer>
</div>
</body>
</html>`;
}
