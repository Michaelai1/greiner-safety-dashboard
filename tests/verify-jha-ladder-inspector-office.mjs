/* Ladder inspector answer (Tony, Oct 9 2026) where the dashboards show a
 * submitted JHA in PRODUCTION mode — the stored fields.doc the phone builds
 * from the shared JHA model:
 *
 *  - office.html: Overview → Recent Field Activity → the JHA drawer.
 *  - index.html (phone dashboard, field user): Recent → View Details.
 *
 * A new JHA shows "Who will inspect the ladders prior to use?" with the names
 * and "Ladder inspector selected at" with the time. JHAs stored before the
 * change (ladder Yes with nothing else, ladder No, retired variance answers)
 * render exactly as stored, with no inspector line.
 *
 * Every RPC is answered inside this test with fake "(Test)" people; nothing
 * leaves the machine. Needs playwright-webkit (PLAYWRIGHT_NODE_MODULES).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n       ')}`); }
}

/* ---------- the shared model, as the office loads it ---------- */
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'jha-model.js'), 'utf8'), ctx);
const M = ctx.JhaModel;
const json = (v) => JSON.parse(JSON.stringify(v));
// The same mapping the phone uses to store fields.doc (jhaDocFromModel).
function docFor(data, normalize) {
  const d = normalize ? M.normalizeJhaData(data) : data;
  return json({ title: 'JHA (Task / Hazard / Control)', subtype: 'jha', meta: {},
    sections: M.jhaSections(d, { crew: { employees: [], groups: [] } }).map((s) => ({ title: s.title, aux: !!s.legacy,
      items: s.items.map((i) => ({ label: i.label, response: i.value, type: 'text', notes: '', flagged: !!i.flagged, photos: [] })) })) });
}
const PICKED = '2026-10-09T11:05:00.000Z';                      // 7:05 AM in Indianapolis
const WHEN = M.fmtIndy(PICKED);
const BASE_DATA = { jhaProjectName: 'Test Job (Test)', jhaDescriptionOfWork: 'Hang pipe (Test)',
  jhaTask1: 'Ladders / Stairways Use', jhaHazard1: 'Falls / Loss of footing', jhaAction1: 'Three points of contact', jhaAerialUse: 'no' };
const DOCS = {
  'jha-new': docFor(Object.assign({}, BASE_DATA, { jhaLadderUse: 'yes',
    jhaLadderInspectors: '["Lead Example (Test)","Crew Three (Test)"]', jhaLadderInspectorsAt: PICKED,
    jhaLadderIds: '', jhaLadderChecks: '', jhaLadderDefects: '' }), true),
  // Stored before Oct 9 by production: ladder Yes and empty ladder-ID lists.
  'jha-old-yes': docFor(Object.assign({}, BASE_DATA, { jhaLadderUse: 'yes', jhaLadderIds: [], jhaLadderChecks: [], jhaLadderDefects: [] })),
  'jha-old-no': docFor(Object.assign({}, BASE_DATA, { jhaLadderUse: 'no' })),
  // Stored before Oct 1: the retired variance answers.
  'jha-old-variance': docFor(Object.assign({}, BASE_DATA, { jhaLadderUse: 'yes', jhaNewRevised: 'new', jhaLadderSafe: 'yes',
    jhaLadderWhyNotLift: 'Corridor too narrow (Test)', jhaLadderObstacle1: 'Sprinkler main (Test)' }))
};
const NEW_LINES = ['Who will inspect the ladders prior to use?', 'Lead Example (Test), Crew Three (Test)', 'Ladder inspector selected at', WHEN];

await check('The stored document carries the inspector names and the pick time; older ones carry neither', async () => {
  const lad = (id) => (DOCS[id].sections.find((s) => s.title === 'Ladder Use') || { items: [] }).items.map((i) => i.label + ' = ' + i.response);
  assert.deepEqual(lad('jha-new'), ['Is any ladder use planned or expected today? = Yes',
    'Who will inspect the ladders prior to use? = Lead Example (Test), Crew Three (Test)', 'Ladder inspector selected at = ' + WHEN]);
  assert.deepEqual(lad('jha-old-yes'), ['Is any ladder use planned or expected today? = Yes']);
  assert.deepEqual(lad('jha-old-no'), ['Is any ladder use planned or expected today? = No']);
  assert.deepEqual(lad('jha-old-variance'), ['Is any ladder use planned or expected today? = Yes']);
  assert.ok(DOCS['jha-old-variance'].sections.some((s) => s.aux && s.items.some((i) => i.label === 'Can this work be done safely from a ladder?')));
});

const req = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'));
let webkit;
try { ({ webkit } = req('playwright-webkit')); } catch {
  console.log(`JHA ladder inspector office verification: ${checks} static checks passed; browser part skipped (set PLAYWRIGHT_NODE_MODULES).`);
  process.exit(failures ? 1 : 0);
}

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'office.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const JOB = { id: 'job-test', name: 'Test Job (Test)', job_number: 'T-001', status: 'active', address: '1 Test St',
  external_hotwork: false, enabled_forms: null, user_forms: ['jha'] };
const ROWS = Object.keys(DOCS).map((id, i) => ({ id, form_type: 'jha', form_title: 'JHA (Task / Hazard / Control)',
  inspector_name: 'Crew Two (Test)', job_id: JOB.id, job_name: JOB.name, job_number: JOB.job_number,
  submitted_at: new Date(Date.parse(PICKED) + (10 - i) * 60000).toISOString(), has_defects: false, defect_count: 0,
  asset_id: null, pdf_path: null }));
