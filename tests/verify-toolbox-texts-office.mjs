/* Office dashboard, Toolbox Talks → "Sent by text" panel, in a real browser
 * (WebKit) in production mode (no ?demo=1). Every RPC is answered inside this
 * test with fake "(Test)" people; nothing leaves the machine.
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
  console.log('Toolbox texts office verification skipped (set PLAYWRIGHT_NODE_MODULES).');
  process.exit(0);
}
const SHOTS = process.env.SCREENSHOT_DIR || null;

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

const JOB = { id: 'job-purdue', name: 'Purdue Academic Bldg.', job_number: 'C800-2025', status: 'active' };
const TEXTS = [
  { id: 'a-held', talk_title: 'Fall Protection', recipient_name: 'Office Copy (Test)', phone_last4: '0001',
    role: 'participant', is_test: true, send_status: 'held', send_at: '2026-10-05T12:00:00Z', sent_at: null,
    opened_at: null, submitted_at: null, attendees: [], manual_attendees: [] },
  { id: 'a-lead', talk_title: 'Fall Protection', recipient_name: 'Foreman One (Test)', phone_last4: '0002',
    role: 'leader', crew_job_id: 'job-purdue', is_test: false, send_status: 'sent',
    send_at: '2026-10-05T12:00:00Z', sent_at: '2026-10-05T12:00:00Z', opened_at: null, submitted_at: null,
    attendees: [], manual_attendees: [] },
  { id: 'a-done', talk_title: 'Fall Protection', recipient_name: 'Foreman Two (Test)', phone_last4: '0003',
    role: 'leader', crew_job_id: 'job-purdue', is_test: false, send_status: 'sent',
    send_at: '2026-10-05T12:00:00Z', sent_at: '2026-10-05T12:00:00Z', opened_at: '2026-10-05T12:05:00Z',
    submitted_at: '2026-10-05T12:20:00Z', presenter: 'Foreman Two (Test)', format_used: 'guided', active_ms: 600000,
    attendees: ['Crew Alpha (Test)', 'Crew Bravo (Test)'], manual_attendees: ['Walk In (Test)'] },
];
const calls = [], offMachine = [];
function rpc(fn) {
  if (fn === 'cs_portal_bundle') return { company: { name: 'Greiner Brothers' }, jobs: [JOB] };
  if (fn === 'cs_portal_tbt_texts') return TEXTS;
  if (fn === 'cs_portal_config') return null;
  if (fn === 'cs_portal_findings') return {};
  return [];
}

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('cs_session_greiner', JSON.stringify({
      session: 'fake-session-for-test', user: 'Office (Test)', expires_at: '2099-01-01T00:00:00Z' }));
  });
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    const m = u.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
    if (m) { calls.push(m[1]); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rpc(m[1])) }); }
    offMachine.push(u); return r.abort();
  });
  await page.goto(BASE + 'office.html#talks');
  await page.waitForSelector('[data-tbtx]', { timeout: 8000 });
  const text = () => page.evaluate(() => document.querySelector('#main').innerText);

  await check('Toolbox Talks shows a "Sent by text" panel with every texted talk', async () => {
    const t = await text();
    assert.match(t, /Sent by text/);
    assert.equal((await page.$$('[data-tbtx]')).length, 3);
    assert.ok(calls.includes('cs_portal_tbt_texts'));
  });
  await check('the held copy reads as on hold, not sent, and is marked Test', async () => {
    const r = await page.$eval('[data-tbtx="a-held"]', (e) => e.innerText);
    assert.match(r, /On hold \(not sent\)/); assert.match(r, /Test/); assert.ok(!/Texted/.test(r));
  });
  await check('the foreman text reads as texted, not opened, with the Purdue crew', async () => {
    const r = await page.$eval('[data-tbtx="a-lead"]', (e) => e.innerText);
    assert.match(r, /Texted/); assert.match(r, /Not opened yet/); assert.match(r, /Foreman/);
    assert.match(r, /Purdue Academic Bldg\./); assert.match(r, /C800-2025/); assert.match(r, /ends 0002/);
  });
  await check('a submitted foreman talk shows Submitted and the head count (2 picked + 1 typed in)', async () => {
    const r = await page.$eval('[data-tbtx="a-done"]', (e) => e.innerText);
    assert.match(r, /Submitted/); assert.match(r, /\b3\b/);
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'toolbox-texts-panel.png'), fullPage: false });
  await check('opening a submitted talk lists the presenter and everyone who was there', async () => {
    await page.click('[data-tbtx="a-done"]');
    const d = await page.$eval('.drawer', (e) => e.innerText);
    assert.match(d, /Presented by\s*Foreman Two \(Test\)/);
    assert.match(d, /Crew Alpha \(Test\)/); assert.match(d, /Crew Bravo \(Test\)/);
    assert.match(d, /Walk In \(Test\) \(typed in\)/); assert.match(d, /Guided talk/); assert.match(d, /10 min/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'toolbox-texts-drawer.png'), fullPage: false });
    await page.click('.drawer .x');
  });
  await check('Refresh reloads from the server', async () => {
    const before = calls.filter((c) => c === 'cs_portal_tbt_texts').length;
    await page.click('#tbtx-refresh'); await page.waitForSelector('[data-tbtx]');
    assert.ok(calls.filter((c) => c === 'cs_portal_tbt_texts').length > before);
  });
  await check('fits a phone-width window without sideways scroll', async () => {
    await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(200);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(o <= 1, 'overflow ' + o);
  });
  await check('no page errors; nothing left the machine', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(offMachine, []);
  });
} finally { await browser.close(); server.close(); }
if (failures) { console.log(`Toolbox texts office verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`Toolbox texts office verification passed (${checks} checks, nothing sent or recorded).`);
