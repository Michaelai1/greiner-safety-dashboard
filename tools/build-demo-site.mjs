/* Build the standalone, read-only feature demo.
 *
 * Assembles demo-site/ from the two demo worktrees and strips everything that
 * must never sit on a public URL:
 *   - the production Supabase URL and anon key (both builds)
 *   - local absolute paths and any file:// document opener
 *   - anything that could read or write production
 *
 * The output is static files only. Run:  node tools/build-demo-site.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(HERE, '..');
const PHONE = path.resolve(DASH, '../greiner-qr-weekend-2026-09-26');
const OUT = path.join(DASH, 'demo-site');

const NOTE = 'DEMO BUILD — credentials stripped, no production access';
const DEAD_URL = 'https://demo.invalid/disabled';
const DEAD_KEY = 'demo-build-no-key';

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const mk = (p) => fs.mkdirSync(p, { recursive: true });
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => { mk(path.dirname(p)); fs.writeFileSync(p, s); };

rm(OUT); mk(OUT);

/* ---------- shared scrubbing ---------- */
function scrub(src, label) {
  let s = src;
  // 1. Supabase project URLs and anon keys -> inert placeholders
  s = s.replace(/https:\/\/[a-z0-9]{20}\.supabase\.co/g, DEAD_URL);
  s = s.replace(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_\-.]+/g, DEAD_KEY);
  // 2. local absolute paths -> just the folder and filename, for traceability
  s = s.replace(/'\/Users\/[^']*\/([^/']+)\/([^/']+\.(?:pdf|PDF))'/g, "'$1/$2'");
  s = s.replace(/"\/Users\/[^"]*\/([^/"]+)\/([^/"]+\.(?:pdf|PDF))"/g, '"$1/$2"');
  s = s.replace(/'\/Users\/[^']*'/g, "'(local source, not published)'");
  // 3. the production hostname, wherever it is mentioned
  s = s.replace(/https?:\/\/greiner\.creeksidesafety\.com[^'"\s]*/gi, DEAD_URL);
  s = s.replace(/greiner\.creeksidesafety\.com/gi, 'demo.invalid');
  // 4. n8n / webhook endpoints — blanked at runtime in demo mode, but they must
  //    not ship in a public file at all
  s = s.replace(/https:\/\/[a-z0-9-]+\.app\.n8n\.cloud\/[^'"\s]*/gi, DEAD_URL);
  s = s.replace(/https:\/\/[a-z0-9-]*n8n[a-z0-9.-]*\/[^'"\s]*/gi, DEAD_URL);
  // 4. any remaining file:// opener is dead in a hosted build
  s = s.replace(/window\.open\('file:\/\/'[^;]*;/g,
    "toast('Not available', 'The source document is not published in this demo.');");
  s = s.replace(/'file:\/\/'/g, "'about:blank#'");
  // Guard on real endpoints and secrets, not on the words used to describe them
  // in comments ("no webhook, no n8n" is a promise, not a leak).
  const LEAKS = [
    [/[a-z0-9]{20}\.supabase\.co/i, 'a Supabase project URL'],
    [/eyJhbGciOiJIUzI1NiI[A-Za-z0-9_\-.]+/, 'a JWT'],
    [/\/Users\/[A-Za-z]/, 'a local absolute path'],
    [/https?:\/\/[^'"\s]*n8n[^'"\s]*/i, 'an n8n endpoint'],
    [/https?:\/\/[^'"\s]*michaelcarey[^'"\s]*/i, 'a personal host'],
    [/file:\/\/[^'"\s]/, 'a file:// URL'],
    [/greiner\.creeksidesafety\.com/i, 'the production hostname'],
  ];
  for (const [re, what] of LEAKS) {
    const m = s.match(re);
    if (m) throw new Error(`scrub failed for ${label}: ${what} survived — ${m[0].slice(0, 60)}`);
  }
  return s;
}
function noindex(html) {
  if (html.includes('name="robots"')) {
    return html.replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex, nofollow">');
  }
  return html.replace(/<head>/i, '<head>\n<meta name="robots" content="noindex, nofollow">');
}

/* ---------- phone demo ---------- */
{
  let html = read(path.join(PHONE, 'index.html'));
  html = scrub(html, 'phone/index.html');
  html = noindex(html);
  // Force demo mode on: the hosted build has no other mode.
  html = html.replace("var DEMO = params.get('demo') === '1';",
    "var DEMO = true;   /* hosted feature demo: always demo, never production */");
  // A visible way back to the office demo.
  html = html.replace('</body>',
    '<a href="./" class="demo-home" style="position:fixed;left:12px;bottom:12px;z-index:9999;' +
    'background:#0f172a;color:#fff;border:1px solid #334155;border-radius:999px;padding:9px 15px;' +
    'font:600 13px system-ui;text-decoration:none">&larr; Demo home</a>\n</body>');
  write(path.join(OUT, 'phone/index.html'), html);

  // page images for the Guided Talk
  const assets = path.join(PHONE, 'demo-assets');
  const copyDir = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const f = path.join(from, e.name), t = path.join(to, e.name);
      // the extracted source text is a test fixture, not a site asset
      if (e.name === 'fall-source-text.txt') continue;
      if (e.isDirectory()) { mk(t); copyDir(f, t); }
      else if (e.name === 'manifest.json') {
        const m = JSON.parse(read(f));
        // keep traceability, drop the local path
        m.talks.forEach((x) => {
          x.sourceFolder = String(x.sourcePath).split('/').slice(-2, -1)[0];
          delete x.sourcePath;
        });
        m.note = (m.note || '') + ' Local source paths are removed from the hosted build.';
        write(t, JSON.stringify(m, null, 2) + '\n');
      } else { mk(to); fs.copyFileSync(f, t); }
    }
  };
  mk(path.join(OUT, 'phone/demo-assets'));
  copyDir(assets, path.join(OUT, 'phone/demo-assets'));
}

/* ---------- office demo ---------- */
{
  for (const f of ['office.css', 'office-demo.js']) {
    write(path.join(OUT, 'office', f), scrub(read(path.join(DASH, f)), f));
  }
  write(path.join(OUT, 'office/office.js'), scrub(read(path.join(DASH, 'office.js')), 'office.js'));

  // A config with no credentials at all.
  write(path.join(OUT, 'office/config.js'),
    '/* ' + NOTE + '. No Supabase project, no key, no slug that resolves. */\n' +
    'window.CONFIG = {\n' +
    "  contractor: 'Greiner Brothers', brand: 'Creekside Safety',\n" +
    "  pageTitle: 'Greiner Brothers Safety Dashboard (Demo)',\n" +
    "  tagline: 'Feature demo \\u00b7 fake data only',\n" +
    "  slug: 'demo-only',\n" +
    "  poweredBy: 'NextGen Safety',\n" +
    "  creekside: { url: '" + DEAD_URL + "', anonKey: '" + DEAD_KEY + "' },\n" +
    '  demo: true\n' +
    '};\n');

  let html = read(path.join(DASH, 'office.html'));
  html = scrub(html, 'office.html');
  html = noindex(html);
  // the hosted build is demo-only, whatever the query string says
  html = html.replace('<script src="office-demo.js', '<script src="office-demo.js');
  html = html.replace('<body>',
    '<body>\n<script>/* hosted feature demo: force demo mode before anything loads */\n' +
    "if (location.search.indexOf('demo=1') === -1) {\n" +
    "  var u = location.pathname + '?demo=1' + location.hash; location.replace(u);\n" +
    '}\n</script>');
  html = html.replace('</body>',
    '<a href="../" class="demo-home" style="position:fixed;left:12px;bottom:12px;z-index:9999;' +
    'background:#0f172a;color:#fff;border:1px solid #334155;border-radius:999px;padding:9px 15px;' +
    'font:600 13px system-ui;text-decoration:none">&larr; Demo home</a>\n</body>');
  // The PWA manifest points at production scope; the demo does not need it.
  html = html.replace(/\s*<link rel="manifest"[^>]*>/i, '');
  write(path.join(OUT, 'office/index.html'), html);

  // assets the dashboard shell references
  const assetsFrom = path.join(DASH, 'assets');
  if (fs.existsSync(assetsFrom)) {
    mk(path.join(OUT, 'office/assets'));
    for (const e of fs.readdirSync(assetsFrom)) {
      const f = path.join(assetsFrom, e);
      if (fs.statSync(f).isFile()) fs.copyFileSync(f, path.join(OUT, 'office/assets', e));
    }
  }
}

/* ---------- landing page ---------- */
write(path.join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Greiner Safety — Feature Demo</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;background:#f4f6f9;color:#0f172a;
    font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:860px;margin:0 auto;padding:40px 20px 60px}
  h1{font-size:26px;margin:0 0 6px}
  .pill{display:inline-block;background:#fffbeb;border:1px solid #fde68a;color:#b45309;
    border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;margin-left:8px;
    vertical-align:middle}
  p.lead{color:#475569;margin:0 0 26px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media (max-width:680px){.grid{grid-template-columns:1fr}}
  a.card{display:block;background:#fff;border:1px solid #e2e8f0;border-radius:14px;
    padding:20px;text-decoration:none;color:inherit}
  a.card:hover{border-color:#1e3a8a;box-shadow:0 1px 4px rgba(15,23,42,.08)}
  a.card h2{margin:0 0 6px;font-size:17px}
  a.card span{color:#64748b;font-size:13.5px}
  ul{margin:10px 0 0;padding-left:18px;color:#475569;font-size:13px}
  .note{margin-top:26px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;
    padding:14px 16px;font-size:13px;color:#475569}
  .note b{color:#0f172a}
</style>
</head>
<body>
<div class="wrap">
  <h1>Greiner Safety — Feature Demo <span class="pill">Demo Data</span></h1>
  <p class="lead">A read-only walkthrough of the new safety features. Everything here is fake
  data on a disconnected build.</p>

  <div class="grid">
    <a class="card" href="phone/">
      <h2>Phone &mdash; field crew</h2>
      <span>What a foreman or employee sees on site.</span>
      <ul>
        <li>Hot Work Permit</li>
        <li>Complete New JHA</li>
        <li>Revise Submitted JHA</li>
        <li>Toolbox Talk &mdash; original document and Guided Talk</li>
        <li>Foreman-led group and individual completion</li>
      </ul>
    </a>
    <a class="card" href="office/">
      <h2>Office &mdash; dashboard</h2>
      <span>What the office sees back.</span>
      <ul>
        <li>Toolbox Talk scheduling, completion and library</li>
        <li>Safety Inspections: submissions, JHA review, findings</li>
        <li>Analytics: visual dashboard and all metrics</li>
      </ul>
    </a>
  </div>

  <div class="note">
    <b>This build cannot reach production.</b> The Supabase project URL and key are removed,
    there is no sign-in, and no request leaves the page. No real employee names, phone numbers,
    access codes or customer records appear anywhere. Nothing you do here is saved.
  </div>
</div>
</body>
</html>
`);

write(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
write(path.join(OUT, '_headers'), "/*\n  X-Robots-Tag: noindex, nofollow\n");

console.log('demo-site built at ' + path.relative(DASH, OUT));
