/* Office dashboard, Toolbox Talks -> "Talk Library" subsection, in a real browser (WebKit), production mode
 * (no ?demo=1). Every RPC and the document store are answered inside this test with made-up talks; nothing
 * leaves the machine. The browser clock is fixed at Thu Nov 26 2026 (Thanksgiving) for the "Coming up" view
 * (called "Weeks ahead" before Nov 27, when the page took the next-version demo's look).
 * Nov 27: Tony uploads for Greiner, Peine and Choice here; a company switcher shows one company at a time.
 * Nov 27 (29fcf9b): no upload form. Upload opens the file picker and files the picked files right away for the
 * company on screen (and that week); the name comes from the file name; category is always 'Toolbox Talk' and
 * is not shown anywhere. Progress and results are toasts.
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
  // Already set up for next week (the weekly send's own records, read only): two people.
  ...['Foreman One (Test)', 'Foreman Three (Test)'].map((n, i) => ({ id: 'a-next' + i, talk_key: 'ladder-safety',
    talk_title: 'Ladder Safety', recipient_name: n, phone_last4: '000' + (5 + i), role: 'leader', crew_job_id: 'job-purdue',
    is_test: false, week_start: '2026-11-30', send_status: 'scheduled', send_at: '2026-11-30T11:00:00Z', sent_at: null,
    opened_at: null, submitted_at: null, attendees: [], manual_attendees: [] })),
  // A test send and a cancelled text: neither counts as that week's talk.
  { id: 'a-test', talk_key: 'hot-work', talk_title: 'Hot Work (Test send)', recipient_name: 'Office Copy (Test)', role: 'participant',
    is_test: true, week_start: '2026-12-07', send_status: 'scheduled', send_at: '2026-12-07T11:00:00Z', attendees: [], manual_attendees: [] },
  { id: 'a-cancel', talk_key: 'ppe', talk_title: 'PPE Basics', recipient_name: 'Foreman Two (Test)', role: 'leader',
    is_test: false, week_start: '2026-12-14', send_status: 'cancelled', send_at: '2026-12-14T11:00:00Z', attendees: [], manual_attendees: [] },
];
TEXTS[0].week_start = '2026-11-23';
const WEEKS = ['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11', '2027-01-18'];
let libraryOn = true, storeReturnsId = true;
let seq = 0;
const docs = [];
const LIB = [
  { id: 'l-fall', title: 'Fall Protection', category: 'Fall Protection', status: 'ready', for_company: 'greiner',
    doc_id: 'd-fall', filename: 'Fall Protection.pdf', size_bytes: 180000, created_at: '2026-11-20T15:00:00Z',
    times_sent: 2, last_week: '2026-11-23' },
  { id: 'l-holes', title: 'Fall Protection - Hole Covers', category: 'Fall Protection', status: 'received',
    doc_id: 'd-holes', filename: 'Fall Protection- Hole Covers.pdf', size_bytes: 150000, created_at: '2026-11-24T15:00:00Z',
    times_sent: 0, last_week: null },
  { id: 'l-step', title: 'Step Ladder Safety', category: 'Ladders', status: 'received',
    doc_id: 'd-step', filename: 'Step_Ladder_Safety.pdf', size_bytes: 220000, created_at: '2026-11-24T15:05:00Z',
    times_sent: 0, last_week: null, planned_week: '2026-12-07', for_company: 'greiner' },
  // l-holes has no for_company at all (an older read): the page treats it as Greiner's.
  // Uploaded by the Greiner office FOR Peine and Choice (Nov 27). Same row owner; only the label differs.
  { id: 'l-peine-cold', title: 'Peine Cold Weather', category: 'Cold Weather', status: 'received', for_company: 'peine',
    doc_id: 'd-pcold', filename: 'Peine Cold Weather.pdf', size_bytes: 90000, created_at: '2026-11-25T15:00:00Z',
    times_sent: 0, last_week: null, planned_week: '2026-12-07' },
  { id: 'l-peine-lift', title: 'Peine Forklift Basics', category: 'Driving and Vehicles', status: 'received', for_company: 'peine',
    doc_id: 'd-plift', filename: 'Peine Forklift Basics.pdf', size_bytes: 80000, created_at: '2026-11-25T15:10:00Z',
    times_sent: 0, last_week: null },
  { id: 'l-choice-trench', title: 'Choice Trench Safety', category: 'Trenching and Excavation', status: 'received', for_company: 'choice',
    doc_id: 'd-ctrench', filename: 'Choice Trench Safety.pdf', size_bytes: 70000, created_at: '2026-11-25T15:20:00Z',
    times_sent: 0, last_week: null, planned_week: '2026-11-30' },
];
const calls = [], offMachine = [], edge = [], adds = [], sets = [], weekAdds = [], weekSets = [];
let edgeDelay = 0;   // ms the fake document store waits before answering an upload (the "still uploading" check)
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
    LIB.push({ id, title: body.p_title, category: body.p_category, status: 'received', for_company: body.p_for || 'greiner',
      doc_id: d.id, filename: d.filename, size_bytes: d.size, created_at: '2026-11-25T18:00:00Z', times_sent: 0, last_week: null });
    return { ok: true, id };
  }
  if (fn === 'cs_portal_tbt_library_add_week') {
    weekAdds.push(body);
    const d = docs.find((x) => x.id === body.p_doc_id);
    if (!d) return { ok: false, error: 'bad_doc' };
    const id = 'l-wk' + (weekAdds.length);
    LIB.push({ id, title: body.p_title, category: body.p_category, status: 'received', planned_week: body.p_week, for_company: body.p_for || 'greiner',
      doc_id: d.id, filename: d.filename, size_bytes: d.size, created_at: '2026-11-26T18:00:00Z', times_sent: 0, last_week: null });
    return { ok: true, id };
  }
  if (fn === 'cs_portal_tbt_library_week') {
    weekSets.push(body);
    const r = LIB.find((x) => x.id === body.p_id); if (!r) return { ok: false, error: 'not_found' };
    r.planned_week = body.p_week; return { ok: true };
  }
  if (fn === 'cs_portal_tbt_library_set') {
    sets.push(body);
    const r = LIB.find((x) => x.id === body.p_id); if (!r) return { ok: false, error: 'not_found' };
    if (body.p_title) r.title = body.p_title;
    if (body.p_category) r.category = body.p_category;
    if (body.p_archived) r.archived = true;
    if (body.p_for) r.for_company = body.p_for;
    return { ok: true };
  }
  return [];
}
/* The only server calls this page may make while the library is used (the first two are the read-only
   refresh the office does after any save). Anything that issues, schedules,
   releases or sends a talk would show up here as an unexpected name. */
