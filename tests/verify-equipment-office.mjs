/* Equipment tab and the IU job in the office dashboard, in a real browser
 * (WebKit), against the demo fixtures (?demo=1). Every request that would leave
 * the machine is blocked and recorded.
 *
 * The IU job and its six field users are added to the demo fixtures by this test
 * only (fake "(Test)" names, no phone numbers) to show what the dashboard looks
 * like after provisioning. IU_NAMES_FILE may point at the git-ignored
 * provisioning/iu-c799-2025.local.json to use the real names for screenshots;
 * only names are read from it.
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
  console.log('Equipment office verification skipped (set PLAYWRIGHT_NODE_MODULES).');
  process.exit(0);
}
const SHOTS = process.env.SCREENSHOT_DIR || null;
const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'provisioning/iu-c799-2025.local.example.json'), 'utf8'));
const IU_NAMES = (process.env.IU_NAMES_FILE
  ? JSON.parse(fs.readFileSync(process.env.IU_NAMES_FILE, 'utf8')).people : example.people).map((p) => p.name);

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

const offMachine = [];
let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n       ')}`); }
}

/* The IU job as it will look after provisioning: active, exact identity, six
   field logins with the comparable job's forms, and nothing else. */
function injectIu(names) {
  let d;
  Object.defineProperty(window, 'DEMO', { configurable: true, get() { return d; }, set(v) {
    d = v;
    if (!v || !Array.isArray(v.jobs) || v.jobs.some((j) => j.id === 'iu-c799')) return;
    v.jobs.push({ id: 'iu-c799', job_number: 'C799-2025', name: 'IU Health Plaza G Med. Gas', status: 'active', company: 'greiner',
      address: '1330 N Senate Ave, Indianapolis, IN 46202', gc_name: 'Wilhelm Gilbane', pm_name: 'Project manager (test)',
      foreman_name: names[0] });
    names.forEach((n, i) => v.fieldUsers.push({ id: 'iu-user-' + i, name: n, job_id: 'iu-c799',
      title: i ? 'Field — IU Health Plaza G' : 'Lead Foreman — IU Health Plaza G', form_keys: ['jha', 'hotwork', 'aerial', 'forklift'] }));
  } });
}

const browser = await webkit.launch();
async function open(hash, { width = 1440, iu = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    offMachine.push(u); return r.abort();
  });
  if (iu) await page.addInitScript(injectIu, IU_NAMES);
  await page.goto(BASE + 'office.html?demo=1' + hash);
  await page.waitForSelector('#main .pg-hd', { timeout: 8000 });
  await page.waitForTimeout(300);
  return page;
}
const nav = (page, id) => page.evaluate((x) => document.querySelector(`#nav a[href="#${x}"]`).click(), id);
const rowsIds = (page) => page.$$eval('[data-eq]', (r) => r.map((x) => x.querySelector('.t-main').textContent));
const drawer = (page) => page.locator('.drawer').last().innerText();
const select = async (page, sel, value) => { await page.selectOption(sel, value); await page.waitForTimeout(80); };
async function shot(page, name, full = false) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
}
async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(o.sw <= o.cw + 1, `${label}: page scrolls sideways (${o.sw} > ${o.cw})`);
}
async function openUnit(page, id) {
  await page.click(`[data-eq] >> text="${id}"`);
  await page.waitForSelector('.drawer #eq-hist ul, .drawer #eq-hist .small', { timeout: 4000 });
  await page.waitForTimeout(120);
}

