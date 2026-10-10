/* Office dashboard (office.html) in a real browser (WebKit), production mode
 * (no ?demo=1). Every server call is answered inside this test; nothing leaves
 * the machine.
 *
 * 1. Analytics on real-shaped Greiner data: the approved Visual Dashboard and
 *    All Metrics views, only the sections production records can fill, numbers
 *    that match the records, no demo or fixture wording, no page errors, no
 *    sideways scroll at 1440 and 1024.
 * 2. A field (foreman/crew) login used on office.html lands in the field view
 *    (index.html) with the same session, and never sees office administration.
 *    That holds for a fresh sign-in, a stored field session, and an older stored
 *    session that carries no role.
 * 3. The demo (?demo=1) Analytics page still carries its Demo Data label.
 *
 * Needs playwright-webkit (PLAYWRIGHT_NODE_MODULES). SCREENSHOT_DIR saves screenshots.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const req = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'));
let webkit;
try { ({ webkit } = req('playwright-webkit')); } catch {
  console.log('Office live verification skipped (set PLAYWRIGHT_NODE_MODULES).'); process.exit(0);
}
const SHOTS = process.env.SCREENSHOT_DIR || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/json' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const SKEY = 'cs_session_greiner';

/* ---- real-shaped production data ---------------------------------------- */
const IU = 'job-iu', PUR = 'job-purdue';
const now = new Date();
const atToday = (h) => { const d = new Date(now); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return isoLocal(d); };
// Elapsed weekdays of this Monday-based week, today included.
const mon = new Date(now); mon.setHours(12, 0, 0, 0); mon.setDate(mon.getDate() + (mon.getDay() === 0 ? -6 : 1 - mon.getDay()));
let elapsedWeekdays = 0;
for (let d = new Date(mon), i = 0; i < 7; i++, d.setDate(d.getDate() + 1)) {
  if (isoLocal(d) <= isoLocal(now) && d.getDay() >= 1 && d.getDay() <= 5) elapsedWeekdays++;
}
const BUNDLE = {
  company: { id: 'co', name: 'Greiner Brothers' },
  jobs: [{ id: IU, job_number: 'C799-2025', name: 'IU Health Plaza G Med. Gas', status: 'active' },
         { id: PUR, job_number: 'C800-2025', name: 'Purdue Academic Bldg.', status: 'active' }],
  reports: [{ id: 'r1', job_id: PUR, imported: true, report_type: 'Safety Observation', report_date: daysAgo(20),
    inspector_name: 'Safety', defect_count: 2, s101: [{ title: 'Ladders', items: [
      { q: 'Ladder in good condition', result: 'FAIL' }, { q: 'Three points of contact', result: 'FAIL' },
      { q: 'Tied off', result: 'PASS' }] }] }],
  certs: [], workers: [], stats: [], docs: [], equipment: [], gc_templates: []
};
const FIELD = [
  { id: 'f1', form_type: 'jha', form_title: 'JHA (Task / Hazard / Control)', job_id: IU, job_name: 'IU Health Plaza G Med. Gas', job_number: 'C799-2025', inspector_name: 'Foreman A', submitted_at: atToday(7), has_defects: false, defect_count: 0 },
  { id: 'f2', form_type: 'hot_work_permit', form_title: 'Hot Work Permit', job_id: IU, job_name: 'IU Health Plaza G Med. Gas', job_number: 'C799-2025', inspector_name: 'Foreman A', submitted_at: atToday(8), has_defects: false, defect_count: 0 },
  { id: 'f3', form_type: 'hot_work_permit', form_title: 'Hot Work Permit', job_id: IU, job_name: 'IU Health Plaza G Med. Gas', job_number: 'C799-2025', inspector_name: 'Foreman B', submitted_at: atToday(9), has_defects: false, defect_count: 0 },
  { id: 'f4', form_type: 'aerial_platform', form_title: 'Aerial Platform Inspection', job_id: PUR, job_name: 'Purdue Academic Bldg.', job_number: 'C800-2025', inspector_name: 'Operator', submitted_at: atToday(7), has_defects: true, defect_count: 1, asset_id: 'SL-7' },
];
const FINDING_ACTIONS = { 'rf|r1|s101|0-1': { status: 'closed', action: 'Retrained the crew', closed_by: 'Tony', updated_at: now.toISOString() } };
const FIELD_USERS = { [IU]: [{ id: 'u1', name: 'Foreman A', role: 'field', form_keys: ['jha', 'hotwork', 'aerial', 'forklift'] }],
                      [PUR]: [{ id: 'u2', name: 'Operator', role: 'field', form_keys: ['hotwork', 'aerial'] }] };