const ALLOWED = new Set(['cs_portal_field_inspections', 'cs_portal_incidents', 'cs_portal_bundle', 'cs_portal_tbt_texts', 'cs_portal_config', 'cs_portal_findings',
  'cs_portal_tbt_library', 'cs_portal_tbt_library_add', 'cs_portal_tbt_library_set',
  'cs_portal_tbt_library_add_week', 'cs_portal_tbt_library_week']);

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").slice(0, 3).join(" | ")}`); }
}
const pdf = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 sample talk ' + name) });

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Thanksgiving, 10 AM in Indiana: "this week" is the week of Mon Nov 23.
  await page.clock.setFixedTime(new Date('2026-11-26T15:00:00Z'));
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    // Every toast the page shows, in order (they disappear after a couple of seconds).
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList.contains('toast')) window.__toasts.push(n.textContent); } })
      .observe(document, { childList: true, subtree: true });
    localStorage.setItem('cs_session_greiner', JSON.stringify({
      session: 'fake-session-for-test', user: 'Office (Test)', expires_at: '2099-01-01T00:00:00Z' }));
  });
  await page.route('**/*', async (r) => {
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
      if (b.action === 'upload' && edgeDelay) await new Promise((ok) => setTimeout(ok, edgeDelay));
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
  // Upload: clicking the button opens the OS file picker straight away (no form); picking files uploads them.
  const pick = async (sel, files) => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), page.click(sel)]);
    assert.ok(fc.isMultiple(), 'the picker takes several files at once');
    await fc.setFiles(files);
  };
  const toasts = () => page.evaluate(() => window.__toasts.slice());
  const waitToast = (re) => page.waitForFunction((src) => window.__toasts.some((t) => new RegExp(src).test(t)), re.source, { timeout: 5000 });
  const noDrawer = async () => {
    assert.equal(await page.$('.drawer'), null, 'no drawer is open');
    assert.equal(await page.$('.scrim'), null, 'no scrim is left over');
  };

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
  await page.waitForSelector('[data-tlweekrow]');
  const weekRow = (w) => page.$eval(`[data-tlweekrow="${w}"]`, (e) => e.innerText.replace(/\s+/g, ' ').trim());
  const noSideScroll = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await check('Talk Library opens on "Coming up": this week and the 8 after it, Monday dates', async () => {
    assert.deepEqual(await page.$$eval('[data-tlview]', (b) => b.map((x) => [x.innerText.trim(), x.classList.contains('on')])),
      [['Coming up', true], ['Library', false]]);
    assert.deepEqual(await page.$$eval('[data-tlweeks] th', (h) => h.map((x) => x.innerText.trim().toLowerCase())), ['week', 'talk', '']);
    assert.match(await page.$eval('[data-tlweeks] .panel-hd', (e) => e.innerText.replace(/\s+/g, ' ')),
      /^Coming up for Greiner Brothers This week and the 8 after it\. 2 weeks have a talk set, 7 not picked yet\./);
    assert.deepEqual(await page.$$eval('[data-tlweekrow]', (r) => r.map((x) => x.dataset.tlweekrow)), WEEKS);
    for (const w of WEEKS) assert.equal(new Date(w + 'T12:00:00').getDay(), 1, w + ' is a Monday');
    assert.match(await weekRow('2026-11-23'), /^Week of Mon, Nov 23 This week/);
    assert.match(await weekRow('2026-11-30'), /^Week of Mon, Nov 30 Next week/);
    assert.match(await weekRow('2027-01-18'), /^Week of Mon, Jan 18/);
  });
  await check('says plainly that uploading tells ConfirmSafety which talk to send, and schedules nothing', async () => {
    const t = await page.$eval('#tlib-weeks-note', (e) => e.innerText);
    assert.match(t, /Uploading tells ConfirmSafety which talk to send that week/);
    assert.match(t, /does not schedule or send anything/);
  });
  await check('Thanksgiving (Thu Nov 26 and Fri Nov 27) is noted on this week only, and Monday talks still go', async () => {
    const notes = await page.$$eval('[data-tlnote]', (n) => n.map((x) => [x.closest('[data-tlweekrow]').dataset.tlweekrow, x.innerText]));
    assert.equal(notes.length, 1); assert.equal(notes[0][0], '2026-11-23');
    assert.match(notes[0][1], /Thanksgiving is Thu Nov 26 and Fri Nov 27\. Monday talks still go out\./);
  });
  await check('each week shows the talk already scheduled for it, or "Not picked yet" (tests and cancelled texts left out)', async () => {
    assert.match(await weekRow('2026-11-23'), /This week .*Fall Protection Sent 1 person/i);
    assert.match(await weekRow('2026-11-30'), /Next week Ladder Safety Scheduled 2 people/i);
    assert.match(await weekRow('2026-12-07'), /Dec 7 Not picked yet/i);
    assert.ok(!/Hot Work/.test(await weekRow('2026-12-07')), 'a test send is not a week\'s talk');
    assert.match(await weekRow('2026-12-14'), /Dec 14 Not picked yet/i);
    assert.ok(!/PPE/.test(await weekRow('2026-12-14')), 'a cancelled text is not a week\'s talk');
    assert.equal((await page.$$('[data-tlnone]')).length, 7);
  });
  await check('a talk already uploaded for a week shows under that week; every week has an "Upload" button', async () => {
    assert.match(await weekRow('2026-12-07'), /Not picked yet Uploaded Step Ladder Safety Received Upload$/i);
    assert.ok(!/Ladders/.test(await weekRow('2026-12-07')), 'no category is shown');
    assert.ok(!/Peine/.test(await weekRow('2026-12-07')), 'Peine\'s upload for that week is not in Greiner\'s view');
    assert.ok(!/Uploaded|Choice/i.test(await weekRow('2026-11-30')), 'a week with nothing uploaded for Greiner shows no upload line');
    assert.deepEqual(await page.$$eval('[data-tlweek]', (b) => b.map((x) => x.innerText.trim() + '|' + x.dataset.tlweek)),
      WEEKS.map((w) => 'Upload|' + w));
    assert.equal(await page.$eval('[data-tlweek="2026-12-21"]', (b) => b.getAttribute('aria-label')), 'Upload a talk for the week of Mon, Dec 21');
  });
  await check('the company bar is a switcher: Greiner Brothers (picked), Peine, Choice; no links away', async () => {
    assert.deepEqual(await page.$$eval('[data-tlcompany]', (b) => b.map((x) => [x.innerText.trim(), x.classList.contains('on'), x.getAttribute('aria-pressed')])),
      [['Greiner Brothers', true, 'true'], ['Peine', false, 'false'], ['Choice', false, 'false']]);
    assert.match(await page.$eval('#tlib-co', (e) => e.innerText.replace(/\s+/g, ' ').trim()), /^Company Greiner Brothers Peine Choice$/i);
    assert.equal(await page.$('#tlib-co a'), null, 'no link to another page');
    assert.equal(await page.$('#tlib-other'), null);
    assert.match(await page.$eval('.pg-hd p', (e) => e.innerText), /^Talks for Greiner Brothers, Peine and Choice\./);
  });
  for (const [w, name] of [[1440, 'talk-library-weeks-1440.png'], [1024, 'talk-library-weeks-1024.png'], [390, 'talk-library-weeks-phone.png']]) {
    await check(`"Coming up" fits a ${w}px window without sideways scroll`, async () => {
      await page.setViewportSize({ width: w, height: w === 390 ? 2200 : 1300 }); await page.waitForTimeout(200);
      assert.ok(await noSideScroll() <= 1, 'overflow ' + await noSideScroll());
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('a week\'s "Upload" opens the file picker at once (no form) and files the talk for Greiner and that week', async () => {
    await pick('[data-tlweek="2026-12-21"]', [pdf('Cold_Weather_Safety.pdf')]);
    await page.waitForFunction(() => /Cold Weather Safety/.test((document.querySelector('[data-tlweekrow="2026-12-21"]') || {}).innerText || ''));
    await noDrawer();
    assert.equal(await page.$('#tlu-file'), null, 'the hidden file input is gone after the pick');
    assert.equal(weekAdds.length, 1); assert.equal(adds.length, 0, 'the week upload uses the week filing only');
    assert.deepEqual([weekAdds[0].p_week, weekAdds[0].p_title, weekAdds[0].p_category, weekAdds[0].p_for, weekAdds[0].p_doc_id, weekAdds[0].p_token],
      ['2026-12-21', 'Cold Weather Safety', 'Toolbox Talk', 'greiner', 'd-new1', 'fake-session-for-test']);
    assert.match(await weekRow('2026-12-21'), /Not picked yet Uploaded Cold Weather Safety Received Upload$/i);
    await waitToast(/^Talk added for Greiner Brothers, week of Mon, Dec 21$/);
    assert.ok((await toasts()).includes('Uploading Cold_Weather_Safety.pdf'), (await toasts()).join(' | '));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'talk-library-upload-for-week.png') });
    docs.length = 0; edge.length = 0;   // the later checks count stored files from 1 again
  });
  await check('a talk uploaded for a week can be moved to another week, or its week cleared', async () => {
    const id = LIB[LIB.length - 1].id;
    await page.click(`[data-tlibw="${id}"]`); await page.waitForSelector('#tle-week');
    assert.equal(await page.$eval('#tle-week', (e) => e.value), '2026-12-21');
    await page.selectOption('#tle-week', '2026-12-28'); await page.click('#tle-save');
    await page.waitForFunction(() => /Cold Weather Safety/.test((document.querySelector('[data-tlweekrow="2026-12-28"]') || {}).innerText || ''));
    assert.deepEqual(weekSets.map((x) => [x.p_id, x.p_week]), [[id, '2026-12-28']]);
    assert.ok(!/Cold Weather Safety/.test(await weekRow('2026-12-21')));
    const nSet = sets.length;
    await page.click(`[data-tlibw="${id}"]`); await page.waitForSelector('#tle-week');
    await page.selectOption('#tle-week', ''); await page.click('#tle-save');
    await page.waitForFunction(() => !/Cold Weather Safety/.test(document.querySelector('#tlib-weeks').innerText));
    assert.deepEqual(weekSets[1], { p_token: 'fake-session-for-test', p_id: id, p_week: null });
    // Saving without touching the week does not call the week function.
    await page.click('[data-tlibw="l-step"]'); await page.waitForSelector('#tle-week'); await page.click('#tle-save');
    await page.waitForFunction((n) => document.querySelector('.drawer') === null, nSet);
    assert.equal(weekSets.length, 2);
    // Remove it again through the page, so the older checks below see the three talks they expect.
    await page.click('[data-tlview="all"]'); await page.waitForSelector(`[data-tlib="${id}"]`);
    await page.click(`[data-tlib="${id}"]`); await page.waitForSelector('#tle-remove'); await page.click('#tle-remove');
    await page.waitForFunction((x) => !document.querySelector(`[data-tlib="${x}"]`), id);
    await page.click('[data-tlview="weeks"]'); await page.waitForSelector('[data-tlweekrow]');
    sets.length = 0;
  });
  await page.click('[data-tlview="all"]');
  await page.waitForSelector('[data-tlib]');
  await check('"Library" shows the week a talk was uploaded for under its name', async () => {
    assert.match(await page.$eval('[data-tlib="l-step"]', (e) => e.innerText), /for the week of Mon, Dec 7/i);
  });
  await check('the library lists every talk newest first with its status: Talk | Uploaded | Last sent, no category', async () => {
    assert.deepEqual(await page.$$eval('[data-tlib]', (r) => r.map((x) => x.dataset.tlib)), ['l-step', 'l-holes', 'l-fall']);
    const r = await page.$eval('[data-tlib="l-fall"]', (e) => e.innerText);
    assert.match(r, /Fall Protection/); assert.match(r, /Ready for foremen/); assert.match(r, /Week of Mon, Nov 23/);
    assert.match(r, /Open file\s+Edit/);
    const s = await page.$eval('[data-tlib="l-step"]', (e) => e.innerText);
    assert.match(s, /phone version being prepared/); assert.match(s, /Not sent yet/);
    assert.ok(!/Ladders/.test(s), 'the category is not shown');
    const heads = await page.$$eval('#main table th', (h) => h.map((x) => x.innerText.trim().toLowerCase()));
    assert.deepEqual(heads, ['talk', 'uploaded', 'last sent', '']);
    assert.match(await page.$eval('[data-tllib] .panel-hd', (e) => e.innerText.replace(/\s+/g, ' ')),
      /^Library for Greiner Brothers 3 talks, newest first\. Uploading a talk does not send it to anyone\. Upload talks$/);
    assert.ok(!/Peine|Choice/.test(await page.$eval('#main table', (e) => e.innerText)), 'Greiner\'s library shows Greiner\'s talks only');
  });
  await check('the only filter is the search box (no category list)', async () => {
    assert.equal(await page.$('#tlib-cat'), null);
    assert.equal((await page.$$('.tl-libbar select')).length, 0);
    assert.equal((await page.$$('.tl-libbar #tlib-q')).length, 1);
    assert.ok(!/categor/i.test(await page.$eval('[data-tllib]', (e) => e.innerText)));
  });
  await shot(page, 'talk-library-list.png');
  for (const [w, name] of [[1024, 'talk-library-list-1024.png'], [390, 'talk-library-list-phone.png']]) {
    await check(`"Library" fits a ${w}px window without sideways scroll`, async () => {
      await page.setViewportSize({ width: w, height: w === 390 ? 1800 : 1100 }); await page.waitForTimeout(200);
      assert.ok(await noSideScroll() <= 1, 'overflow ' + await noSideScroll());
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('the Edit button opens the same edit drawer as clicking the row', async () => {
    await page.click('[data-tledit="l-step"]'); await page.waitForSelector('#tle-save');
    assert.equal(await page.$eval('#tle-title', (e) => e.value), 'Step Ladder Safety');
    await page.click('.drawer .x');
    await page.waitForFunction(() => !document.querySelector('.drawer'), null, { timeout: 3000 });
  });
  await check('search narrows the list by name', async () => {
    await page.fill('#tlib-q', 'step');
    await page.waitForFunction(() => document.querySelectorAll('[data-tlib]').length === 1);
    assert.deepEqual(await page.$$eval('[data-tlib]', (r) => r.map((x) => x.dataset.tlib)), ['l-step']);
    await page.fill('#tlib-q', '');
    await page.waitForFunction(() => document.querySelectorAll('[data-tlib]').length === 3);
  });

  await check('"Upload talks" opens the file picker at once: one talk filed as Greiner\'s, no week, category Toolbox Talk', async () => {
    await pick('#tlib-upload', [pdf('Ladder_Inspection.pdf')]);
    await page.waitForSelector('[data-tlib="l-new1"]');
    await noDrawer();
    assert.equal(edge.length, 1, 'the file is stored once');
    assert.deepEqual(edge[0], { action: 'upload', filename: 'Ladder_Inspection.pdf', category: 'Toolbox Talks',
      mime: 'application/pdf', hasData: true, id: undefined });
    assert.equal(adds.length, 1); assert.equal(weekAdds.length, 1, 'no week filing from the Library button');
    assert.equal(adds[0].p_doc_id, 'd-new1'); assert.equal(adds[0].p_title, 'Ladder Inspection');
    assert.equal(adds[0].p_category, 'Toolbox Talk'); assert.ok(!('p_companies' in adds[0]), 'no company list is sent');
    assert.ok(!('p_week' in adds[0]));
    assert.equal(adds[0].p_for, 'greiner');
    assert.equal(adds[0].p_token, 'fake-session-for-test');
    const r = await page.$eval('[data-tlib="l-new1"]', (e) => e.innerText);
    assert.match(r, /Ladder Inspection/); assert.match(r, /phone version being prepared/);
    await waitToast(/^Talk added for Greiner Brothers$/);
  });
  await check('many talks at once; a second Upload click while they upload says "Still uploading"', async () => {
    edgeDelay = 400;
    await pick('#tlib-upload', [pdf('Arc Welding Safety.pdf'), pdf('Hot Work - Fire Watch.pdf'), pdf('Cutting_Torch_Safety.pdf')]);
    await waitToast(/^Uploading 1 of 3: Arc Welding Safety\.pdf$/);
    let opened = false; const onFc = () => { opened = true; }; page.on('filechooser', onFc);
    await page.click('#tlib-upload');
    await waitToast(/^Still uploading\. One moment\.$/);
    await page.waitForTimeout(150); page.off('filechooser', onFc);
    assert.equal(opened, false, 'no second picker while uploading');
    await page.waitForSelector('[data-tlib="l-new4"]', { timeout: 8000 });
    edgeDelay = 0;
    await noDrawer();
    assert.equal(edge.filter((e) => e.action === 'upload').length, 4);
    assert.equal(adds.length, 4);
    for (const a of adds.slice(1)) {
      assert.equal(a.p_category, 'Toolbox Talk'); assert.equal(a.p_for, 'greiner'); assert.ok(!('p_companies' in a));
    }
    assert.deepEqual(adds.slice(1).map((a) => a.p_title), ['Arc Welding Safety', 'Hot Work - Fire Watch', 'Cutting Torch Safety']);
    await waitToast(/^3 talks added for Greiner Brothers$/);
    const t = await toasts();
    for (const x of ['Uploading 2 of 3: Hot Work - Fire Watch.pdf', 'Uploading 3 of 3: Cutting_Torch_Safety.pdf']) assert.ok(t.includes(x), t.join(' | '));
    assert.match(await text(), /7 talks, newest first/);
  });
  await check('a wrong file type or a file over 15 MB uploads nothing and says why', async () => {
    const nE = edge.length, nA = adds.length, nW = weekAdds.length;
    await pick('#tlib-upload', [pdf('Good One.pdf'), { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
    await waitToast(/^notes\.txt is not a PDF or Word file\. Nothing was uploaded\.$/);
    await pick('#tlib-upload', [{ name: 'Huge Talk.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(15 * 1024 * 1024 + 10, 0x20) }]);
    await waitToast(/^Huge Talk\.pdf is over the 15 MB limit\. Nothing was uploaded\.$/);
    await page.waitForTimeout(300);
    assert.deepEqual([edge.length, adds.length, weekAdds.length], [nE, nA, nW], 'nothing stored or filed');
    await noDrawer();
  });
  await shot(page, 'talk-library-after-upload.png');
  await check('a talk can be renamed (p_title only, never p_category) or removed; Edit has no category', async () => {
    await page.click('[data-tlib="l-holes"]'); await page.waitForSelector('#tle-save');
    assert.equal((await page.$$('[data-tlco]')).length, 0);
    assert.equal(await page.$('#tle-cat'), null, 'no category in Edit');
    assert.ok(!/categor/i.test(await page.$eval('.drawer', (e) => e.innerText)));
    await page.fill('#tle-title', 'Hole Covers');
    await shot(page, 'talk-library-edit-drawer.png');
    await page.click('#tle-save');
    await page.waitForFunction(() => /Hole Covers/.test((document.querySelector('[data-tlib="l-holes"]') || {}).innerText || '') && !document.querySelector('.drawer'));
    assert.deepEqual(sets[0], { p_token: 'fake-session-for-test', p_id: 'l-holes', p_title: 'Hole Covers' });
    await page.click('[data-tlib="l-new1"]'); await page.waitForSelector('#tle-remove');
    await page.click('#tle-remove');
    await page.waitForFunction(() => !document.querySelector('[data-tlib="l-new1"]'));
    assert.equal(sets[1].p_archived, true); assert.ok(!('p_category' in sets[1]));
    assert.equal((await page.$$('[data-tlib]')).length, 6);
    await noDrawer();
  });
  await check('if the document store does not hand back the file id, the talk is still filed against the right file', async () => {
    storeReturnsId = false;
    await pick('#tlib-upload', [pdf('Extension Cord Safety.pdf')]);
    await page.waitForSelector('[data-tlib="l-new5"]');
    const a = adds[adds.length - 1];
    assert.equal(a.p_doc_id, docs[docs.length - 1].id); assert.equal(a.p_title, 'Extension Cord Safety');
    assert.equal(a.p_category, 'Toolbox Talk');
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
  // ---- Nov 27: Peine and Choice from the same page ---------------------------------------------------------
  await page.click('[data-tlview="weeks"]'); await page.waitForSelector('[data-tlweekrow]');
  await check('Greiner\'s Coming up still shows the scheduled sends (and only Greiner\'s uploads)', async () => {
    assert.match(await weekRow('2026-11-30'), /Next week Ladder Safety Scheduled 2 people/i);
    assert.ok((await page.$$('[data-tlsched]')).length >= 2);
    assert.equal(await page.$eval('[data-tlweeks]', (e) => e.dataset.tlweeksco), 'greiner');
    assert.ok(!/Peine|Choice/.test(await page.$eval('#tlib-weeks', (e) => e.innerText)));
  });
  await check('switching to Peine: Coming up shows only Peine\'s uploads per week, no schedule, one plain line', async () => {
    await page.click('[data-tlcompany="peine"]');
    await page.waitForSelector('[data-tlweeksco="peine"]');
    assert.deepEqual(await page.$$eval('[data-tlcompany]', (b) => b.map((x) => x.classList.contains('on'))), [false, true, false]);
    const hd = await page.$eval('[data-tlweeks] .panel-hd', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    assert.match(hd, /^Coming up for Peine This week and the 8 after it\. 1 week has an upload\./);
    assert.match(await page.$eval('#tlib-weeks-note', (e) => e.innerText),
      /^ConfirmSafety sets up Peine's send from what you upload here\. Uploading does not schedule or send anything\.$/);
    assert.equal((await page.$$('[data-tlsched]')).length, 0, 'no scheduled talks for Peine on this page');
    assert.equal((await page.$$('[data-tlnone]')).length, 0, 'no "Not picked yet" for Peine');
    assert.equal((await page.$$('[data-tlnote]')).length, 0, 'the Greiner send note is not shown for Peine');
    assert.match(await weekRow('2026-12-07'), /Week of Mon, Dec 7 Uploaded Peine Cold Weather Received Upload$/i);
    assert.ok(!/Step Ladder/.test(await weekRow('2026-12-07')), 'Greiner\'s upload is not in Peine\'s view');
    assert.match(await weekRow('2026-11-30'), /Nothing uploaded yet/);
    assert.ok(!/Ladder Safety|Scheduled|Choice/.test(await weekRow('2026-11-30')));
    assert.equal((await page.$$('[data-tlempty]')).length, 8);
    assert.equal(await page.$eval('[data-tlweek="2026-12-21"]', (b) => b.getAttribute('aria-label')), 'Upload a Peine talk for the week of Mon, Dec 21');
  });
  for (const [w, name] of [[1440, 'talk-library-peine-weeks-1440.png'], [1024, 'talk-library-peine-weeks-1024.png'], [390, 'talk-library-peine-weeks-phone.png']]) {
    await check(`Peine's Coming up fits a ${w}px window without sideways scroll`, async () => {
      await page.setViewportSize({ width: w, height: w === 390 ? 2000 : 1200 }); await page.waitForTimeout(200);
      assert.ok(await noSideScroll() <= 1, 'overflow ' + await noSideScroll());
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('a week\'s Upload from Peine\'s view files the picked file for Peine: p_for "peine" with p_week', async () => {
    const n = weekAdds.length, nA = adds.length;
    await pick('[data-tlweek="2027-01-04"]', [pdf('ZZ TEST talk delete me.pdf')]);
    await page.waitForFunction(() => /ZZ TEST talk delete me/.test((document.querySelector('[data-tlweekrow="2027-01-04"]') || {}).innerText || ''));
    await noDrawer();
    assert.equal(weekAdds.length, n + 1); assert.equal(adds.length, nA);
    const a = weekAdds[n];
    assert.deepEqual([a.p_for, a.p_week, a.p_title, a.p_category], ['peine', '2027-01-04', 'ZZ TEST talk delete me', 'Toolbox Talk']);
    assert.equal(await page.$eval('[data-tlweeks]', (e) => e.dataset.tlweeksco), 'peine', 'still on Peine');
    await waitToast(/^Talk added for Peine, week of Mon, Jan 4$/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'talk-library-upload-peine.png') });
  });
  await check('switching to Choice shows only Choice\'s uploads; Greiner again shows its schedule and not Peine\'s test upload', async () => {
    await page.click('[data-tlcompany="choice"]'); await page.waitForSelector('[data-tlweeksco="choice"]');
    assert.match(await weekRow('2026-11-30'), /Uploaded Choice Trench Safety Received Upload$/i);
    assert.ok(!/ZZ TEST|Peine/.test(await page.$eval('#tlib-weeks', (e) => e.innerText)));
    assert.match(await page.$eval('#tlib-weeks-note', (e) => e.innerText), /^ConfirmSafety sets up Choice's send from what you upload here\./);
    await page.click('[data-tlcompany="greiner"]'); await page.waitForSelector('[data-tlweeksco="greiner"]');
    assert.match(await weekRow('2026-11-30'), /Ladder Safety Scheduled 2 people/i);
    assert.ok(!/ZZ TEST|Choice|Peine/.test(await page.$eval('#tlib-weeks', (e) => e.innerText)));
  });
  await check('Library switches with the company: Peine shows Peine\'s talks only, without a Last sent column', async () => {
    await page.click('[data-tlcompany="peine"]'); await page.click('[data-tlview="all"]');
    await page.waitForSelector('[data-tllibco="peine"]');
    assert.deepEqual(await page.$$eval('[data-tlib]', (r) => r.map((x) => x.dataset.tlib)),
      ['l-wk2', 'l-peine-lift', 'l-peine-cold'], 'newest first');
    assert.deepEqual(await page.$$eval('[data-tllib] th', (h) => h.map((x) => x.innerText.trim().toLowerCase())), ['talk', 'uploaded', '']);
    assert.match(await page.$eval('[data-tllib] .panel-hd', (e) => e.innerText.replace(/\s+/g, ' ')), /^Library for Peine 3 talks, newest first\./);
    assert.equal(await page.$('#tlib-cat'), null, 'no category filter');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'talk-library-peine-list.png') });
  });
  for (const [w, name] of [[1024, 'talk-library-peine-list-1024.png'], [390, 'talk-library-peine-list-phone.png']]) {
    await check(`Peine's Library fits a ${w}px window without sideways scroll`, async () => {
      await page.setViewportSize({ width: w, height: w === 390 ? 1600 : 1000 }); await page.waitForTimeout(200);
      assert.ok(await noSideScroll() <= 1, 'overflow ' + await noSideScroll());
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
    });
  }
  await check('the Edit drawer with "For which company" fits a phone-width window', async () => {
    await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(150);
    await page.click('[data-tledit="l-peine-lift"]'); await page.waitForSelector('[data-tlfor]');
    assert.deepEqual(await page.$$eval('[data-tlfor]', (b) => b.map((x) => [x.dataset.tlfor, x.classList.contains('on')])),
      [['greiner', false], ['peine', true], ['choice', false]]);
    const boxes = await page.$$eval('[data-tlfor]', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [r.left, r.right]; }));
    for (const [l, r] of boxes) assert.ok(l >= 0 && r <= 390, 'company button off screen ' + l + '-' + r);
    assert.ok(await noSideScroll() <= 1, 'overflow ' + await noSideScroll());
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'talk-library-edit-phone.png') });
    await page.click('.drawer .x'); await page.waitForFunction(() => !document.querySelector('.drawer'), null, { timeout: 3000 });
    await noDrawer();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('Upload talks from Choice\'s Library files the talk for Choice (p_for "choice", no week) and stays on Choice', async () => {
    await page.click('[data-tlcompany="choice"]'); await page.waitForSelector('[data-tllibco="choice"]');
    const n = adds.length, nW = weekAdds.length;
    await pick('#tlib-upload', [pdf('Choice_Silica_Dust.pdf')]);
    await page.waitForFunction(() => /Choice Silica Dust/.test((document.querySelector('[data-tllibco="choice"]') || {}).innerText || ''));
    await noDrawer();
    assert.equal(adds.length, n + 1); assert.equal(weekAdds.length, nW);
    assert.deepEqual([adds[n].p_for, adds[n].p_title, adds[n].p_category], ['choice', 'Choice Silica Dust', 'Toolbox Talk']);
    assert.deepEqual(await page.$$eval('[data-tlcompany]', (b) => b.map((x) => x.classList.contains('on'))), [false, false, true]);
    await waitToast(/^Talk added for Choice$/);
  });
  await check('Edit can move a talk to another company (p_for only when it changed)', async () => {
    const id = adds[adds.length - 1] && LIB.find((r) => r.title === 'Choice Silica Dust').id;
    await page.click(`[data-tlib="${id}"]`); await page.waitForSelector('#tle-save');
    assert.equal(await page.$eval('[data-tlfor].on', (e) => e.dataset.tlfor), 'choice');
    const n = sets.length;
    await page.click('#tle-save'); await page.waitForFunction(() => !document.querySelector('.drawer'));
    assert.ok(!('p_for' in sets[n]), 'unchanged company is not sent');
    assert.ok(!('p_category' in sets[n]), 'no category is sent');
    await page.click(`[data-tlib="${id}"]`); await page.waitForSelector('#tle-save');
    await page.click('[data-tlfor="peine"]');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'talk-library-edit-company.png') });
    await page.click('#tle-save');
    await page.waitForSelector(`[data-tllibco="peine"] [data-tlib="${id}"]`);
    assert.equal(sets[n + 1].p_for, 'peine'); assert.ok(!('p_category' in sets[n + 1]));
    // Remove it again so nothing below depends on it.
    await page.click(`[data-tlib="${id}"]`); await page.waitForSelector('#tle-remove'); await page.click('#tle-remove');
    await page.waitForFunction((x) => !document.querySelector(`[data-tlib="${x}"]`), id);
    await page.click('[data-tlcompany="greiner"]'); await page.waitForSelector('[data-tllibco="greiner"]');
    await noDrawer();
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
