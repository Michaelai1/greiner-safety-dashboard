/* Office dashboard, Toolbox Talks -> "Talk Library" subsection, in a real browser (WebKit), production mode
 * (no ?demo=1). Every RPC and the document store are answered inside this test with made-up talks; nothing
 * leaves the machine.
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
  console.log('Talk Library office verification skipped (set PLAYWRIGHT_NODE_MODULES).');
  process.exit(0);
}
const SHOTS = process.env.SCREENSHOT_DIR || null;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }); };

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'office.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise((r) => server.listen(Number(process.env.PORT || 0), '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const JOB = { id: 'job-purdue', name: 'Purdue Academic Bldg.', job_number: 'C800-2025', status: 'active' };
const TEXTS = [
  { id: 'a-done', talk_title: 'Fall Protection', recipient_name: 'Foreman Two (Test)', phone_last4: '0003',
    role: 'leader', crew_job_id: 'job-purdue', is_test: false, send_status: 'sent',
    send_at: '2026-11-23T11:00:00Z', sent_at: '2026-11-23T11:00:00Z', opened_at: '2026-11-23T11:05:00Z',
    submitted_at: '2026-11-23T11:20:00Z', presenter: 'Foreman Two (Test)', format_used: 'guided', active_ms: 600000,
    attendees: ['Crew Alpha (Test)', 'Crew Bravo (Test)'], manual_attendees: [] },
];
let libraryOn = true, storeReturnsId = true;
let seq = 0;
const docs = [];
const LIB = [
  { id: 'l-fall', title: 'Fall Protection', category: 'Fall Protection', status: 'ready',
    doc_id: 'd-fall', filename: 'Fall Protection.pdf', size_bytes: 180000, created_at: '2026-11-20T15:00:00Z',
    times_sent: 2, last_week: '2026-11-23' },
  { id: 'l-holes', title: 'Fall Protection - Hole Covers', category: 'Fall Protection', status: 'received',
    doc_id: 'd-holes', filename: 'Fall Protection- Hole Covers.pdf', size_bytes: 150000, created_at: '2026-11-24T15:00:00Z',
    times_sent: 0, last_week: null },
  { id: 'l-step', title: 'Step Ladder Safety', category: 'Ladders', status: 'received',
    doc_id: 'd-step', filename: 'Step_Ladder_Safety.pdf', size_bytes: 220000, created_at: '2026-11-24T15:05:00Z',
    times_sent: 0, last_week: null },
];
const calls = [], offMachine = [], edge = [], adds = [], sets = [];
function rpc(fn, body) {
  if (fn === 'cs_portal_bundle') return { company: { name: 'Greiner Brothers' }, jobs: [JOB],
    docs: docs.map((d, i) => ({ id: d.id, category: 'Toolbox Talks', filename: d.filename, size_bytes: d.size,
      created_at: '2026-11-25T18:00:' + String(i).padStart(2, '0') + 'Z' })) };
  if (fn === 'cs_portal_tbt_texts') return TEXTS;
  if (fn === 'cs_portal_config') return null;
  if (fn === 'cs_portal_findings') return {};
  if (fn === 'cs_portal_tbt_library') return LIB.filter((r) => !r.archived);
  if (fn === 'cs_portal_tbt_library_add') {
    adds.push(body);
    const d = docs.find((x) => x.id === body.p_doc_id);
    if (!d) return { ok: false, error: 'bad_doc' };
    const id = 'l-new' + (++seq);
    LIB.push({ id, title: body.p_title, category: body.p_category, status: 'received',
      doc_id: d.id, filename: d.filename, size_bytes: d.size, created_at: '2026-11-25T18:00:00Z', times_sent: 0, last_week: null });
    return { ok: true, id };
  }
  if (fn === 'cs_portal_tbt_library_set') {
    sets.push(body);
    const r = LIB.find((x) => x.id === body.p_id); if (!r) return { ok: false, error: 'not_found' };
    if (body.p_title) r.title = body.p_title;
    if (body.p_category) r.category = body.p_category;
    if (body.p_archived) r.archived = true;
    return { ok: true };
  }
  return [];
}
/* The only server calls this page may make while the library is used (the first two are the read-only
   refresh the office does after any save). Anything that issues, schedules,
   releases or sends a talk would show up here as an unexpected name. */
