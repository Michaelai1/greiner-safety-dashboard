/* The hosted feature demo must be safe to put on a public URL.
 *
 * Checks the built demo-site/ for anything that could reach production, leak a
 * credential, expose a person, or break outside a file:// context.
 * Run tools/build-demo-site.mjs first.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const SITE = path.join(path.resolve(root.pathname), 'demo-site');

if (!fs.existsSync(SITE)) {
  console.log('Demo site verification skipped (run tools/build-demo-site.mjs first).');
  process.exit(0);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f); else files.push(f);
  }
})(SITE);
const textFiles = files.filter((f) => /\.(html|js|css|json|txt|_headers)$/.test(f) || path.basename(f) === '_headers');
const rel = (f) => path.relative(SITE, f);
const read = (f) => fs.readFileSync(f, 'utf8');

/* The only third-party fetch the hosted demo is allowed to make. */
const ALLOWED_EXTERNAL = [
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\//,
  // the inert placeholder the build substitutes for every stripped endpoint
  /^https:\/\/demo\.invalid\//,
];

/* ------------------------------------------------------------------ *
 * 1. Nothing that could reach production
 * ------------------------------------------------------------------ */
const LEAKS = [
  [/[a-z0-9]{20}\.supabase\.co/i, 'a Supabase project URL'],
  [/eyJhbGciOiJIUzI1NiI[A-Za-z0-9_\-.]+/, 'a JWT / anon key'],
  [/service_role/i, 'a service-role reference'],
  [/https?:\/\/[^'"\s]*n8n[^'"\s]*/i, 'an n8n endpoint'],
  [/https?:\/\/[^'"\s]*michaelcarey[^'"\s]*/i, 'a personal host'],
  [/\/Users\/[A-Za-z]/, 'a local absolute path'],
  [/file:\/\/[^'"\s]/, 'a file:// URL'],
  [/greiner\.creeksidesafety\.com/i, 'the production hostname'],
];
for (const f of textFiles) {
  const src = read(f);
  for (const [re, what] of LEAKS) {
    const m = src.match(re);
    assert.ok(!m, `${rel(f)} contains ${what}: ${m && m[0].slice(0, 70)}`);
  }
}

/* No real person, phone number or access code. */
for (const f of textFiles) {
  const src = read(f);
  // Any US phone number that is not in the 555 reserved-fictional range.
  const phones = src.match(/\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/g) || [];
  const real = phones.filter((n) => !/[ .(-]?555[ .)-]/.test(n) && !/^\(?555/.test(n));
  assert.deepEqual(real, [], `${rel(f)} appears to contain a real phone number: ${real[0]}`);
  // The confirmed real Choice people may appear (they are the pilot contacts the
  // demo models) but nothing else real should. Guard the obvious secrets.
  assert.ok(!/\bpin\s*[:=]\s*['"]?\d{4,}/i.test(src), `${rel(f)} appears to contain a PIN`);
}

/* ------------------------------------------------------------------ *
 * 2. No production transport can run
 * ------------------------------------------------------------------ */
{
  const cfg = read(path.join(SITE, 'office/config.js'));
  assert.match(cfg, /demo:\s*true/, 'the office config must declare demo mode');
  assert.match(cfg, /demo\.invalid/, 'the office config must point at an inert URL');
  assert.ok(!/slug:\s*'greiner'/.test(cfg), 'the real portal slug must not ship');

  const officeHtml = read(path.join(SITE, 'office/index.html'));
  assert.match(officeHtml, /demo=1/, 'the office demo must force demo mode');
  assert.match(officeHtml, /location\.replace/, 'it must redirect itself into demo mode');

  const phoneHtml = read(path.join(SITE, 'phone/index.html'));
  assert.match(phoneHtml, /var DEMO = true;/, 'the phone demo must be demo-only');
  assert.ok(!/var DEMO = params\.get/.test(phoneHtml),
    'the phone demo must not be able to leave demo mode');
  // The ticket path can never adopt a session.
  assert.match(phoneHtml, /var ticket = DEMO \? null :/,
    'the phone demo must still refuse any cached ticket');
}

/* ------------------------------------------------------------------ *
 * 3. Hostable: noindex, relative links, no file:// assumptions
 * ------------------------------------------------------------------ */
for (const page of ['index.html', 'office/index.html', 'phone/index.html']) {
  const src = read(path.join(SITE, page));
  assert.match(src, /name="robots" content="noindex, nofollow"/,
    `${page} must carry a noindex meta tag`);
}
assert.match(read(path.join(SITE, 'robots.txt')), /Disallow: \//, 'robots.txt must disallow all');
assert.match(read(path.join(SITE, '_headers')), /X-Robots-Tag: noindex/,
  'the host headers must add X-Robots-Tag');

// every internal link and asset resolves inside the site
for (const page of ['index.html', 'office/index.html', 'phone/index.html']) {
  const dir = path.dirname(path.join(SITE, page));
  const src = read(path.join(SITE, page));
  const refs = [...src.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1])
    // skip references built at runtime inside scripts (template literals and
    // string concatenation) — those are not static assets to resolve
    .filter((r) => !/[${]|' \+|\+ '/.test(r));
  for (const r of refs) {
    if (/^(https?:)?\/\//.test(r)) {
      /* One documented exception: jsPDF from a public CDN. The demo builds a
         PDF in memory so the reviewer can see the record it would produce.
         It is a public library fetch — no Greiner data is sent, and nothing is
         written anywhere. Everything else must be local. */
      assert.ok(ALLOWED_EXTERNAL.some((re) => re.test(r)),
        `${page} references an external resource: ${r}`);
      continue;
    }
    // non-file schemes carry nothing and fetch nothing
    if (/^(data:|mailto:|tel:|about:|blob:|javascript:)/.test(r)) continue;
    const target = path.join(dir, r.split('?')[0].replace(/\/$/, '/index.html'));
    assert.ok(fs.existsSync(target), `${page} references a missing file: ${r}`);
  }
}

/* Exactly one external reference in the whole build, and it is that library. */
{
  const externals = [];
  for (const f of textFiles) {
    for (const m of read(f).matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)) externals.push(m[1]);
  }
  const unexpected = externals.filter((u) => !ALLOWED_EXTERNAL.some((re) => re.test(u)));
  assert.deepEqual(unexpected, [], `unexpected external references: ${unexpected.join(', ')}`);
  // Only the one real library fetch; the rest are inert placeholders that
  // resolve nowhere by design.
  const realFetches = externals.filter((u) => !/^https:\/\/demo\.invalid\//.test(u));
  assert.ok(realFetches.length <= 1,
    `expected at most one real external fetch, got ${realFetches.length}: ${realFetches.join(', ')}`);
}

/* ------------------------------------------------------------------ *
 * 4. The features the demo is meant to show are present
 * ------------------------------------------------------------------ */
{
  const phone = read(path.join(SITE, 'phone/index.html'));
  for (const [needle, what] of [
    ['Hot Work Permit', 'Hot Work Permit'],
    ['>Complete New JHA<', 'Complete New JHA'],
    ['>Revise Submitted JHA<', 'Revise Submitted JHA'],
    ["Toolbox Talk — ' + esc(tbtCurrentTalk().t)", 'Toolbox Talk tile'],
    ['Foreman Leads Group Talk', 'foreman-led group completion'],
    ['Each Employee Completes Individually', 'individual completion'],
    ['View Original Document', 'original-document format'],
    ['Guided Talk', 'guided format'],
  ]) assert.ok(phone.includes(needle), `the phone demo must include ${what}`);

  const office = read(path.join(SITE, 'office/office.js'));
  for (const [needle, what] of [
    ['+ Add Talk to Schedule', 'Toolbox scheduling'],
    ["['log', 'Submission Log']", 'Submission Log'],
    ["['jha', 'JHA Review']", 'JHA Review'],
    ["[['visual', 'Visual Dashboard'], ['all', 'All Metrics']]", 'both analytics views'],
  ]) assert.ok(office.includes(needle), `the office demo must include ${what}`);

  // Guided Talk page images shipped.
  const manifest = JSON.parse(read(path.join(SITE, 'phone/demo-assets/toolbox-talks/manifest.json')));
  assert.ok(manifest.talks.length >= 3, 'the walkthrough talks must ship');
  assert.ok(manifest.talks.every((t) => !t.sourcePath),
    'the hosted manifest must not carry local source paths');
  assert.ok(manifest.talks.every((t) => t.sourceFolder),
    'the hosted manifest must keep the source folder for traceability');
  for (const t of manifest.talks) {
    for (const p of t.pages) {
      assert.ok(fs.existsSync(path.join(SITE, 'phone', p.src)),
        `page asset missing from the build: ${p.src}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 5. Labelled as a demo, and navigable
 * ------------------------------------------------------------------ */
{
  const landing = read(path.join(SITE, 'index.html'));
  assert.match(landing, /Demo Data/, 'the landing page must be labelled Demo Data');
  assert.match(landing, /cannot reach production/, 'it must say it cannot reach production');
  assert.match(landing, /href="phone\//, 'it must link to the phone demo');
  assert.match(landing, /href="office\//, 'it must link to the office demo');
  for (const page of ['office/index.html', 'phone/index.html']) {
    assert.match(read(path.join(SITE, page)), /class="demo-home"/,
      `${page} must offer a way back to the demo home`);
  }
  assert.ok(read(path.join(SITE, 'office/office.js')).includes('Demo Data'),
    'the office demo must carry its Demo Data label');
}

console.log(`Demo site verification passed (${files.length} files, no credentials, no production reach).`);
