/**
 * The HTML shell for the server-rendered pages.
 *
 * Styles are inline because Helmet's default CSP permits `style-src 'unsafe-inline'`
 * but forbids inline scripts. Everything below is plain CSS: no fonts, no scripts and
 * no external requests, so the page renders from a single response.
 */

export interface LayoutOptions {
  title: string;
  subtitle: string;
  body: string;
}

const STYLES = `
:root {
  --bg: #0b0f14;
  --panel: #121821;
  --line: #22303f;
  --text: #e7eef7;
  --muted: #8b98a9;
  --accent: #f5c518;
  --good: #4cc38a;
  --warn: #e3b341;
  --bad: #f85149;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
a:hover { color: #fff; }
.wrap { max-width: 1060px; margin: 0 auto; padding: 36px 20px 72px; }
.masthead {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 16px; flex-wrap: wrap; margin-bottom: 24px;
  padding-bottom: 18px; border-bottom: 1px solid var(--line);
}
h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -0.015em; }
h1 .dot { color: var(--accent); }
.lede { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
.masthead nav { display: flex; gap: 16px; font-size: 13px; color: var(--muted); }
.masthead nav a:hover { color: var(--accent); }
.tiles {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px; margin-bottom: 18px;
}
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 13px 15px; }
.tile .label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); font-weight: 600;
}
.tile .value {
  font-size: 23px; font-weight: 600; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums; margin-top: 6px;
}
.tile .sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
.panel + .panel { margin-top: 14px; }
.panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.panel-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
.panel-head .hint { color: var(--muted); font-size: 12px; }
.chart { display: flex; align-items: flex-end; gap: 3px; height: 108px; margin-top: 16px; }
.chart .bar {
  flex: 1; background: var(--accent); opacity: 0.55; border-radius: 3px 3px 0 0;
  min-height: 2px; transition: opacity 0.12s ease;
}
.chart .bar:hover { opacity: 1; }
.chart-axis {
  display: flex; justify-content: space-between; margin-top: 8px;
  font-size: 11px; color: var(--muted);
}
.controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.tabs { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.tabs a { padding: 6px 12px; font-size: 13px; color: var(--muted); border-right: 1px solid var(--line); }
.tabs a:last-child { border-right: 0; }
.tabs a:hover { color: var(--text); }
.tabs a[aria-current="page"] { background: rgba(245, 197, 24, 0.12); color: var(--accent); }
form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
input[type="search"], select {
  background: #0e141c; border: 1px solid var(--line); color: var(--text);
  border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 13px;
}
input[type="search"] { min-width: 210px; }
input[type="search"]::placeholder { color: #5c6878; }
button {
  background: var(--accent); color: #161616; border: 0; border-radius: 7px;
  padding: 7px 14px; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer;
}
button:hover { filter: brightness(1.06); }
.export {
  color: var(--muted); font-size: 13px;
  border-bottom: 1px dashed var(--line); padding-bottom: 1px;
}
.export:hover { color: var(--accent); border-color: var(--accent); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--muted); font-weight: 600; padding: 0 10px 9px;
  border-bottom: 1px solid var(--line); white-space: nowrap;
}
thead th.num { text-align: right; }
tbody td { padding: 10px; border-bottom: 1px solid rgba(34, 48, 63, 0.55); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: rgba(255, 255, 255, 0.022); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.player { display: block; font-weight: 550; }
.uuid { display: block; color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.muted { color: var(--muted); }
.badge {
  display: inline-block; font-size: 11px; padding: 1px 7px;
  border-radius: 99px; border: 1px solid;
}
.badge.ok { color: var(--good); border-color: rgba(76, 195, 138, 0.4); }
.badge.idle { color: var(--muted); border-color: var(--line); }
.badge.warn { color: var(--warn); border-color: rgba(227, 179, 65, 0.4); }
.badge.bad { color: var(--bad); border-color: rgba(248, 81, 73, 0.4); }
.badge.nicked { color: var(--accent); border-color: rgba(245, 197, 24, 0.35); }
.empty { padding: 40px 10px; text-align: center; color: var(--muted); }
.empty strong { display: block; color: var(--text); font-weight: 600; margin-bottom: 4px; }
.pager { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 13px; color: var(--muted); }
.pager a { color: var(--accent); }
.pager a.disabled { color: #4a5563; pointer-events: none; }
footer {
  margin-top: 26px; color: var(--muted); font-size: 12px;
  display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
`;

export function renderLayout({ title, subtitle, body }: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div>
      <h1>BedWars Levelhead<span class="dot">.</span> tracking</h1>
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