const calls = [], offMachine = [];
function rpc(fn, body) {
  if (fn === 'cs_portal_bundle') return { company: { name: 'Greiner Brothers' }, jobs: [JOB] };
  if (fn === 'cs_portal_field_inspections') return ROWS;
  if (fn === 'cs_portal_field_doc') return { doc: DOCS[body.p_id] || null };
  if (fn === 'cs_portal_field_home') return { user: 'Crew Two (Test)', company: 'Greiner Brothers', jobs: [JOB], people: [],
    equipment: [], recent: ROWS, hotwork_locations: [] };
  if (fn === 'cs_portal_config' || fn === 'cs_portal_log' || fn === 'cs_portal_log_event' || fn === 'cs_portal_event') return null;
  if (fn === 'cs_portal_findings') return {};
  return [];
}

const browser = await webkit.launch();
async function open(file, session, width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript((s) => { localStorage.setItem('cs_session_greiner', JSON.stringify(s)); }, session);
  await page.route('**/*', (r) => {
    const u = r.request().url(), cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const m = u.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
    if (m) {
      calls.push(m[1]);
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify(rpc(m[1], JSON.parse(r.request().postData() || '{}'))) });
    }
    if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\//.test(u)) return r.abort();
    offMachine.push(u); return r.abort();
  });
  await page.goto(BASE + file);
  return page;
}

try {
  await check('Office (production): the JHA drawer shows the ladder inspectors and the time they were picked', async () => {
    const p = await open('office.html#overview', { session: 'fake-session-for-test', user: 'Office (Test)', expires_at: '2099-01-01T00:00:00Z' }, 1440);
    await p.waitForSelector('[data-crewi="jha-new"]', { timeout: 8000 });
    await p.click('[data-crewi="jha-new"]');
    await p.waitForFunction(() => /ladder use/i.test((document.querySelector('#crew-doc') || {}).innerText || ''), null, { timeout: 5000 });
    const t = await p.locator('#crew-doc').innerText();
    for (const s of NEW_LINES) assert.ok(t.includes(s), `office drawer is missing "${s}"`);
    assert.ok(t.indexOf('Is any ladder use planned or expected today?') < t.indexOf('Who will inspect the ladders prior to use?'));
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('Office (production): JHAs stored before the change render as stored', async () => {
    for (const id of ['jha-old-yes', 'jha-old-no', 'jha-old-variance']) {
      const p = await open('office.html#overview', { session: 'fake-session-for-test', user: 'Office (Test)', expires_at: '2099-01-01T00:00:00Z' }, 1440);
      await p.waitForSelector(`[data-crewi="${id}"]`, { timeout: 8000 });
      await p.click(`[data-crewi="${id}"]`);
      await p.waitForFunction(() => /ladder use/i.test((document.querySelector('#crew-doc') || {}).innerText || ''), null, { timeout: 5000 });
      const t = await p.locator('#crew-doc').innerText();
      assert.ok(t.includes('Is any ladder use planned or expected today?'), id);
      assert.ok(!/Who will inspect the ladders|Ladder inspector selected at|None selected/.test(t), `${id} must not show an inspector line`);
      if (id === 'jha-old-variance') assert.ok(t.includes('Can this work be done safely from a ladder?') && t.includes('Corridor too narrow (Test)'));
      assert.deepEqual(p.errors, [], id);
      await p.close();
    }
  });

  await check('Phone dashboard (field user, production): View Details shows the ladder inspectors and the time', async () => {
    const p = await open('index.html', { session: 'fake-session-for-test', user: 'Crew Two (Test)', role: 'field',
      job_ids: [JOB.id], company: 'Greiner Brothers', expires_at: '2099-01-01T00:00:00Z' }, 390);
    await p.waitForSelector('[data-act="details"][data-id="jha-new"]', { timeout: 8000 });
    await p.click('[data-act="details"][data-id="jha-new"]');
    await p.waitForFunction(() => /ladder use/i.test((document.querySelector('#fd-body') || {}).innerText || ''), null, { timeout: 5000 });
    const t = await p.locator('#fd-body').innerText();
    for (const s of NEW_LINES) assert.ok(t.includes(s), `View Details is missing "${s}"`);
    const o = await p.evaluate(() => document.querySelector('#fielddetail').scrollWidth - document.querySelector('#fielddetail').clientWidth);
    assert.ok(o <= 1, 'no sideways scroll at phone width: ' + o);
    await p.click('#fd-back');
    await p.click('[data-act="details"][data-id="jha-old-yes"]');
    await p.waitForFunction(() => /ladder use/i.test((document.querySelector('#fd-body') || {}).innerText || ''), null, { timeout: 5000 });
    assert.ok(!/Who will inspect the ladders|Ladder inspector selected at/.test(await p.locator('#fd-body').innerText()), 'an older JHA has no inspector line');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('Nothing left the machine; no write RPC was called', async () => {
    assert.deepEqual(offMachine, []);
    assert.ok(calls.includes('cs_portal_field_doc'));
    assert.ok(!calls.some((c) => /submit|insert|update|delete|set_|save/.test(c)), 'read-only: ' + [...new Set(calls)].join(', '));
  });
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.log(`JHA ladder inspector office verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`JHA ladder inspector office verification passed (${checks} checks, production mode, no network).`);
