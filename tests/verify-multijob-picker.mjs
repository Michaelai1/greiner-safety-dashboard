/* Nov 24 2026 regression: a crew member on two jobs who also has the job
   workspace (Chris Daigle: Westin Airport Hotel + Crispus Attucks) must see
   "Working on which jobsite?" on every workspace tab and be able to open the
   second job's forms. All RPCs are mocked; nothing reaches the database.
   Run: PW_CORE=<dir with playwright-core + playwright-webkit> TARGET_ROOT=<site dir> node tests/verify-multijob-picker.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.TARGET_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const req = createRequire(path.join(process.env.PW_CORE || ROOT, 'noop.js'));
const { webkit } = req('playwright-webkit');
const { chromium } = req('playwright-core');
const WESTIN = 'job-westin', CRISPUS = 'job-crispus';
const JOBS = [
  { id: WESTIN, name: 'Westin Airport Hotel', job_number: 'C796-2025', user_forms: ['jha', 'hotwork', 'aerial', 'forklift'] },
  { id: CRISPUS, name: 'Crispus Attucks', job_number: 'C814', user_forms: ['aerial', 'forklift', 'hotwork', 'jha'] }
];

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://local').pathname;
  const file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
  const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
  response.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;

async function run(name, browserType, opts) {
  const browser = await browserType.launch(opts);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    const m = url.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!m) return route.abort();
    const fn = m[1];
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(route.request().postData() || '{}');
    requests.push({ fn, body });
    let data = null;
    if (fn === 'cs_portal_login') data = { ok: true, session: 'test-session', user: 'Chris Test', role: 'field', expires_at: new Date(Date.now() + 86400000).toISOString(), job_ids: [WESTIN, CRISPUS] };
    else if (fn === 'cs_portal_field_home') data = { user: 'Chris Test', company: 'Greiner Brothers', jobs: JOBS, people: [], equipment: [], recent: [], hotwork_locations: [] };
    else if (fn === 'cs_portal_job_workspace') { const j = JOBS.find(x => x.id === body.p_job_id); data = { job_id: j.id, checked_at: new Date().toISOString(), job: { id: j.id, name: j.name, job_number: j.job_number }, people: [], certs: [], equipment: [], incidents: [] }; }
    else if (fn === 'cs_portal_site_safety') data = { job_id: body.p_job_id, kind: body.p_kind, total: 0, offset: 0, items: [] };
    else if (fn === 'cs_portal_job_docs') data = [];
    else if (fn === 'cs_portal_field_ticket') data = { ticket: 'ft_test', user: 'Chris Test', expires_at: new Date(Date.now() + 3600000).toISOString() };
    return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const results = [];
  const check = async (label, fn) => { try { await fn(); results.push(['ok  ', label]); } catch (e) { results.push(['FAIL', label + ' :: ' + String(e.message).split('\n')[0]]); } };
  try {
    await page.goto(BASE);
    await page.locator('#gate-in').fill('1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('#job-workspace-nav').waitFor({ timeout: 8000 });
    await check('job box shows on Job overview', async () => assert.ok(await page.locator('#f-job').isVisible()));
    for (const tab of ['Forms', 'Safety records', 'Documents', 'Crew and training', 'Equipment', 'Incident status']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await check(`job box shows on ${tab}`, async () => assert.ok(await page.locator('#f-job').isVisible()));
    }
    await check('job box sits above the workspace tabs', async () => assert.ok(await page.evaluate(() => {
      const box = document.querySelector('#f-job'), nav = document.querySelector('#job-workspace-nav');
      return !!(box.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING);
    })));
    await check('picking Crispus Attucks opens it', async () => {
      await page.locator('#f-job').selectOption(CRISPUS, { timeout: 3000 });
      await page.getByRole('button', { name: 'Job overview', exact: true }).click({ timeout: 3000 });
      await page.getByRole('heading', { name: 'Crispus Attucks' }).waitFor({ timeout: 5000 });
      assert.ok(await page.locator('#f-job').isVisible(), 'job box still shows after switching');
    });
    await check('Crispus Attucks forms are offered', async () => {
      await page.getByRole('button', { name: 'Forms', exact: true }).click({ timeout: 3000 });
      await page.locator('[data-ngform="jha"]').waitFor({ state: 'visible', timeout: 3000 });
    });
    await check('starting a JHA asks for a Crispus Attucks ticket', async () => {
      await page.locator('[data-ngform="jha"]').click({ timeout: 3000 });
      await page.waitForFunction(() => true);
      for (let i = 0; i < 20 && !requests.some(r => r.fn === 'cs_portal_field_ticket'); i++) await page.waitForTimeout(150);
      const t = requests.filter(r => r.fn === 'cs_portal_field_ticket').pop();
      assert.equal(t && t.body.p_job_id, CRISPUS);
    });
    await check('no page errors', async () => assert.deepEqual(errors, []));
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', `multijob-${name}.png`), fullPage: false }).catch(() => {});
  } finally { await browser.close(); }
  return results;
}

let failed = 0;
try {
  for (const [name, type, opts] of [['webkit', webkit, {}], ['chrome', chromium, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }]]) {
    const res = await run(name, type, opts);
    for (const [s, l] of res) { console.log(`${name.padEnd(7)} ${s} ${l}`); if (s === 'FAIL') failed++; }
  }
} finally { await new Promise(r => server.close(r)); }
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
