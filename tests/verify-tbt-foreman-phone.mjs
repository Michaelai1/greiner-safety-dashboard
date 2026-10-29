/* Toolbox Talk foreman attendance through the real talk page (greiner-QR toolbox.html, live commit), with every
 * Supabase call answered by PGlite running the live talk functions plus this change
 * (see verify-tbt-foreman-sql.mjs). Attendance therefore really persists, in a throwaway database.
 *
 * Android = Chromium with an Android 10 / Chrome 156 identity at 412 px; computer = Windows Chrome; iPhone = WebKit.
 * Fictional jobs and people. Anything that is not the local page or the stubbed Supabase is refused and fails.
 * Needs PGLITE_NODE_MODULES, PLAYWRIGHT_NODE_MODULES (webkit), PLAYWRIGHT_CHROMIUM_NODE_MODULES and
 * GREINER_QR_ROOT (a checkout of the live phone pages). Skips cleanly without them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const QR = process.env.GREINER_QR_ROOT ? path.resolve(process.env.GREINER_QR_ROOT) : null;
let webkit, chromium;
try {
  if (!QR || !fs.existsSync(path.join(QR, 'toolbox.html'))) throw new Error('no QR');
  if (!process.env.PGLITE_NODE_MODULES) throw new Error('no pglite');
  ({ webkit } = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || '/nonexistent', 'noop.js'))('playwright-webkit'));
  ({ chromium } = createRequire(path.join(process.env.PLAYWRIGHT_CHROMIUM_NODE_MODULES || '/nonexistent', 'noop.js'))('playwright-core'));
} catch {
  console.log('Toolbox Talk foreman phone verification skipped (set PGLITE_NODE_MODULES, PLAYWRIGHT_NODE_MODULES, PLAYWRIGHT_CHROMIUM_NODE_MODULES, GREINER_QR_ROOT).');
  process.exit(0);
}
const { freshDb, issue, tokenOf, GREINER, CHOICE, J } = await import('./verify-tbt-foreman-sql.mjs');

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').slice(0, 5).join('\n       ')}`); }
}
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const f = path.join(QR, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(QR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const SHOTS = process.env.SCREENSHOT_DIR || null;
const offMachine = [];
const cr = await chromium.launch(), wk = await webkit.launch();
const PROFILES = {
  android: () => cr.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }),
  desktop: () => cr.newContext({ viewport: { width: 1280, height: 900 } }),
  iphone: () => wk.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
};
async function open(db, profile, token) {
  const ctx = await PROFILES[profile]();
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    const m = u.match(/\/rest\/v1\/rpc\/(cs_tbt_link_open|cs_tbt_link_progress|cs_tbt_link_submit)$/);
    if (m) {
      const b = JSON.parse(r.request().postData() || '{}');
      try {
        if (m[1] === 'cs_tbt_link_open') {
          const rows = (await db.query('select * from cs_tbt_link_open($1)', [b.p_token])).rows;
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
        }
        if (m[1] === 'cs_tbt_link_progress') {
          await db.query('select cs_tbt_link_progress($1, $2, $3, $4)', [b.p_token, b.p_active_ms, b.p_sections_viewed, b.p_format]);
          return r.fulfill({ status: 204, body: '' });
        }
        const rows = (await db.query('select * from cs_tbt_link_submit($1, $2, $3, $4)', [b.p_token, b.p_active_ms, b.p_format, b.p_group || null])).rows;
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
      } catch (e) {
        return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: e.message }) });
      }
    }
    offMachine.push(u); return r.abort();
  });
  await page.goto(BASE + 'toolbox.html#' + token);
  await page.waitForTimeout(700);
  page.done = async () => { assert.deepEqual(page.errors, []); await ctx.close(); };
  return page;
}
const tap = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); await p.locator(sel).first().click(); };
async function readToEnd(p) {
  for (let i = 0; i < 12; i++) {
    const disabled = await p.$eval('#tbtToComplete', (b) => b.disabled).catch(() => true);
    if (!disabled) return;
    if (!(await p.$('#tbtNext'))) break;
    await tap(p, '#tbtNext'); await p.waitForTimeout(120);
  }
  assert.equal(await p.$eval('#tbtToComplete', (b) => b.disabled), false, 'Continue unlocks on the last page');
}
const roster = (p) => p.$$eval('[data-tbt-att]', (bs) => bs.map((b) => b.getAttribute('data-tbt-att')));
const row = async (db, id) => (await db.query('select presenter, attendees, manual_attendees, submitted_at, format_used from cs_tbt_assignments where id = $1', [id])).rows[0];

try {
  for (const profile of ['android', 'desktop', 'iphone']) {
    await check(`${profile}: a foreman link shows his job's crew; Submit is refused until someone is picked; the attendance is stored once`, async () => {
      const db = await freshDb();
      const r = await issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', phone: '3175550100', email: 'rob@example.invalid' });
      const p = await open(db, profile, await tokenOf(db, r.assignment_id));
      await readToEnd(p);
      await tap(p, '#tbtToComplete'); await p.waitForTimeout(150);
      assert.deepEqual(await roster(p), ['Casey Crew (Test)', 'Jordan Crew (Test)', 'Pat Account (Test)', 'Rob Foreman (Test)']);
      assert.equal(await p.$eval('#tbtPresenter', (i) => i.value), 'Rob Foreman (Test)');
      await tap(p, '#tbtSubmitGroup'); await p.waitForTimeout(100);
      assert.equal(await p.locator('#tbtErr').innerText(), 'Select who attended.');
      await tap(p, '[data-tbt-att="Casey Crew (Test)"]'); await tap(p, '[data-tbt-att="Jordan Crew (Test)"]');
      await p.fill('#tbtManual', 'Walk In (Test)'); await tap(p, '#tbtManualAdd');
      await tap(p, '#tbtSubmitGroup'); await p.waitForTimeout(100);
      assert.match(await p.locator('#tbtErr').innerText(), /Tick the box/);
      assert.equal((await row(db, r.assignment_id)).submitted_at, null, 'nothing stored before the page lets it through');
      await p.check('#tbtPresented'); await tap(p, '#tbtSubmitGroup');
      await p.waitForFunction(() => /recorded|submitted|complete/i.test(document.body.innerText) && !document.getElementById('tbtSubmitGroup'), null, { timeout: 8000 });
      if (SHOTS && profile === 'android') await p.screenshot({ path: path.join(SHOTS, 'foreman-android-done.png') });
      const a = await row(db, r.assignment_id);
      assert.deepEqual([a.presenter, a.attendees, a.manual_attendees, a.format_used], ['Rob Foreman (Test)', ['Casey Crew (Test)', 'Jordan Crew (Test)'], ['Walk In (Test)'], 'doc']);
      await p.reload(); await p.waitForTimeout(600);
      assert.equal(await p.$('#tbtSubmitGroup'), null, 'opening the link again shows it recorded, with nothing to submit');
      await p.done();
    });
  }

  await check('android: the same foreman reached by email opens the same record (one link on both channels)', async () => {
    const db = await freshDb();
    const r = await issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', phone: '3175550100', email: 'rob@example.invalid' });
    const emailTok = (await db.query('select link_url from cs_tbt_email_links where assignment_id = $1', [r.assignment_id])).rows[0].link_url.split('#')[1];
    assert.equal(emailTok, await tokenOf(db, r.assignment_id));
    const p = await open(db, 'android', emailTok);
    await readToEnd(p); await tap(p, '#tbtToComplete'); await p.waitForTimeout(150);
    assert.equal((await roster(p)).length, 4);
    await p.done();
  });

  await check('android: Westin’s two foremen both see the verified crew list; each record keeps its own attendance', async () => {
    const db = await freshDb();
    const roger = await issue(db, { job: J.westin, name: 'Roger Lead (Test)', phone: '3175550101' });
    const matt = await issue(db, { job: J.westin, name: 'Matt Second (Test)', phone: '3175550102' });
    for (const [rec, picks] of [[roger, ['Verified Crew A (Test)', 'Verified Crew B (Test)']], [matt, ['Verified Crew B (Test)']]]) {
      const p = await open(db, 'android', await tokenOf(db, rec.assignment_id));
      await readToEnd(p); await tap(p, '#tbtToComplete'); await p.waitForTimeout(150);
      assert.deepEqual(await roster(p), ['Matt Second (Test)', 'Roger Lead (Test)', 'Verified Crew A (Test)', 'Verified Crew B (Test)']);
      for (const n of picks) await tap(p, `[data-tbt-att="${n}"]`);
      await p.check('#tbtPresented'); await tap(p, '#tbtSubmitGroup');
      await p.waitForFunction(() => !document.getElementById('tbtSubmitGroup'), null, { timeout: 8000 });
      await p.done();
    }
    assert.deepEqual((await row(db, roger.assignment_id)).attendees, ['Verified Crew A (Test)', 'Verified Crew B (Test)']);
    assert.deepEqual((await row(db, matt.assignment_id)).attendees, ['Verified Crew B (Test)']);
  });

  await check('android: an individual link (IU crew) has no attendance step and completes for the one person', async () => {
    const db = await freshDb();
    const r = await issue(db, { job: J.iu, name: 'Dakota Crew (Test)', phone: '3175550103' });
    const p = await open(db, 'android', await tokenOf(db, r.assignment_id));
    await readToEnd(p); await tap(p, '#tbtToComplete'); await p.waitForTimeout(150);
    assert.equal(await p.$('[data-tbt-att]'), null);
    assert.ok(await p.$('#tbtSubmit'), 'Submit My Completion');
    if (await p.$('#tbtAck')) await p.check('#tbtAck');
    await tap(p, '#tbtSubmit');
    await p.waitForFunction(() => !document.getElementById('tbtSubmit'), null, { timeout: 8000 });
    const a = await row(db, r.assignment_id);
    assert.ok(a.submitted_at); assert.equal(a.attendees, null);
    await p.done();
  });

  await check('android: an expired link says it is not available and records nothing', async () => {
    const db = await freshDb();
    const r = await issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', email: 'rob@example.invalid' });
    await db.query(`update cs_tbt_assignments set expires_at = now() - interval '1 minute' where id = $1`, [r.assignment_id]);
    const p = await open(db, 'android', await tokenOf(db, r.assignment_id));
    assert.match(await p.locator('#root').innerText(), /This link is not available/);
    assert.equal((await db.query('select opened_at from cs_tbt_assignments')).rows[0].opened_at, null);
    await p.done();
  });

  await check('android, Choice (Alex’s case): a supervisor link reaches the crew list after the last page; Select All and Submit store it', async () => {
    const db = await freshDb();
    for (let i = 1; i <= 11; i++) await db.query(`insert into cs_workers (company_id, name, job_id, active) values ($1, $2, $3, true)`, [CHOICE, `Choice Crew ${String(i).padStart(2, '0')} (Test)`, J.choice]);
    const r = (await db.query(`select * from cs_tbt_issue_email($1, 'choice-hot-work-talk1', 'Hot Work Talk 1: General Awareness and Tips', 'Alex Super (Test)', 'alex@example.invalid', '2026-10-26'::date, false, 'https://example.invalid/toolbox.html', now() + interval '1 hour')`, [CHOICE])).rows[0];
    await db.query(`update cs_tbt_assignments set role = 'leader', roster_job_id = $2 where id = $1`, [r.assignment_id, J.choice]);
    const p = await open(db, 'android', r.link_url.split('#')[1]);
    assert.equal(await p.$eval('#tbtToComplete', (b) => b.disabled), true, 'attendance is reached only after the last page');
    await readToEnd(p); await tap(p, '#tbtToComplete'); await p.waitForTimeout(150);
    assert.equal((await roster(p)).length, 12);
    await tap(p, '#tbtAll'); await p.check('#tbtPresented'); await tap(p, '#tbtSubmitGroup');
    await p.waitForFunction(() => !document.getElementById('tbtSubmitGroup'), null, { timeout: 8000 });
    assert.equal((await row(db, r.assignment_id)).attendees.length, 12);
    await p.done();
  });

  await check('Nothing left the machine', async () => { assert.deepEqual(offMachine, []); });
} finally {
  await cr.close(); await wk.close(); server.close();
}
console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