const FULL = { ok: true, session: 'sess-full', expires_at: new Date(Date.now() + 864e5).toISOString(), user: 'Safety Manager (Test)', role: 'full', job_ids: [], company: 'Greiner Brothers' };
const FIELD_SESSION = { ok: true, session: 'sess-field', expires_at: new Date(Date.now() + 864e5).toISOString(), user: 'Foreman A', role: 'field', job_ids: [IU], company: 'Greiner Brothers' };

/* The server's own rule, mirrored: a field session is refused by every
   company-wide call ("insufficient scope"). */
const COMPANY_WIDE = new Set(['cs_portal_bundle', 'cs_portal_field_inspections', 'cs_portal_findings',
  'cs_portal_incidents', 'cs_portal_job_field_users']);
let calls = [];
const RPC = {
  cs_portal_login: (b) => b.p_pin === '4826' ? FIELD_SESSION : { ok: false, error: 'Wrong code' },
  cs_portal_bundle: () => BUNDLE,
  cs_portal_field_inspections: () => FIELD,
  cs_portal_findings: () => FINDING_ACTIONS,
  cs_portal_incidents: () => [],
  cs_portal_job_field_users: (b) => FIELD_USERS[b.p_job_id] || [],
  cs_portal_field_home: () => ({ user: 'Foreman A', company: 'Greiner Brothers',
    jobs: [{ id: IU, job_number: 'C799-2025', name: 'IU Health Plaza G Med. Gas', address: '1330 N Senate Ave',
             external_hotwork: false, enabled_forms: null, user_forms: ['jha', 'hotwork', 'aerial', 'forklift'] }],
    people: [], equipment: [], recent: [], hotwork_locations: [] }),
  cs_portal_job_docs: () => [],
  cs_portal_config: () => null,
  cs_portal_log: () => null,
};

const offMachine = [];
let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
const browser = await webkit.launch();
async function open(url, { width = 1440, height = 900, session = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  if (session) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [SKEY, JSON.stringify(session)]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('**/*', (r) => {
    const u = r.request().url(), cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const m = u.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      const body = JSON.parse(r.request().postData() || '{}');
      calls.push({ fn: m[1], token: body.p_token, page: page.url() });
      const fieldTok = body.p_token === 'sess-field' || body.p_token === 'sess-legacy';
      if (fieldTok && COMPANY_WIDE.has(m[1])) {
        return r.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: JSON.stringify({ message: 'insufficient scope' }) });
      }
      const f = RPC[m[1]];
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(f ? f(body) : []) });
    }
    if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\//.test(u)) return r.abort();
    offMachine.push(u); return r.abort();
  });
  await page.goto(BASE + url);
  return page;
}
const noOverflow = async (p, label) => {
  const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(o.sw <= o.cw + 1, `${label}: ${o.sw} > ${o.cw}`);
};
// What a live user must never read on Analytics (visible text and info text).
const BANNED = /demo|fixture|sample|not yet live|baseline|toolbox|incident|near miss|revision|finish analytics setup|data readiness/i;
const mainMarkup = (p) => p.evaluate(() => {
  const m = document.querySelector('#main').cloneNode(true);
  m.querySelectorAll('style').forEach((s) => s.remove());
  return m.innerHTML;
});