const ALLOWED = new Set(['cs_portal_field_inspections', 'cs_portal_incidents', 'cs_portal_bundle', 'cs_portal_tbt_texts', 'cs_portal_config', 'cs_portal_findings',
  'cs_portal_tbt_library', 'cs_portal_tbt_library_add', 'cs_portal_tbt_library_set']);

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}
const pdf = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 sample talk ' + name) });

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    localStorage.setItem('cs_session_greiner', JSON.stringify({
      session: 'fake-session-for-test', user: 'Office (Test)', expires_at: '2099-01-01T00:00:00Z' }));
  });
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    const m = u.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
    if (m) {
      calls.push(m[1]);
      let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch {}
      if (!libraryOn && /^cs_portal_tbt_library/.test(m[1])) {
        return r.fulfill({ status: 404, contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.' + m[1] }) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rpc(m[1], body)) });
    }
    if (/\/functions\/v1\/company-docs$/.test(u)) {
      const b = JSON.parse(r.request().postData() || '{}');
      edge.push({ action: b.action, filename: b.filename, category: b.category, mime: b.mime, hasData: !!b.data_base64, id: b.id });
      if (b.action === 'upload') {
        const d = { id: 'd-new' + (docs.length + 1), filename: b.filename, size: (b.data_base64 || '').length };
        docs.push(d);
        return r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, doc: storeReturnsId ? { id: d.id } : { ok: true } }) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: BASE + 'README.md', filename: 'x.pdf' }) });
    }
    offMachine.push(u); return r.abort();
  });
  await page.goto(BASE + 'office.html#talks');
  await page.waitForSelector('[data-tbtx]', { timeout: 8000 });
  const text = () => page.evaluate(() => document.querySelector('#main').innerText);

  await check('the Toolbox Talks tab opens on the Log as before, with the texted talk in it', async () => {
    const t = await text();
    assert.match(t, /Sent by text/); assert.match(t, /Foreman Two \(Test\)/);
    assert.ok(!calls.includes('cs_portal_tbt_library'), 'library is not loaded until its subsection is opened');
  });
  await check('a fourth subsection, Talk Library, sits beside Log, Awaiting Submission and Archive', async () => {
    const tabs = await page.$$eval('.subtabs button', (b) => b.map((x) => x.innerText.trim()));
    assert.deepEqual(tabs, ['Log', 'Awaiting Submission', 'Archive', 'Talk Library']);
  });
  await page.click('[data-tt="library"]');
  await page.waitForSelector('[data-tlib]');
  await check('the library lists every talk with its category and status, and no "For which company" column', async () => {
    assert.equal((await page.$$('[data-tlib]')).length, 3);
    const r = await page.$eval('[data-tlib="l-fall"]', (e) => e.innerText);
    assert.match(r, /Fall Protection/); assert.match(r, /Ready for foremen/); assert.match(r, /Nov 23/);
    const s = await page.$eval('[data-tlib="l-step"]', (e) => e.innerText);
    assert.match(s, /Ladders/); assert.match(s, /phone version being prepared/); assert.match(s, /Not sent yet/);
    const heads = await page.$$eval('#main table th', (h) => h.map((x) => x.innerText.trim().toLowerCase()));
    assert.ok(!heads.includes('for'), heads.join('|'));
    assert.equal(await page.$('#tlib-co'), null, 'no company filter');
    assert.ok(!/Choice Mechanical|Peine Engineering/.test(await page.$eval('#main table', (e) => e.innerText)));
  });
  await check('an "Other companies" line links to Peine\'s own office page and says where Choice talks go', async () => {
    const line = await page.$eval('#tlib-other', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    assert.match(line, /^Other companies/);
    const a = await page.$eval('[data-tlother="Peine Engineering"]', (e) => ({ tag: e.tagName, href: e.href, target: e.target, rel: e.rel, t: e.innerText }));
    assert.deepEqual([a.tag, a.href, a.target, a.rel], ['A', 'https://peine.confirmsafety.com/office/', '_blank', 'noopener']);
    assert.match(a.t, /Peine Engineering office page/);
    const c = await page.$eval('[data-tlother="Choice"]', (e) => ({ tag: e.tagName, t: e.innerText }));
    assert.equal(c.tag, 'SPAN', 'Choice has no office page yet, so it is not a link');
    assert.match(c.t, /no office page yet, send Choice talks to ConfirmSafety/);
  });
  await check('category buttons show a count each and filter the list', async () => {
    const cats = await page.$$eval('[data-tlcat]', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(cats, ['All categories3', 'Fall Protection2', 'Ladders1']);
    await page.click('[data-tlcat="Ladders"]');
    assert.deepEqual(await page.$$eval('[data-tlib]', (r) => r.map((x) => x.dataset.tlib)), ['l-step']);
    await page.click('[data-tlcat=""]');
  });
  await shot(page, 'talk-library-list.png');
  await check('search narrows the list by name', async () => {
    await page.fill('#tlib-q', 'step');
    await page.waitForFunction(() => document.querySelectorAll('[data-tlib]').length === 1);
    assert.deepEqual(await page.$$eval('[data-tlib]', (r) => r.map((x) => x.dataset.tlib)), ['l-step']);
    await page.fill('#tlib-q', '');
    await page.waitForFunction(() => document.querySelectorAll('[data-tlib]').length === 3);
  });

  await page.click('#tlib-upload');
  await page.waitForSelector('#tlu-file');
  await check('Upload has no company tick boxes, says the talk is Greiner\'s, and refuses a talk with no file or no category', async () => {
    assert.equal((await page.$$('[data-tlco]')).length, 0, 'no company tick boxes');
    assert.match(await page.$eval('#tl-own', (e) => e.innerText), /for Greiner Brothers only.*Peine.*Choice/s);
    await page.click('#tlu-save');
    assert.match(await page.$eval('#tlu-err', (e) => e.innerText), /Choose a file/);
    await page.setInputFiles('#tlu-file', [pdf('Ladder_Inspection.pdf')]);
    assert.equal(await page.$eval('#tlu-title', (e) => e.value), 'Ladder Inspection');
    await page.click('#tlu-save');
    assert.match(await page.$eval('#tlu-err', (e) => e.innerText), /Choose a category/);
    assert.equal(edge.length, 0); assert.equal(adds.length, 0);
  });
  await check('one talk: upload once, category Ladders, filed as Greiner\'s', async () => {
    await page.selectOption('#tlu-cat', 'Ladders');
    await shot(page, 'talk-library-upload-drawer.png');
    await page.click('#tlu-save');
    await page.waitForSelector('[data-tlib="l-new1"]');
    assert.equal(edge.length, 1, 'the file is stored once');
    assert.deepEqual(edge[0], { action: 'upload', filename: 'Ladder_Inspection.pdf', category: 'Toolbox Talks',
      mime: 'application/pdf', hasData: true, id: undefined });
    assert.equal(adds.length, 1);
    assert.equal(adds[0].p_doc_id, 'd-new1'); assert.equal(adds[0].p_title, 'Ladder Inspection');
    assert.equal(adds[0].p_category, 'Ladders'); assert.ok(!('p_companies' in adds[0]), 'no company list is sent');
    assert.equal(adds[0].p_token, 'fake-session-for-test');
    const r = await page.$eval('[data-tlib="l-new1"]', (e) => e.innerText);
    assert.match(r, /Ladder Inspection/); assert.match(r, /phone version being prepared/);
    assert.equal(await page.$('.drawer'), null, 'the drawer closes when it is saved');
  });
  await check('many talks at once into a new category', async () => {
    await page.click('#tlib-upload'); await page.waitForSelector('#tlu-file');
    await page.setInputFiles('#tlu-file', [pdf('Arc Welding Safety.pdf'), pdf('Hot Work - Fire Watch.pdf'), pdf('Cutting_Torch_Safety.pdf')]);
    assert.match(await page.$eval('#tlu-save', (e) => e.innerText), /Upload 3 talks/);
    assert.equal((await page.$$('#tlu-list li')).length, 3);
    await page.selectOption('#tlu-cat', '__new'); await page.fill('#tlu-cat-new', 'Welding and Cutting');
    await page.click('#tlu-save');
    await page.waitForSelector('[data-tlib="l-new4"]');
    assert.equal(edge.filter((e) => e.action === 'upload').length, 4);
    assert.equal(adds.length, 4);
    for (const a of adds.slice(1)) {
      assert.equal(a.p_category, 'Welding and Cutting'); assert.ok(!('p_companies' in a));
    }
    assert.deepEqual(adds.slice(1).map((a) => a.p_title), ['Arc Welding Safety', 'Hot Work - Fire Watch', 'Cutting Torch Safety']);
    const cats = await page.$$eval('[data-tlcat]', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    assert.ok(cats.includes('Welding and Cutting3'), cats.join(' | '));
    assert.match(await text(), /7 talks in 3 categories/);
  });
  await shot(page, 'talk-library-after-upload.png');
  await check('a talk can be renamed or moved to another category, or removed (no company tick boxes)', async () => {
    await page.click('[data-tlib="l-holes"]'); await page.waitForSelector('#tle-save');
    assert.equal((await page.$$('[data-tlco]')).length, 0);
    await page.selectOption('#tle-cat', 'Housekeeping');
    await shot(page, 'talk-library-edit-drawer.png');
    await page.click('#tle-save');
    await page.waitForFunction(() => /Housekeeping/.test((document.querySelector('[data-tlib="l-holes"]') || {}).innerText || ''));
    assert.ok(!('p_companies' in sets[0])); assert.equal(sets[0].p_category, 'Housekeeping');
    await page.click('[data-tlib="l-new1"]'); await page.waitForSelector('#tle-remove');
    await page.click('#tle-remove');
    await page.waitForFunction(() => !document.querySelector('[data-tlib="l-new1"]'));
    assert.equal(sets[1].p_archived, true);
    assert.equal((await page.$$('[data-tlib]')).length, 6);
  });
  await check('if the document store does not hand back the file id, the talk is still filed against the right file', async () => {
    storeReturnsId = false;
    await page.click('#tlib-upload'); await page.waitForSelector('#tlu-file');
    await page.setInputFiles('#tlu-file', [pdf('Extension Cord Safety.pdf')]);
    await page.selectOption('#tlu-cat', 'Electrical');
    await page.click('#tlu-save');
    await page.waitForSelector('[data-tlib="l-new5"]');
    const a = adds[adds.length - 1];
    assert.equal(a.p_doc_id, docs[docs.length - 1].id); assert.equal(a.p_title, 'Extension Cord Safety');
    storeReturnsId = true;
    await page.click('[data-tlib="l-new5"]'); await page.waitForSelector('#tle-remove'); await page.click('#tle-remove');
    await page.waitForFunction(() => !document.querySelector('[data-tlib="l-new5"]'));
  });
  await check('Open file asks the private document store for that talk\'s file', async () => {
    const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('[data-tlopen="d-step"]')]);
    await pop.close();
    assert.deepEqual(edge[edge.length - 1], { action: 'url', filename: undefined, category: undefined, mime: undefined, hasData: false, id: 'd-step' });
  });
  await check('the Log is unchanged after using the library', async () => {
    await page.click('[data-tt="log"]'); await page.waitForSelector('[data-tbtx]');
    const t = await text();
    assert.match(t, /Sent by text/); assert.match(t, /Foreman Two \(Test\)/); assert.match(t, /total attendance/i);
    await page.click('[data-tt="library"]'); await page.waitForSelector('[data-tlib]');
  });
  await check('fits a phone-width window without sideways scroll', async () => {
    await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(200);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(o <= 1, 'overflow ' + o);
    await shot(page, 'talk-library-phone-width.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('nothing was issued, scheduled or sent: only the expected server calls were made', async () => {
    const odd = calls.filter((c) => !ALLOWED.has(c));
    assert.equal([...new Set(odd)].join(','), '');
  });
  await check('before the SQL is installed the subsection says so plainly and the Log still works', async () => {
    libraryOn = false;
    await page.reload(); await page.waitForSelector('[data-tbtx]', { timeout: 6000 }).catch(async (e) => { throw new Error('after reload: ' + location + ' ' + (await page.evaluate(() => location.href + ' | ' + document.body.innerText.slice(0, 300).replace(/\n/g, ' / ')))); });
    await page.click('[data-tt="library"]'); await page.waitForSelector('#tlib-off');
    const t = await text();
    assert.match(t, /could not be opened/); assert.match(t, /scheduled talks are not affected/);
    assert.equal(await page.$('#tlib-upload'), null);
    const n = calls.filter((c) => c === 'cs_portal_tbt_library').length;
    await page.waitForTimeout(600);
    assert.equal(calls.filter((c) => c === 'cs_portal_tbt_library').length, n, 'a failed load is not retried in a loop');
    await shot(page, 'talk-library-not-installed.png');
    await page.click('[data-tt="log"]'); await page.waitForSelector('[data-tbtx]');
    assert.match(await text(), /Sent by text/);
  });
  await check('no page errors; nothing left the machine', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(offMachine, []);
  });
} finally { await browser.close(); server.close(); }
if (failures) { console.log(`Talk Library office verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`Talk Library office verification passed (${checks} checks, nothing sent or recorded).`);
