/* Office JHA current version + version history (release candidate, Oct 22), in a
 * real browser (WebKit), production mode (no ?demo=1). Every server call is
 * answered inside this test with fictional data; nothing leaves the machine.
 *
 * With the release SQL applied (cs_portal_field_inspections carries
 * revision_count / head_revision_at on JHA rows; cs_portal_jha_history exists):
 *  - the Inspections list says "Revised (N), current version <date time>" on a
 *    revised JHA and nothing on an unrevised JHA or any other form;
 *  - opening a revised JHA shows the CURRENT version (head) by default;
 *  - the Version history lists Original, Revision 1..N in order, each with its
 *    time, who, and View PDF;
 *  - View PDF / Download PDF call the field-pdf edge function, action 'url',
 *    with that version's own id (the revision id for a revision);
 *  - the revision window reads Open until <Fri 6 PM> / Closed at <Fri 6 PM> /
 *    No revision window, from the server's window_reason;
 *  - a failed history read never presents the original as current silently.
 * Without the SQL (keys absent, RPC missing): the Inspections page and the JHA
 * drawer are byte-identical to the live office (8d4c7fa, BASELINE_REF), and
 * cs_portal_jha_history is never called.
 * Both at 1440 px (desktop) and 390 px (phone): no sideways scroll, no page errors.
 *
 * Needs playwright-webkit (PLAYWRIGHT_NODE_MODULES). SCREENSHOT_DIR saves screenshots.
 *   PLAYWRIGHT_NODE_MODULES=... node tests/verify-jha-history-office.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const req = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'));
let webkit;
try { ({ webkit } = req('playwright-webkit')); } catch {
  console.log('JHA history office verification skipped (set PLAYWRIGHT_NODE_MODULES).'); process.exit(0);
}
const SHOTS = process.env.SCREENSHOT_DIR || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

/* ---- the live office, for the "looks exactly like today" comparison ------ */
const BASELINE_REF = process.env.BASELINE_REF || '8d4c7fa';
let BASELINE = null;
try {
  BASELINE = {
    'office.js': execFileSync('git', ['-C', ROOT, 'show', `${BASELINE_REF}:office.js`], { maxBuffer: 64 << 20 }),
    'jha-model.js': execFileSync('git', ['-C', ROOT, 'show', `${BASELINE_REF}:jha-model.js`], { maxBuffer: 64 << 20 }),
  };
} catch { console.log(`  --  ${BASELINE_REF} not readable from git; the byte-identical comparison is skipped.`); }

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/json' };
function serve(overrides) {
  const server = http.createServer((rq, rs) => {
    const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
    const rel = p === '/' ? 'office.html' : p.replace(/^\//, '');
    if (overrides && overrides[rel]) {
      rs.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' });
      return rs.end(overrides[rel]);
    }
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rs);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
const srvNew = await serve(null);
const srvOld = BASELINE ? await serve(BASELINE) : null;
const NEW = `http://127.0.0.1:${srvNew.address().port}/`;
const OLD = srvOld ? `http://127.0.0.1:${srvOld.address().port}/` : null;
const SKEY = 'cs_session_greiner';

/* ---- fictional records ---------------------------------------------------- */
const JOB = { id: 'job-fict-1', job_number: 'C900-2026', name: 'Maple Street Clinic (fictional)', status: 'active' };
const BUNDLE = { company: { id: 'co', name: 'Greiner Brothers' }, jobs: [JOB], reports: [], certs: [], workers: [],
  stats: [], docs: [], equipment: [], gc_templates: [] };
const base = { job_id: JOB.id, job_name: JOB.name, job_number: JOB.job_number, has_defects: false, defect_count: 0, asset_id: null };
const jha = { form_type: 'jha', form_title: 'JHA (Task / Hazard / Control)' };
// A: revised twice, window open. B: revised once, window closed, Revision 1 has no PDF yet.
// C: Saturday original, never revised, no window. D: unrevised, window open.
// E: revised once, but its history read fails. H: a Hot Work permit (never has a chain).
const ROWS = [
  { id: 'jha-a', ...base, ...jha, inspector_name: 'Dana Fictional', submitted_at: '2026-10-19T11:05:00Z', pdf_path: 'greiner/jha-a.pdf', revision_count: 2, head_revision_at: '2026-10-21T18:45:00Z' },
  { id: 'jha-b', ...base, ...jha, inspector_name: 'Lee Example', submitted_at: '2026-10-12T12:00:00Z', pdf_path: 'greiner/jha-b.pdf', revision_count: 1, head_revision_at: '2026-10-14T15:10:00Z' },
  { id: 'jha-c', ...base, ...jha, inspector_name: 'Sam Sample', submitted_at: '2026-10-17T14:00:00Z', pdf_path: 'greiner/jha-c.pdf', revision_count: 0, head_revision_at: null },
  { id: 'jha-d', ...base, ...jha, inspector_name: 'Dana Fictional', submitted_at: '2026-10-22T11:00:00Z', pdf_path: 'greiner/jha-d.pdf', revision_count: 0, head_revision_at: null },
  { id: 'jha-e', ...base, ...jha, inspector_name: 'Lee Example', submitted_at: '2026-10-20T12:30:00Z', pdf_path: 'greiner/jha-e.pdf', revision_count: 1, head_revision_at: '2026-10-20T16:00:00Z' },
  { id: 'hw-h', ...base, form_type: 'hot_work_permit', form_title: 'Hot Work Permit', inspector_name: 'Sam Sample', submitted_at: '2026-10-21T13:00:00Z', pdf_path: 'greiner/hw-h.pdf' },
];
// The same rows as the live server returns them today: no revision keys.
const LEGACY_ROWS = ROWS.map(({ revision_count, head_revision_at, ...r }) => r);
const doc = (marker) => ({ title: 'JHA', sections: [{ title: 'Task', items: [{ label: 'Task description', response: marker, flagged: false, photos: [] }] }] });
const fieldsOf = (marker) => ({ doc: doc(marker) });
const HISTORY = {
  'jha-a': {
    original: { id: 'jha-a', submitted_at: '2026-10-19T11:05:00Z', inspector_name: 'Dana Fictional', pdf_path: 'greiner/jha-a.pdf', fields: fieldsOf('ORIGINAL-A answer') },
    // deliberately out of order: the office sorts by revision_number
    revisions: [
      { id: 'rev-a2', revision_number: 2, submitted_at: '2026-10-21T18:45:00Z', submitted_by: 'Robin Placeholder', pdf_path: 'greiner/rev-a2.pdf', fields: fieldsOf('REVISION-2-A answer') },
      { id: 'rev-a1', revision_number: 1, submitted_at: '2026-10-20T13:30:00Z', submitted_by: 'Dana Fictional', pdf_path: 'greiner/rev-a1.pdf', fields: fieldsOf('REVISION-1-A answer') },
    ],
    head_revision: 2, deadline_at: '2026-10-23T22:00:00Z', window_open: true, window_reason: 'open' },
  'jha-b': {
    original: { id: 'jha-b', submitted_at: '2026-10-12T12:00:00Z', inspector_name: 'Lee Example', pdf_path: 'greiner/jha-b.pdf', fields: fieldsOf('ORIGINAL-B answer') },
    revisions: [{ id: 'rev-b1', revision_number: 1, submitted_at: '2026-10-14T15:10:00Z', submitted_by: 'Lee Example', pdf_path: null, fields: fieldsOf('REVISION-1-B answer') }],
    head_revision: 1, deadline_at: '2026-10-16T22:00:00Z', window_open: false, window_reason: 'closed' },
  'jha-c': {
    original: { id: 'jha-c', submitted_at: '2026-10-17T14:00:00Z', inspector_name: 'Sam Sample', pdf_path: 'greiner/jha-c.pdf', fields: fieldsOf('ORIGINAL-C answer') },
    revisions: [], head_revision: 0, deadline_at: null, window_open: false, window_reason: 'no-window' },
  'jha-d': {
    original: { id: 'jha-d', submitted_at: '2026-10-22T11:00:00Z', inspector_name: 'Dana Fictional', pdf_path: 'greiner/jha-d.pdf', fields: fieldsOf('ORIGINAL-D answer') },
    revisions: [], head_revision: 0, deadline_at: '2026-10-23T22:00:00Z', window_open: true, window_reason: 'open' },
};
const FULL = { ok: true, session: 'sess-full', expires_at: new Date(Date.now() + 864e5).toISOString(), user: 'Safety Manager (Test)', role: 'full', job_ids: [], company: 'Greiner Brothers' };

let calls = [], edge = [];
const unexpected = [];      // anything not local and not one of the stubbed endpoints
let sqlApplied = true;
const RPC = {
  cs_portal_bundle: () => BUNDLE,
  cs_portal_field_inspections: () => (sqlApplied ? ROWS : LEGACY_ROWS),
  cs_portal_findings: () => ({}),
  cs_portal_incidents: () => [],
  cs_portal_field_doc: (b) => ({ id: b.p_id, doc: doc(`FIELD-DOC ${b.p_id}`) }),
};

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
const browser = await webkit.launch();
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const json = (r, status, body) => r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
async function open(origin, hash, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [SKEY, JSON.stringify(FULL)]);
  // Routed on the CONTEXT so a PDF pop-up window is covered too.
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(NEW) || (OLD && u.startsWith(OLD)) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return r.continue();
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const m = u.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      const body = JSON.parse(r.request().postData() || '{}');
      calls.push({ fn: m[1], body, origin });
      if (m[1] === 'cs_portal_jha_history') {
        if (!sqlApplied) return json(r, 404, { code: 'PGRST202', message: 'Could not find the function public.cs_portal_jha_history' });
        const h = HISTORY[body.p_original];
        return h ? json(r, 200, h) : json(r, 400, { message: 'JHA not found' });
      }
      const f = RPC[m[1]];
      return json(r, 200, f ? f(body) : []);
    }
    if (/supabase\.co\/functions\/v1\/field-pdf$/.test(u)) {
      const body = JSON.parse(r.request().postData() || '{}');
      edge.push(body);
      return json(r, 200, { url: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK' });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.abort();   // never fetched, never sent
    unexpected.push(u); return r.abort();
  });
  ctx.on('page', (pg) => { pg.on('pageerror', () => {}); });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(origin + 'office.html#' + hash);
  return page;
}
const noOverflow = async (p, label) => {
  const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(o.sw <= o.cw + 1, `${label}: page ${o.sw} > ${o.cw}`);
  const d = await p.evaluate(() => { const b = document.querySelector('.drawer-bd'); return b ? { sw: b.scrollWidth, cw: b.clientWidth } : null; });
  if (d) assert.ok(d.sw <= d.cw + 1, `${label}: drawer ${d.sw} > ${d.cw}`);
};
const rowText = (p, id) => p.$eval(`tr[data-crewi="${id}"]`, (tr) => tr.innerText.replace(/\s+/g, ' ').trim());
async function openRow(p, id) {
  await p.click(`tr[data-crewi="${id}"] td:nth-child(2)`);
  await p.waitForSelector('.drawer .drawer-bd');
}
const waitDoc = (p) => p.waitForFunction(() => { const b = document.querySelector('#crew-doc'); return b && !/Loading/.test(b.textContent); });
const drawerText = (p) => p.$eval('.drawer', (d) => d.innerText.replace(/\s+/g, ' '));
const txt = async (p, sel) => (await p.innerText(sel)).replace(/\s+/g, ' ').trim();
const historyCalls = () => calls.filter((c) => c.fn === 'cs_portal_jha_history');

try {
  for (const width of [1440, 390]) {
    const W = `${width}px`;
    await check(`${W}: list badge "Revised (N), current version <date time>" only on revised JHAs`, async () => {
      sqlApplied = true; calls = [];
      const p = await open(NEW, 'insp', { width });
      await p.waitForSelector('tr[data-crewi="jha-a"]');
      assert.match(await rowText(p, 'jha-a'), /Revised \(2\), current version Oct 21, 2026 · 2:45 PM/);
      assert.match(await rowText(p, 'jha-b'), /Revised \(1\), current version Oct 14, 2026 · 11:10 AM/);
      for (const id of ['jha-c', 'jha-d', 'hw-h']) assert.ok(!/Revised/.test(await rowText(p, id)), `${id} has no badge`);
      assert.deepEqual(historyCalls(), [], 'the list itself reads no history');
      await noOverflow(p, `list ${W}`);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `jha-history-list-${width}.png`), fullPage: true });
      assert.deepEqual(p.errors, []);
      await p.context().close();
    });

    await check(`${W}: a revised JHA opens on its current version, history in order, window open`, async () => {
      sqlApplied = true; calls = []; edge = [];
      const p = await open(NEW, 'insp', { width });
      await p.waitForSelector('tr[data-crewi="jha-a"]');
      await openRow(p, 'jha-a');
      await p.waitForSelector('#jrv-list');
      await waitDoc(p);
      assert.deepEqual(historyCalls().map((c) => [c.body.p_original, c.body.p_token]), [['jha-a', 'sess-full']]);
      assert.match(await txt(p, '#jrv-cur'), /Showing the current version: Revision 2, Oct 21, 2026 · 2:45 PM by Robin Placeholder/);
      assert.equal((await txt(p, '#jrv-items-h')).toLowerCase(), 'inspection items · revision 2');
      const items = await txt(p, '#crew-doc');
      assert.match(items, /REVISION-2-A answer/, 'head answers shown by default');
      assert.ok(!/ORIGINAL-A|REVISION-1-A/.test(items), 'only the head');
      const vers = await p.$$eval('#jrv-list .jrv-item', (li) => li.map((x) => ({
        n: x.getAttribute('data-jrv-ver'), name: x.querySelector('.jrv-name').innerText.replace(/\s+/g, ' ').trim(),
        when: x.querySelector('.jrv-when').innerText.replace(/\s+/g, ' ').trim(), pdf: !!x.querySelector('[data-jrv-pdf]'), cur: x.classList.contains('is-cur') })));
      assert.deepEqual(vers.map((v) => v.n), ['0', '1', '2'], 'Original, Revision 1, Revision 2');
      assert.deepEqual(vers.map((v) => v.name.replace(/\s*Current$/i, '')), ['Original', 'Revision 1', 'Revision 2']);
      assert.deepEqual(vers.map((v) => v.when), ['Oct 19, 2026 · 7:05 AM · Dana Fictional',
        'Oct 20, 2026 · 9:30 AM · Dana Fictional', 'Oct 21, 2026 · 2:45 PM · Robin Placeholder']);
      assert.deepEqual(vers.map((v) => v.pdf), [true, true, true]);
      assert.deepEqual(vers.map((v) => v.cur), [false, false, true], 'only the head is marked Current');
      assert.equal(await p.getAttribute('#jrv-window .jrv-win', 'data-reason'), 'open');
      assert.match(await txt(p, '#jrv-window'), /Open\s+until Fri, Oct 23, 6:00 PM/);
      const t = await drawerText(p);
      assert.match(t, /Current version Revision 2 · Oct 21, 2026 · 2:45 PM/);
      assert.match(t, /Submitted Oct 19, 2026 · 7:05 AM/, 'the original submission time is kept');
      assert.match(t, /Download PDF \(current version\)/);
      assert.match(t, /Result \(original\) All items passed/, 'a revision carries no defect flags: the result says whose it is');
      await noOverflow(p, `drawer ${W}`);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `jha-history-drawer-open-${width}.png`), fullPage: false });

      // Older versions on request; PDFs by each version's own id.
      await p.click('#jrv-list [data-jrv-show="0"]');
      assert.match(await txt(p, '#crew-doc'), /ORIGINAL-A answer/);
      assert.match(await txt(p, '#jrv-items-h'), /Original/i);
      await p.click('#jrv-list [data-jrv-show="1"]');
      assert.match(await txt(p, '#crew-doc'), /REVISION-1-A answer/);
      for (const [sel, id] of [['#jrv-list [data-jrv-pdf="rev-a1"]', 'rev-a1'], ['#jrv-list [data-jrv-pdf="jha-a"]', 'jha-a'],
                               ['#dl-crewi', 'rev-a2']]) {
        const before = edge.length;
        await p.click(sel);
        const t0 = Date.now();
        while (edge.length === before && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
        assert.equal(edge.length, before + 1, `${sel}: one edge call`);
        assert.deepEqual(edge[edge.length - 1], { action: 'url', token: 'sess-full', id }, `${sel} asks for ${id}`);
      }
      assert.deepEqual(p.errors, []);
      await p.context().close();
    });

    await check(`${W}: closed window and a revision without a PDF yet`, async () => {
      sqlApplied = true; calls = [];
      const p = await open(NEW, 'insp', { width });
      await p.waitForSelector('tr[data-crewi="jha-b"]');
      await openRow(p, 'jha-b');
      await p.waitForSelector('#jrv-list');
      await waitDoc(p);
      assert.equal(await p.getAttribute('#jrv-window .jrv-win', 'data-reason'), 'closed');
      assert.match(await txt(p, '#jrv-window'), /Closed\s+at Fri, Oct 16, 6:00 PM/);
      assert.match(await txt(p, '#crew-doc'), /REVISION-1-B answer/);
      assert.equal(await p.$('#dl-crewi'), null, 'no Download button for a PDF that does not exist');
      assert.match(await txt(p, '#jrv-nopdf'), /The PDF for Revision 1 is not attached yet/);
      const rows = await p.$$eval('#jrv-list .jrv-item', (li) => li.map((x) => x.innerText.replace(/\s+/g, ' ')));
      assert.match(rows[0], /View PDF/); assert.match(rows[1], /No PDF yet/);
      await noOverflow(p, `closed drawer ${W}`);
      assert.deepEqual(p.errors, []);
      await p.context().close();
    });

    await check(`${W}: unrevised JHAs: no-window and open window; the original is shown and labelled`, async () => {
      sqlApplied = true; calls = []; edge = [];
      const p = await open(NEW, 'insp', { width });
      await p.waitForSelector('tr[data-crewi="jha-c"]');
      await openRow(p, 'jha-c');
      await p.waitForSelector('#jrv-list');
      await waitDoc(p);
      assert.equal(await p.getAttribute('#jrv-window .jrv-win', 'data-reason'), 'no-window');
      assert.match(await txt(p, '#jrv-window'), /No revision window/);
      assert.match(await drawerText(p), /submitted on a weekend or after 6:00 PM Friday, so it cannot be revised/);
      assert.match(await txt(p, '#jrv-cur'), /Showing the original\. This JHA has not been revised\./);
      assert.equal(await p.$$eval('#jrv-list .jrv-item', (li) => li.length), 1);
      assert.match(await txt(p, '#crew-doc'), /ORIGINAL-C answer/);
      assert.equal(await txt(p, '#dl-crewi'), 'Download PDF');
      await p.click('#dl-crewi');
      const t0 = Date.now(); while (!edge.length && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(edge, [{ action: 'url', token: 'sess-full', id: 'jha-c' }]);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `jha-history-drawer-nowindow-${width}.png`), fullPage: false });
      await p.keyboard.press('Escape').catch(() => {});
      await p.evaluate(() => { document.querySelectorAll('.scrim,.drawer').forEach((e) => e.remove()); });
      await openRow(p, 'jha-d');
      await p.waitForSelector('#jrv-list');
      assert.equal(await p.getAttribute('#jrv-window .jrv-win', 'data-reason'), 'open');
      assert.match(await txt(p, '#jrv-window'), /Open\s+until Fri, Oct 23, 6:00 PM/);
      await noOverflow(p, `unrevised drawer ${W}`);
      assert.deepEqual(p.errors, []);
      await p.context().close();
    });

    await check(`${W}: a Hot Work row never reads JHA history and opens exactly as before`, async () => {
      sqlApplied = true; calls = [];
      const p = await open(NEW, 'insp', { width });
      await p.waitForSelector('tr[data-crewi="hw-h"]');
      await openRow(p, 'hw-h');
      await waitDoc(p);
      assert.deepEqual(historyCalls(), []);
      assert.equal(await p.$('#jrv-list'), null);
      assert.match(await txt(p, '#crew-doc'), /FIELD-DOC hw-h/);
      assert.deepEqual(p.errors, []);
      await p.context().close();
    });

    await check(`${W}: a failed history read says so and shows the original as the original`, async () => {
      sqlApplied = true; calls = [];
      const p = await open(NEW, 'insp', { width });
      await p.waitForSelector('tr[data-crewi="jha-e"]');
      await openRow(p, 'jha-e');
      await p.waitForSelector('#jrv-err');
      await waitDoc(p);
      assert.match(await txt(p, '#jrv-err'), /revised 1 time, but its version history could not be loaded\. Showing the original as submitted\./);
      assert.match(await txt(p, '#crew-doc'), /FIELD-DOC jha-e/);
      assert.ok(await p.isVisible('.drawer'), 'still signed in, drawer open');
      assert.ok(await p.evaluate((k) => !!localStorage.getItem(k), SKEY), 'session kept');
      assert.deepEqual(p.errors, []);
      await p.context().close();
    });

    await check(`${W}: without the SQL (keys absent, RPC missing) the office is exactly today's`, async () => {
      sqlApplied = false; calls = [];
      const grab = async (origin) => {
        const p = await open(origin, 'insp', { width });
        await p.waitForSelector('tr[data-crewi="jha-a"]');
        const main = await p.$eval('#main', (m) => m.innerHTML);
        await openRow(p, 'jha-a');
        await waitDoc(p);
        const dr = await p.$eval('.drawer', (d) => d.innerHTML);
        await p.evaluate(() => { document.querySelectorAll('.scrim,.drawer').forEach((e) => e.remove()); });
        await openRow(p, 'hw-h');
        await waitDoc(p);
        const dr2 = await p.$eval('.drawer', (d) => d.innerHTML);
        await noOverflow(p, `legacy ${W}`);
        assert.deepEqual(p.errors, []);
        await p.context().close();
        return { main, dr, dr2 };
      };
      const now = await grab(NEW);
      assert.ok(!/Revised|jrv-|Version history|revision window/i.test(now.main + now.dr), 'no revision UI at all');
      assert.match(now.dr, /FIELD-DOC jha-a/, 'the JHA drawer reads cs_portal_field_doc as today');
      assert.deepEqual(historyCalls(), [], 'cs_portal_jha_history is never called');
      if (OLD) {
        const was = await grab(OLD);
        assert.equal(now.main, was.main, 'Inspections page byte-identical to the live office');
        assert.equal(now.dr, was.dr, 'JHA drawer byte-identical to the live office');
        assert.equal(now.dr2, was.dr2, 'Hot Work drawer byte-identical to the live office');
      }
    });
  }

  await check('With the SQL applied, every non-JHA drawer and the list markup outside the badge match the live office', async () => {
    if (!OLD) return;
    sqlApplied = true; calls = [];
    const grab = async (origin) => {
      const p = await open(origin, 'insp');
      await p.waitForSelector('tr[data-crewi="hw-h"]');
      const main = await p.$eval('#main', (m) => { const c = m.cloneNode(true); c.querySelectorAll('.jrv-badge').forEach((b) => b.remove()); return c.innerHTML; });
      await openRow(p, 'hw-h');
      await waitDoc(p);
      const dr = await p.$eval('.drawer', (d) => d.innerHTML);
      await p.context().close();
      return { main, dr };
    };
    const now = await grab(NEW), was = await grab(OLD);
    assert.equal(now.main, was.main);
    assert.equal(now.dr, was.dr);
  });

  await check('Nothing left the machine (every request local or answered inside this test)', async () => {
    assert.deepEqual(unexpected, []);
  });
} finally {
  await browser.close();
  srvNew.close(); if (srvOld) srvOld.close();
}
if (failures) { console.log(`JHA history office verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`JHA history office verification passed (${checks} checks, 1440 + 390 px, fictional data, nothing sent).`);