try {
  /* ---------------------------------------------------------------- 1 */
  await check('Live Analytics shows the approved Visual Dashboard on real data, nothing demo', async () => {
    const p = await open('office.html#analytics', { session: FULL });
    await p.waitForSelector('.an-grid.an-g3');
    await p.waitForFunction(() => !/Loading job assignments/.test(document.querySelector('#main').textContent));
    const t = await p.innerText('#main');
    for (const card of ['Daily Safety Compliance', 'JHA Activity', 'Open Corrective Actions',
      'Field Form Activity', 'Hot Work Activity', 'Lift Inspection Activity']) assert.ok(t.includes(card), card);
    const html = await mainMarkup(p);
    assert.ok(!BANNED.test(html), `live Analytics shows "${(html.match(BANNED) || [])[0]}"`);
    assert.equal(await p.$('.an-pill'), null, 'no Demo Data pill');
    assert.equal(await p.$('#an-company'), null, 'no demo company picker');
    assert.equal(await p.$$eval('.an-c', (c) => c.length), 6, 'six cards');
    // Numbers from the records above.
    const card = (title) => p.evaluate((tt) => [...document.querySelectorAll('.an-c')]
      .find((c) => c.querySelector('.an-h span').textContent === tt).innerText.replace(/\s+/g, ' '), title);
    const comp = await card('Daily Safety Compliance');
    assert.match(comp, new RegExp(`\\b1 Completed ${elapsedWeekdays - 1} Missed ${elapsedWeekdays} Required`),
      'one JHA due per elapsed weekday on the one job with JHA access; one done');
    assert.match(await card('JHA Activity'), /1 JHA submitted/);
    assert.match(await card('Hot Work Activity'), /2 Permits 1 Jobs 0 Flagged/, 'hot_work_permit rows count as hot work');
    assert.match(await card('Lift Inspection Activity'), /Failed: SL-7/, 'aerial_platform rows count as aerial lifts');
    assert.match(await card('Field Form Activity'), /4 Submissions 3 Form types 1 Flagged/);
    assert.match(await card('Open Corrective Actions'), /2 Open 1 Overdue 1 Closed/,
      'the same findings as the Corrective actions tab: flagged form + failed Safety 101 items');
    assert.deepEqual(p.errors, []);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'office-live-analytics-1440.png'), fullPage: true });

    // A card opens the records it counted, without demo wording.
    await p.click('.an-c[data-an-go="compliance"]');
    await p.waitForSelector('.drawer.open, .drawer:not(.hide)', { timeout: 3000 }).catch(() => {});
    const drawerText = await p.evaluate(() => document.body.innerText);
    assert.match(drawerText, /Required daily submissions/);
    assert.match(drawerText, /These are the records the card counted\./);
    assert.ok(!/Demo fixture/.test(drawerText));

    // Open Corrective Actions goes to the live Corrective actions tab: same list.
    await p.keyboard.press('Escape');
    await p.click('.an-c[data-an-go="findings"]');
    await p.waitForFunction(() => location.hash === '#obs');
    const ca = await p.innerText('#main');
    assert.match(ca.replace(/\s+/g, ' '), /findings 3 all sources still open 2 requires closeout closed out 1/i,
      'the tab shows the same three findings: two open, one closed');
    await p.context().close();
  });

  await check('Live All Metrics: only groups production can fill, no demo wording', async () => {
    const p = await open('office.html#analytics', { session: FULL, width: 1024, height: 768 });
    await p.waitForSelector('.an-grid.an-g3');
    await p.waitForFunction(() => !/Loading job assignments/.test(document.querySelector('#main').textContent));
    await noOverflow(p, 'analytics visual 1024');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'office-live-analytics-1024.png'), fullPage: true });
    await p.click('[data-an="all"]');
    await p.waitForSelector('.am-g');
    const groups = await p.$$eval('.am-g h3', (h) => h.map((x) => x.textContent));
    assert.deepEqual(groups, ['Daily Compliance', 'JHA Activity', 'Field Submissions', 'Hot Work',
      'Lift Inspections', 'Corrective Actions']);
    const html = await mainMarkup(p);
    assert.ok(!BANNED.test(html), `live All Metrics shows "${(html.match(BANNED) || [])[0]}"`);
    await noOverflow(p, 'analytics all metrics 1024');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  /* ---------------------------------------------------------------- 2 */
  await check('A field login on office.html lands in the field view with the same session', async () => {
    calls = [];
    const p = await open('office.html');
    await p.waitForSelector('#gate-in');
    await p.fill('#gate-in', '4826');
    await Promise.all([p.waitForURL(/\/index\.html$/), p.click('#gate-go')]);
    await p.waitForSelector('#fieldapp [data-ngform]');
    const stored = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), SKEY));
    assert.equal(stored.session, 'sess-field', 'the same session carries over');
    const t = await p.innerText('body');
    assert.ok(t.includes('IU Health Plaza G Med. Gas') && t.includes('C799-2025'), 'own job shown');
    for (const admin of ['Analytics', 'Subcontractors', 'Automations', 'Planner', 'Templates', 'Training']) {
      assert.ok(!t.includes(admin), `no office administration: ${admin}`);
    }
    const officeCalls = calls.filter((c) => /office\.html/.test(c.page) && COMPANY_WIDE.has(c.fn));
    assert.deepEqual(officeCalls, [], 'office.html never asked for company-wide data with a field login');
    assert.deepEqual(p.errors, []);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'office-field-login-lands-1440.png'), fullPage: true });
    await p.context().close();
  });

  await check('A stored field session opening office.html goes straight to the field view', async () => {
    const p = await open('office.html', { session: FIELD_SESSION, width: 1024, height: 768 });
    await p.waitForURL(/\/index\.html$/);
    await p.waitForSelector('#fieldapp [data-ngform]');
    assert.equal(await p.$('#nav a'), null, 'no office navigation');
    await noOverflow(p, 'field view 1024');
    await p.context().close();
  });

  await check('An older field session with no role still lands in the field view, session kept', async () => {
    const legacy = { ok: true, session: 'sess-legacy', expires_at: FIELD_SESSION.expires_at, user: 'Foreman A' };
    const p = await open('office.html', { session: legacy });
    await p.waitForURL(/\/index\.html$/);
    await p.waitForSelector('#fieldapp');
    const stored = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), SKEY));
    assert.equal(stored.session, 'sess-legacy', 'the same session is kept, not signed out');
    assert.equal(stored.role, 'field');
    await p.context().close();
  });

  await check('A full login still opens the office (unchanged)', async () => {
    const p = await open('office.html', { session: FULL });
    await p.waitForSelector('#nav a');
    assert.ok(/office\.html/.test(p.url()), 'stays on the office');
    assert.ok((await p.innerText('#nav')).includes('Analytics'));
    await p.context().close();
  });

  /* ---------------------------------------------------------------- 3 */
  await check('The demo Analytics page keeps its Demo Data label and demo sections', async () => {
    const p = await open('office.html?demo=1#analytics');
    await p.waitForSelector('.an-grid');
    const t = await p.innerText('#main');
    assert.ok(t.includes('Demo Data'), 'Demo Data pill');
    assert.ok(t.includes('Toolbox Talk Participation') && t.includes('Incidents & Near Misses'), 'demo sections unchanged');
    assert.notEqual(await p.$('#an-company'), null, 'demo company picker unchanged');
    await p.context().close();
  });

  await check('Nothing left the machine', async () => { assert.deepEqual(offMachine, []); });
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.log(`Office live verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`Office live verification passed (${checks} checks, live analytics + field login hand-off, no network).`);
