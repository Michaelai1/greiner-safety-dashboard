/* Training uses the safety roster, not portal accounts. All requests are
 * intercepted locally: no real session, person, or server write is used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = process.env.SCREENSHOT_DIR;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const req = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'));
let webkit;
try { ({ webkit } = req('playwright-webkit')); }
catch { ({ webkit } = req('playwright')); }
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpeg': 'image/jpeg' };
const server = http.createServer((request, response) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(request.url, 'http://local').pathname));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await webkit.launch(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE } : {});
let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (error) { failures++; console.error(`  FAIL ${name}\n${error.stack}`); }
}
async function open({ role = 'full', width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const bundle = {
    company: { name: 'Test Contractor' },
    jobs: [{ id: 'job-westfield', name: 'Westfield Schools', job_number: 'TEST-1', status: 'active' }],
    workers: [{ id: 'worker-casey', name: 'Casey Roster', classification: 'Foreman', job_id: 'job-westfield', active: true }],
    certs: [{ id: 'legacy-cert', worker: 'Legacy Worker', cert_type: 'First Aid', issued: '2026-01-01', expires: '2028-01-01' }],
    reports: [], docs: [], stats: []
  };
  const calls = [], errors = [], unexpected = [];
  const state = { failAdd: false };
  await context.addInitScript(({ role }) => {
    localStorage.setItem('cs_session_greiner', JSON.stringify({ session: 'training-test-only', role,
      user: 'Training Test', expires_at: '2099-01-01T00:00:00Z', job_ids: role === 'field' ? ['job-westfield'] : [] }));
  }, { role });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url.startsWith(BASE) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const match = url.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!match) { if (!/fonts\.|cdnjs\./.test(url)) unexpected.push(url); return route.abort(); }
    const fn = match[1], body = JSON.parse(request.postData() || '{}');
    calls.push({ fn, body });
    let payload = [];
    if (fn === 'cs_portal_bundle') payload = bundle;
    if (fn === 'cs_portal_config') payload = null;
    if (fn === 'cs_portal_worker_add') {
      if (state.failAdd) payload = { ok: false, error: 'test failure' };
      else {
        const worker = { id: 'worker-new', name: body.p_name, job_id: body.p_job_id, classification: body.p_classification, phone: body.p_phone, active: true };
        bundle.workers.push(worker); payload = { ok: true, id: worker.id, name: worker.name };
      }
    }
    if (fn === 'cs_portal_add_cert') {
      bundle.certs.push({ id: 'cert-new', worker: body.p_worker, cert_type: body.p_cert_type, issued: body.p_issued, expires: body.p_expires });
      payload = { ok: true };
    }
    if (fn === 'cs_portal_field_home') payload = { user: 'Field Test', company: 'Test Contractor', jobs: [{ ...bundle.jobs[0], user_forms: ['jha'] }], people: [], equipment: [], recent: [] };
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.goto(BASE + 'office.html#training');
  await page.waitForSelector(role === 'field' ? '#f-signout' : '#add-training');
  return { page, context, bundle, calls, errors, unexpected, state };
}
async function scenario(fn, options) {
  const state = await open(options);
  try { await fn(state); assert.deepEqual(state.errors, []); assert.deepEqual(state.unexpected, []); }
  finally { await state.context.close(); }
}
try {
  await check('Training search includes a roster employee with no training records', () => scenario(async ({ page }) => {
    await page.fill('#tr-q', 'casey');
    await page.waitForSelector('[data-person="Casey Roster"]');
    assert.match(await page.innerText('#main'), /No certification records yet/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'training-search-desktop.png'), fullPage: true });
  }));
  await check('Add training suggests authoritative roster and legacy certificate names', () => scenario(async ({ page }) => {
    await page.click('#add-training');
    const names = await page.locator('#at-people option').evaluateAll(options => options.map(option => option.value));
    assert.ok(names.includes('Casey Roster'), 'the roster employee must be suggested even though live bundle has no people key');
    assert.ok(names.includes('Legacy Worker'), 'legacy training names remain available');
    assert.equal(names.length, new Set(names).size);
  }));
  await check('Training can add an unassigned roster employee without granting sign-in access', () => scenario(async ({ page, calls, bundle }) => {
    await page.click('#add-employee');
    await page.fill('#ic-name', 'New Test Worker');
    await page.click('#ic-save');
    await page.waitForSelector('.drawer #p-addtrain');
    const writes = calls.filter(call => /_add$|_update$|_set$/.test(call.fn));
    assert.deepEqual(writes.map(call => call.fn), ['cs_portal_worker_add']);
    assert.equal(writes[0].body.p_job_id, null);
    assert.equal(writes[0].body.p_token, 'training-test-only');
    assert.equal(bundle.workers.length, 2);
    await page.reload();
    await page.waitForSelector('[data-person="New Test Worker"]');
  }));
  await check('Adding an existing name opens its record without changing job or creating a duplicate', () => scenario(async ({ page, calls, bundle }) => {
    await page.click('#add-employee');
    await page.fill('#ic-name', '  casey roster  ');
    await page.click('#ic-save');
    await page.waitForSelector('.drawer #p-addtrain');
    assert.match(await page.innerText('.drawer'), /Casey Roster/);
    assert.equal(calls.filter(call => call.fn === 'cs_portal_worker_add' || call.fn === 'cs_portal_worker_update').length, 0);
    assert.equal(bundle.workers.length, 1);
    assert.equal(bundle.workers[0].job_id, 'job-westfield');
  }));
  await check('Add employee supports optional training through the existing certified write path', () => scenario(async ({ page, calls, bundle }) => {
    await page.click('#add-employee');
    await page.fill('#ic-name', 'New Trained Worker');
    await page.click('[data-ict="First Aid / CPR"]');
    await page.fill('.ic-exp', '2028-10-15');
    await page.click('#ic-save');
    await page.waitForSelector('.drawer #p-addtrain');
    assert.equal(bundle.certs.find(cert => cert.worker === 'New Trained Worker').cert_type, 'First Aid / CPR');
    assert.deepEqual(calls.filter(call => /worker_add|add_cert/.test(call.fn)).map(call => call.fn), ['cs_portal_worker_add', 'cs_portal_add_cert']);
  }));
  await check('Failed employee save remains visible and does not claim success', () => scenario(async ({ page, bundle, state }) => {
    state.failAdd = true;
    await page.click('#add-employee');
    await page.fill('#ic-name', 'Not Saved');
    await page.click('#ic-save');
    await page.waitForFunction(() => document.querySelector('#ic-err').textContent.includes('test failure'));
    assert.equal(bundle.workers.length, 1);
    assert.equal(await page.isEnabled('#ic-save'), true);
  }));
  await check('Training employee controls work at phone width', () => scenario(async ({ page }) => {
    await page.click('#add-employee');
    await page.waitForSelector('#ic-save');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'training-add-employee-phone.png'), fullPage: true });
  }, { width: 390 }));
  await check('Field sessions remain redirected out of office employee management', () => scenario(async ({ page, calls }) => {
    assert.match(page.url(), /index\.html/);
    assert.equal(await page.locator('#add-employee').count(), 0);
    assert.equal(calls.filter(call => call.fn === 'cs_portal_worker_add').length, 0);
  }, { role: 'field', width: 390 }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`Training employee verification: ${checks} passed, ${failures} failed.`);
if (failures) process.exitCode = 1;