try {
  const page = await open('#equipment');

  await check('Inventory loads the real cs_equipment shape: in-service units, no “—” rows', async () => {
    const ids = await rowsIds(page);
    assert.deepEqual(ids, ['DEMO-BL-45-01', 'DEMO-FL-05', 'DEMO-FL-11', 'DEMO-LAD-101', 'DEMO-LAD-120', 'DEMO-LAD-204',
      'DEMO-LAD-317', 'DEMO-SL-1930-01', 'DEMO-SL-1930-02', 'DEMO-SL-1930-03']);
    const head = await page.$$eval('#main thead th', (t) => t.map((x) => x.textContent));
    assert.deepEqual(head, ['Unit ID', 'Type', 'Status', 'Job', 'Last inspection', 'Do Not Use']);
    const sum = await page.innerText('.eq-sum');
    assert.match(sum, /10\s*In service/i); assert.match(sum, /1\s*Do Not Use/i); assert.match(sum, /1\s*Unassigned/i); assert.match(sum, /1\s*Archived/i);
    const lad = await page.innerText('[data-eq="demo-eq-9"]');
    assert.ok(lad.includes('Do Not Use') && lad.includes('Demo Job B'), 'a Do Not Use ladder is visibly unsafe');
    const sl = await page.innerText('[data-eq="demo-eq-1"]');
    assert.ok(sl.includes('Alex Rivera (Demo)'), 'lift last inspection comes from the field submissions naming the unit');
    assert.ok(sl.includes('Genie GS-1930 · Demo'), 'make, model and source line from main is kept');
    assert.ok((await page.innerText('[data-eq="demo-eq-10"]')).includes('Unassigned'));
    assert.equal(await page.innerText('#nav a[href="#equipment"] .badge'), '1', 'the nav badge counts Do Not Use units');
    await shot(page, '03-equipment-inventory');
  });

  await check('Search and filters: ID, type, job, unassigned, status', async () => {
    await page.fill('#eq-q', 'lad-2'); await page.waitForTimeout(80);
    assert.deepEqual(await rowsIds(page), ['DEMO-LAD-204']);
    await page.fill('#eq-q', ''); await page.waitForTimeout(80);
    await select(page, '#eq-type', 'Forklift');
    assert.deepEqual(await rowsIds(page), ['DEMO-FL-05', 'DEMO-FL-11']);
    await select(page, '#eq-type', '');
    await select(page, '#eq-job', '__none');
    assert.deepEqual(await rowsIds(page), ['DEMO-LAD-120'], 'unassigned filter');
    await select(page, '#eq-job', 'demo-job-a');
    assert.deepEqual(await rowsIds(page), ['DEMO-LAD-101', 'DEMO-LAD-204', 'DEMO-SL-1930-01', 'DEMO-SL-1930-02']);
    await select(page, '#eq-job', '');
    await select(page, '#eq-status', 'archived');
    assert.deepEqual(await rowsIds(page), ['DEMO-SL-1930-04']);
    await select(page, '#eq-status', 'dnu');
    assert.deepEqual(await rowsIds(page), ['DEMO-LAD-317']);
    await select(page, '#eq-status', 'service');
  });

  await check('Add equipment: required fields, duplicate IDs refused, success recorded in history', async () => {
    await page.click('#eq-add');
    await shot(page, '04-add-equipment');
    await page.click('#eqf-save');
    assert.equal(await page.innerText('#eqf-err'), 'Enter a unit ID.');
    await page.fill('#eqf-unit_number', '  demo-lad-101 ');
    await page.fill('#eqf-equipment_type', 'Ladder');
    await page.click('#eqf-save');
    assert.match(await page.innerText('#eqf-err'), /already used by another unit/);
    const before = await page.evaluate(() => window.DEMO.equipment.length);
    await page.fill('#eqf-unit_number', 'DEMO-LAD-555');
    await page.fill('#eqf-description', '12 ft step ladder (demo)');
    await page.click('#eqf-save');
    await page.waitForSelector('.drawer .eq-ok');
    const d = await drawer(page);
    assert.ok(d.includes('Added DEMO-LAD-555.') && d.includes('Category') && d.includes('Ladder') && d.includes('Unassigned'));
    assert.ok(d.includes('Added') && d.includes('Demo Office'), 'history shows who added it');
    assert.equal(await page.evaluate(() => window.DEMO.equipment.length), before + 1);
    assert.ok((await rowsIds(page)).includes('DEMO-LAD-555'), 'inventory refreshed');
  });

  await check('Edit safe details; renaming onto an existing ID is refused', async () => {
    await page.click('#eq-edit');
    await page.fill('#eqf-description', '12 ft fiberglass step ladder (demo)');
    await page.fill('#eqf-serial', 'SN-DEMO-1');
    await page.click('#eqf-save');
    await page.waitForSelector('.drawer .eq-ok');
    const d = await drawer(page);
    assert.ok(d.includes('Details saved.') && d.includes('SN-DEMO-1') && d.includes('Details edited'));
    await page.click('#eq-edit');
    await page.fill('#eqf-unit_number', 'DEMO-LAD-204');
    await page.click('#eqf-save');
    assert.match(await page.innerText('#eqf-err'), /already used by another unit/);
    await page.click('.drawer .x');
  });

  await check('Assign, move and remove use the one write path; history keeps every move', async () => {
    await openUnit(page, 'DEMO-LAD-555');
    await select(page, '#eq-asg', 'demo-job-a');
    await page.click('#eq-asg-save'); await page.waitForSelector('.drawer .eq-ok');
    assert.ok((await drawer(page)).includes('Assigned to Demo Job A'));
    await select(page, '#eq-asg', 'demo-job-b');
    await page.click('#eq-asg-save'); await page.waitForSelector('.drawer .eq-ok >> text=/Moved/');
    await select(page, '#eq-asg', '');
    await page.click('#eq-asg-save'); await page.waitForSelector('.drawer .eq-ok >> text=/Removed/');
    const kinds = await page.$$eval('.eq-hist li b', (b) => b.map((x) => x.textContent));
    assert.deepEqual(kinds.slice(0, 3), ['Removed from job', 'Moved', 'Assigned']);
    const unit = await page.evaluate(() => window.DEMO.equipment.find((e) => e.unit_number === 'DEMO-LAD-555'));
    assert.equal(unit.job_id, null);
    await page.click('.drawer .x');
  });

  await check('Equipment tab and Planner show the same assignment (one source of truth)', async () => {
    await openUnit(page, 'DEMO-LAD-120');
    await select(page, '#eq-asg', 'demo-job-c');
    await page.click('#eq-asg-save'); await page.waitForSelector('.drawer .eq-ok');
    await page.click('.drawer .x');
    await nav(page, 'assign');
    await page.waitForTimeout(150);
    await page.click('[data-atab="equipment"]');
    const jobC = await page.innerText('[data-drop="demo-job-c"]');
    assert.ok(jobC.includes('DEMO-LAD-120'), 'Planner shows the unit on the job the Equipment tab chose');
    // and back: remove it on the Planner, the Equipment tab agrees
    await page.click('[data-drop="demo-job-c"] [data-rm="e"]');
    await page.waitForTimeout(150);
    await nav(page, 'equipment');
    await page.waitForTimeout(150);
    assert.ok((await page.innerText('[data-eq="demo-eq-10"]')).includes('Unassigned'));
    assert.ok(!(await page.innerText('#main')).includes('DEMO-SL-1930-04'), 'archived units are not in service');
  });

  await check('Archive takes a unit off its job without deleting it; restore brings it back unassigned', async () => {
    await openUnit(page, 'DEMO-SL-1930-03');
    await page.click('#eq-archive');
    assert.match(await page.innerText('#eq-manage'), /Nothing is deleted/);
    await page.click('#eq-archive-yes'); await page.waitForSelector('.drawer .eq-ok');
    let d = await drawer(page);
    assert.ok(d.includes('Archived') && !d.includes('Save assignment'), 'archived units cannot be assigned');
    const u = await page.evaluate(() => window.DEMO.equipment.find((e) => e.unit_number === 'DEMO-SL-1930-03'));
    assert.ok(u.archived_at && u.active === false && u.job_id === null);
    await page.click('.drawer .x');
    assert.ok(!(await rowsIds(page)).includes('DEMO-SL-1930-03'));
    await nav(page, 'assign'); await page.waitForTimeout(120); await page.click('[data-atab="equipment"]');
    assert.ok(!(await page.innerText('#main')).includes('DEMO-SL-1930-03'), 'archived units leave the Planner');
    await nav(page, 'equipment'); await page.waitForTimeout(120);
    await select(page, '#eq-status', 'archived');
    await openUnit(page, 'DEMO-SL-1930-03');
    await page.click('#eq-restore'); await page.waitForSelector('.drawer .eq-ok');
    d = await drawer(page);
    assert.ok(d.includes('Restored to service, unassigned.'));
    const kinds = await page.$$eval('.eq-hist li b', (b) => b.map((x) => x.textContent));
    assert.deepEqual(kinds.slice(0, 2), ['Restored', 'Archived']);
    await page.click('.drawer .x');
    await select(page, '#eq-status', 'service');
  });

  await check('A Do Not Use ladder says so in its card; the office cannot clear it here', async () => {
    await openUnit(page, 'DEMO-LAD-317');
    const d = await drawer(page);
    assert.ok(d.includes('Do Not Use.') && d.includes('Cracked right side rail') && d.includes('Field users cannot clear a defect'));
    assert.ok(!/resolve|clear defect/i.test(await page.$$eval('.drawer button', (b) => b.map((x) => x.textContent).join(' '))));
    await page.click('.drawer .x');
  });

  await check('Failure and loading states are honest', async () => {
    await page.evaluate(() => {
      const real = window.DEMO.call;
      window.DEMO.call = (fn, body) => fn === 'cs_portal_equipment_set_job' ? Promise.reject(new Error('network down')) : real(fn, body);
    });
    await openUnit(page, 'DEMO-FL-05');
    await select(page, '#eq-asg', '');
    await page.click('#eq-asg-save');
    await page.waitForSelector('#eq-asg-msg.bad');
    assert.equal(await page.innerText('#eq-asg-msg'), 'Not saved — network down.');
    assert.ok((await page.evaluate(() => window.DEMO.equipment.find((e) => e.id === 'demo-eq-5').job_id)) === 'demo-job-b', 'nothing changed');
    await page.click('.drawer .x');
    async function stubbed(hold) {
      const p2 = await browser.newPage({ viewport: { width: 1024, height: 900 } });
      await p2.route('**/*', (r) => r.request().url().startsWith(BASE) ? r.continue() : (offMachine.push(r.request().url()), r.abort()));
      await p2.addInitScript((h) => {
        let d; Object.defineProperty(window, 'DEMO', { configurable: true, get() { return d; }, set(v) {
          d = v; const real = v.call;
          v.call = (fn, body) => fn === 'cs_portal_equipment_inventory'
            ? (h ? new Promise(() => {}) : Promise.reject(new Error('Could not find the function public.cs_portal_equipment_inventory(p_token) in the schema cache')))
            : real(fn, body);
        } });
      }, hold);
      await p2.goto(BASE + 'office.html?demo=1#equipment');
      await p2.waitForTimeout(400);
      return p2;
    }
    const loading = await stubbed(true);
    assert.equal(await loading.innerText('#eq-loading'), 'Loading equipment…');
    await loading.close();
    const p2 = await stubbed(false);
    const t = await p2.innerText('#main');
    assert.ok(t.includes('Read-only.') && t.includes('2026-10-05-equipment-management.sql'), 'missing update is named');
    assert.equal(await p2.$('#eq-add'), null, 'no Add button while read-only');
    assert.ok((await rowsIds(p2)).length > 0, 'the list loaded with the dashboard is still shown');
    await p2.close();
  });

  await check('No horizontal overflow at 390, 820, 1024 and 1440 (inventory and drawer)', async () => {
    for (const w of [390, 820, 1024, 1440]) {
      const p = await open('#equipment', { width: w });
      await noOverflow(p, `inventory ${w}`);
      await openUnit(p, 'DEMO-LAD-101');
      await noOverflow(p, `unit drawer ${w}`);
      await p.click('.drawer .x');
      await p.click('#eq-add');
      await noOverflow(p, `add drawer ${w}`);
      if (w === 390) await shot(p, '04b-add-equipment-390');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  /* ---------------- the IU job after provisioning ---------------- */
  const iu = await open('#jobs', { iu: true });

  await check('IU job: exact identity, active, visible in Jobs and the Planner', async () => {
    const t = await iu.innerText('#main');
    assert.ok(t.includes('IU Health Plaza G Med. Gas') && t.includes('C799-2025'));
    await iu.click('[data-job="iu-c799"]');
    await iu.waitForSelector('#job-fieldaccess [data-permsave]', { timeout: 4000 });
    const d = await iu.innerText('#main');
    assert.ok(d.includes('1330 N Senate Ave, Indianapolis, IN 46202') && d.includes('Wilhelm Gilbane') && d.includes(IU_NAMES[0]));
    await shot(iu, '01-iu-job-overview');
  });

  await check('Six IU field users, once each, with the comparable job’s forms only', async () => {
    const users = await iu.$$eval('#job-fieldaccess [data-permsave]', (b) => b.map((x) => x.dataset.permsave));
    assert.equal(users.length, 6);
    assert.equal(new Set(users).size, 6);
    for (const u of users) {
      const on = await iu.$$eval(`[data-perm="${u}"]`, (c) => c.filter((x) => x.checked).map((x) => x.dataset.key).sort());
      assert.deepEqual(on, ['aerial', 'forklift', 'hotwork', 'jha']);
    }
    const offered = await iu.$$eval(`[data-perm="${users[0]}"]`, (c) => c.map((x) => x.dataset.key));
    assert.ok(!offered.includes('jobsiteanalysis') && !offered.some((k) => /power|powder|ladder/i.test(k)), 'unsupported forms are not offered');
    const panel = await iu.locator('#job-fieldaccess').innerText();
    assert.ok(!/\d{3}-\d{3}-\d{4}/.test(panel), 'no phone numbers on the access panel');
    await iu.locator('#job-fieldaccess').scrollIntoViewIfNeeded();
    await shot(iu, '02-iu-six-user-assignments');
  });

  await check('IU documents: six originals expected, none claimed as uploaded', async () => {
    const p = await iu.innerText('[data-doc-onboarding="C799-2025"]');
    assert.ok(p.includes('0 of 6 originals uploaded') && p.includes('None has been uploaded yet'));
    assert.equal((p.match(/Waiting for the original file/g) || []).length, 6);
  });

  await check('IU honest empty states: equipment, JHA history, toolbox, documents', async () => {
    await nav(iu, 'equipment'); await iu.waitForTimeout(250);
    await select(iu, '#eq-job', 'iu-c799');
    assert.ok((await iu.innerText('#main')).includes('No equipment is assigned to IU Health Plaza G Med. Gas yet.'));
    await shot(iu, '09a-iu-empty-equipment');
    await nav(iu, 'docs'); await iu.waitForTimeout(200);
    assert.ok((await iu.innerText('#main')).includes('0 of 6 originals uploaded'));
    await shot(iu, '09b-iu-documents-onboarding');
    await nav(iu, 'obs'); await iu.waitForTimeout(250);
    await iu.locator('button, a').filter({ hasText: /^JHA Review$/ }).first().click();
    await iu.waitForSelector('#jha-job');
    await select(iu, '#jha-job', 'iu-c799');
    const j = await iu.innerText('#main');
    assert.ok(!j.includes('Demo Job A'), 'no other job’s JHAs under IU');
    await shot(iu, '09c-iu-empty-jha-history');
  });

  await check('Assign a ladder to IU, then remove it; IU history and other jobs untouched', async () => {
    await nav(iu, 'equipment'); await iu.waitForTimeout(250);
    await select(iu, '#eq-job', '');
    const others = await iu.evaluate(() => JSON.stringify(window.DEMO.equipment.filter((e) => e.id !== 'demo-eq-10').map((e) => [e.id, e.job_id])));
    const users = await iu.evaluate(() => JSON.stringify(window.DEMO.fieldUsers));
    await openUnit(iu, 'DEMO-LAD-120');
    await select(iu, '#eq-asg', 'iu-c799');
    await iu.click('#eq-asg-save'); await iu.waitForSelector('.drawer .eq-ok');
    assert.ok((await drawer(iu)).includes('Assigned to IU Health Plaza G Med. Gas.'));
    await shot(iu, '05-assign-to-iu');
    await iu.click('.drawer .x');
    await select(iu, '#eq-job', 'iu-c799');
    assert.deepEqual(await rowsIds(iu), ['DEMO-LAD-120']);
    await openUnit(iu, 'DEMO-LAD-120');
    await select(iu, '#eq-asg', '');
    await iu.click('#eq-asg-save'); await iu.waitForSelector('.drawer .eq-ok');
    assert.ok((await drawer(iu)).includes('Removed from IU Health Plaza G Med. Gas.'));
    await shot(iu, '06-remove-from-iu');
    await iu.click('.drawer .x');
    assert.ok((await iu.innerText('#main')).includes('No equipment is assigned to IU Health Plaza G Med. Gas yet.'));
    const after = await iu.evaluate(() => JSON.stringify(window.DEMO.equipment.filter((e) => e.id !== 'demo-eq-10').map((e) => [e.id, e.job_id])));
    assert.equal(after, others, 'no other unit moved');
    assert.equal(await iu.evaluate(() => JSON.stringify(window.DEMO.fieldUsers)), users, 'no employee changed');
    const hist = await iu.evaluate(() => window.DEMO.equipmentEvents.filter((e) => e.equipment_id === 'demo-eq-10').map((e) => e.kind));
    assert.deepEqual(hist.slice(-2), ['assigned', 'unassigned'], 'both moves kept in history');
  });

  await check('IU at every width: no overflow, no errors', async () => {
    for (const w of [390, 820, 1024, 1440]) {
      const p = await open('#jobs', { width: w, iu: true });
      await p.click('[data-job="iu-c799"]');
      await p.waitForSelector('#job-fieldaccess [data-permsave]', { timeout: 4000 });
      await noOverflow(p, `IU job ${w}`);
      if (w === 390) await shot(p, '01b-iu-job-overview-390');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('No page errors and no request left the machine', async () => {
    assert.deepEqual(page.errors, []);
    assert.deepEqual(iu.errors, []);
    assert.deepEqual(offMachine, []);
  });
} finally {
  await browser.close();
  server.close();
}

if (failures) { console.log(`Equipment office verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`Equipment office verification passed (${checks} checks, 4 widths, no network).`);
