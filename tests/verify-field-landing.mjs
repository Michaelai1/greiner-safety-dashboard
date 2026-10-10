/* The phone field landing (index.html + app.js) for a crew member with more than
 * one job, in a real browser (WebKit). Every server call is answered inside this
 * test; nothing leaves the machine. Covers: PIN sign-in resolves the employee,
 * the job picker, IU forms, IU job documents (Open / Download Original with
 * identical bytes), the Resource Center block (its own block above Job documents,
 * none at all when a job has no Resource Center files), honest empty and error
 * states, and the job-scoped form ticket.
 *
 * Needs playwright-webkit (PLAYWRIGHT_NODE_MODULES). SCREENSHOT_DIR saves screenshots.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const req = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'));
let webkit;
try { ({ webkit } = req('playwright-webkit')); } catch {
  console.log('Field landing verification skipped (set PLAYWRIGHT_NODE_MODULES).'); process.exit(0);
}
const SHOTS = process.env.SCREENSHOT_DIR || null;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const IU = 'job-iu', C785 = 'job-c785';
const docs = [['Safety and Permits', 'Gilbane Hot Work Permit', 'hot work permit (2).pdf'],
  ['Field Operations', 'Field Timesheet', 'Fillable field timesheet.pdf'],
  ['Resource Center', 'Fall Protection Plan', 'Fall protection plan.pdf'],
  ['Resource Center', 'Emergency Action Plan', 'EAP 2026.pdf']].map(([section, title, filename], i) => {
  const bytes = Buffer.from(`%PDF-1.7\n% test original ${i} é\n%%EOF\n`, 'utf8');
  return { id: 'doc-' + i, job_id: IU, section, title, filename, mime: 'application/pdf', size_bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), source_date: null, bytes };
});
let STATE;
function reset() {
  STATE = { jobs: [C785, IU], docsFail: false, noResourceCenter: false, calls: [], tickets: [] };
}
const job = (id) => id === IU
  ? { id: IU, job_number: 'C799-2025', name: 'IU Health Plaza G Med. Gas', address: '1330 N Senate Ave, Indianapolis, IN 46202',
      external_hotwork: false, enabled_forms: null, user_forms: ['jha', 'hotwork', 'aerial', 'forklift'] }
  : { id: C785, job_number: 'C785-2023', name: 'IU Health Plmb Core & Shell', address: 'x', external_hotwork: false, enabled_forms: null, user_forms: ['jha'] };
const RPC = {
  cs_portal_login: (b) => b.p_pin === '9137'
    ? { ok: true, session: 'sess-test', expires_at: new Date(Date.now() + 864e5).toISOString(), user: 'Crew Two (Test)', role: 'field', job_ids: STATE.jobs, company: 'Greiner Brothers' }
    : { ok: false, error: 'Wrong code' },
  cs_portal_field_home: () => ({ user: 'Crew Two (Test)', company: 'Greiner Brothers', jobs: STATE.jobs.map(job), people: [], equipment: [], recent: [], hotwork_locations: [] }),
  cs_portal_job_docs: (b) => {
    if (STATE.docsFail) return { __status: 400, message: 'temporarily unavailable' };
    if (!STATE.jobs.includes(b.p_job_id)) return { __status: 400, message: 'not permitted' };
    if (b.p_job_id !== IU) return [];
    return docs.filter((d) => !STATE.noResourceCenter || d.section !== 'Resource Center').map(({ bytes, ...d }) => d);
  },
  cs_portal_field_ticket: (b) => { STATE.tickets.push(b.p_job_id); return { ticket: 'ft_test_' + b.p_job_id }; },
  cs_portal_log_event: () => null, cs_portal_event: () => null
};

const offMachine = [], qrOpens = [];
let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
const browser = await webkit.launch();
async function open(width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('**/*', (r) => {
    const u = r.request().url(), cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const m = u.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      const body = JSON.parse(r.request().postData() || '{}');
      STATE.calls.push(m[1]);
      const f = RPC[m[1]]; let out = f ? f(body) : null; let status = 200;
      if (out && out.__status) { status = out.__status; out = { message: out.message }; }
      return r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(out) });
    }
    if (/\/functions\/v1\/company-docs$/.test(u)) {
      const b = JSON.parse(r.request().postData() || '{}');
      const d = docs.find((x) => x.id === b.id);
      if (b.action !== 'job_url' || !d || b.token !== 'sess-test') return r.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"error":"not permitted"}' });
      return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'https://signed.files.test/' + d.id + (b.download ? '?download=1' : ''), filename: d.filename }) });
    }
    if (u.startsWith('https://signed.files.test/')) {
      const d = docs.find((x) => u.includes('/' + x.id));
      return r.fulfill({ headers: cors, contentType: 'application/pdf', body: d.bytes });
    }
    if (u.startsWith('https://michaelai1.github.io/greiner-QR/')) { qrOpens.push(u); return r.fulfill({ contentType: 'text/html', body: '<p>forms app</p>' }); }
    if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\//.test(u)) return r.abort();
    offMachine.push(u); return r.abort();
  });
  await page.goto(BASE + 'index.html');
  await page.waitForSelector('#gate-in');
  return page;
}
async function signIn(p) {
  await p.fill('#gate-in', '9137');
  await p.click('#gate-go');
  await p.waitForSelector('#fieldapp [data-ngform]', { timeout: 5000 });
}
const noOverflow = async (p, label) => {
  const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(o.sw <= o.cw + 1, `${label}: ${o.sw} > ${o.cw}`);
};

try {
  reset();
  const p = await open();
  await check('PIN sign-in resolves the employee and keeps both jobs', async () => {
    await signIn(p);
    assert.ok((await p.textContent('#fieldapp')).includes('Signed in as Crew Two (Test)'), 'the signed-in employee is shown');
    const opts = await p.$$eval('#f-job option', (o) => o.map((x) => x.textContent));
    assert.deepEqual(opts, ['IU Health Plmb Core & Shell · C785-2023', 'IU Health Plaza G Med. Gas · C799-2025']);
  });

  await check('Selecting C799 shows the IU job, its four forms and its documents', async () => {
    await p.selectOption('#f-job', IU);
    await p.waitForSelector('#f-docs [data-jobdoc]');
    const t = await p.innerText('#fieldapp');
    assert.ok(t.includes('IU Health Plaza G Med. Gas') && t.includes('C799-2025'));
    assert.deepEqual(await p.$$eval('[data-ngform]', (b) => b.map((x) => x.dataset.ngform)), ['jha', 'hotwork', 'aerial', 'forklift']);
    const d = await p.innerText('#f-docs');
    assert.ok(d.includes('Gilbane Hot Work Permit') && d.includes('hot work permit (2).pdf') && d.includes('Safety and Permits'));
    assert.ok(d.indexOf('Safety and Permits') < d.indexOf('Field Operations'));
    assert.match(d, /some phone browsers show a form read-only/, 'no promise that every browser can fill the form');
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.locator('#f-docs').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, '11-phone-iu-job-documents.png') }); }
  });

  await check('Resource Center files show in their own block above Job documents', async () => {
    await p.waitForSelector('#f-rc [data-jobdoc]');
    const rcSec = await p.$('#f-rc-sec');
    assert.ok(await rcSec.isVisible(), 'the Resource Center block is shown');
    assert.equal((await p.innerText('#f-rc-sec h2')).trim(), 'Resource Center');
    const rc = await p.innerText('#f-rc');
    assert.ok(rc.includes('Fall Protection Plan') && rc.includes('Emergency Action Plan'), 'both Resource Center files are listed');
    assert.ok(!rc.includes('Gilbane Hot Work Permit') && !rc.includes('Field Timesheet'), 'job documents stay out of it');
    assert.deepEqual(await p.$$eval('#f-rc [data-jobdoc] [data-docact]', (b) => b.map((x) => x.textContent)),
      ['Open Original', 'Download Original', 'Open Original', 'Download Original'], 'same Open / Download buttons');
    // Job documents are exactly as before: their two sections, no Resource Center inside.
    const d = await p.innerText('#f-docs');
    assert.ok(!d.includes('Resource Center') && !d.includes('Fall Protection Plan'), 'Resource Center files are not repeated in Job documents');
    assert.deepEqual(await p.$$eval('#f-docs h3', (h) => h.map((x) => x.textContent)), ['Safety and Permits', 'Field Operations']);
    assert.equal(await p.$$eval('#f-docs [data-jobdoc]', (c) => c.length), 2);
    // Order on the page: Resource Center, then Job documents.
    assert.ok(await p.evaluate(() => !!(document.querySelector('#f-rc-sec').compareDocumentPosition(document.querySelector('#f-docs')) & Node.DOCUMENT_POSITION_FOLLOWING)),
      'Resource Center sits above Job documents');
    if (SHOTS) { await p.locator('#f-rc-sec').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, '12-phone-iu-resource-center.png') }); }
  });

  await check('Download Original returns the exact bytes under the original filename', async () => {
    for (const d of docs) {
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click(`[data-docact="download"][data-id="${d.id}"]`)]);
      assert.equal(dl.suggestedFilename(), d.filename);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(await dl.path())).digest('hex'), d.sha256);
    }
  });

  await check('Open Original opens the original PDF in a new tab', async () => {
    const [tab] = await Promise.all([p.waitForEvent('popup'), p.click(`[data-docact="open"][data-id="doc-0"]`)]);
    await tab.waitForTimeout(500);
    assert.ok(tab.url().startsWith('blob:'), 'the PDF is handed over as the original bytes, not a re-render');
    await tab.close();
  });

  await check('The other job shows an honest empty document state, and its own forms', async () => {
    await p.selectOption('#f-job', C785);
    await p.waitForFunction(() => /No documents for this job yet/.test(document.querySelector('#f-docs').textContent));
    assert.deepEqual(await p.$$eval('[data-ngform]', (b) => b.map((x) => x.dataset.ngform)), ['jha']);
    assert.ok(!(await (await p.$('#f-rc-sec')).isVisible()), 'no empty Resource Center block');
    assert.equal(await p.$$eval('#f-rc [data-jobdoc]', (c) => c.length), 0);
  });

  await check('A job with documents but no Resource Center files shows no Resource Center block', async () => {
    STATE.noResourceCenter = true;
    const q = await open(390);
    await signIn(q);
    await q.selectOption('#f-job', IU);
    await q.waitForSelector('#f-docs [data-jobdoc]');
    assert.ok(!(await (await q.$('#f-rc-sec')).isVisible()), 'the Resource Center block stays hidden');
    assert.equal((await q.innerText('#f-rc')).trim(), '', 'and empty');
    assert.deepEqual(await q.$$eval('#f-docs h3', (h) => h.map((x) => x.textContent)), ['Safety and Permits', 'Field Operations']);
    assert.ok(!(await q.innerText('#fieldapp')).includes('Resource Center'), 'the words Resource Center do not appear at all');
    await q.close();
    STATE.noResourceCenter = false;
  });

  await check('Starting a form on C799 asks for a C799-only ticket and opens the existing QR app URL', async () => {
    await p.selectOption('#f-job', IU);
    await Promise.all([p.waitForURL(/greiner-QR/), p.click('[data-ngform="jha"]')]);
    assert.equal(STATE.tickets.at(-1), IU);
    assert.ok(qrOpens.at(-1).startsWith('https://michaelai1.github.io/greiner-QR/?ngform=jha&ticket=ft_test_' + IU));
  });

  await check('A failed document load says so and offers a retry', async () => {
    STATE.docsFail = true;
    const q = await open(390);
    await signIn(q);
    await q.selectOption('#f-job', IU);
    await q.waitForSelector('#f-docs-retry');
    assert.match(await q.innerText('#f-docs'), /Could not load documents/);
    STATE.docsFail = false;
    await q.click('#f-docs-retry');
    await q.waitForSelector('#f-docs [data-jobdoc]');
    await q.close();
  });

  await check('A single-job user gets no job picker', async () => {
    STATE.jobs = [IU];
    const q = await open(390);
    await signIn(q);
    assert.equal(await q.$('#f-job'), null);
    assert.ok((await q.innerText('#fieldapp')).includes('C799-2025'));
    await q.close();
    STATE.jobs = [C785, IU];
  });

  await check('No horizontal overflow at 390, 820, 1024 and 1440; centered and readable on a computer', async () => {
    for (const w of [390, 820, 1024, 1440]) {
      const q = await open(w);
      await signIn(q);
      await q.selectOption('#f-job', IU);
      await q.waitForSelector('#f-docs [data-jobdoc]');
      await q.waitForSelector('#f-rc [data-jobdoc]');
      await noOverflow(q, `field landing ${w}`);
      if (w >= 1024) {
        // One centered column of a readable width, header lined up with it.
        const g = await q.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          return { main: r('#fieldapp main.wrap'), hdr: r('#fieldapp .hdr-in'), vw: document.documentElement.clientWidth,
                   font: parseFloat(getComputedStyle(document.querySelector('#fieldapp [data-ngform]')).fontSize) };
        });
        assert.ok(g.main.width <= 860 && g.main.width >= 600, `${w}: content column ${g.main.width}px`);
        assert.ok(Math.abs(g.main.left - (g.vw - g.main.right)) <= 2, `${w}: content is centered`);
        assert.ok(Math.abs(g.hdr.left - g.main.left) <= 2, `${w}: header lines up with the content`);
        assert.ok(g.font >= 15, `${w}: form buttons stay readable`);
        if (SHOTS) await q.screenshot({ path: path.join(SHOTS, `13-desktop-${w}-field-landing.png`), fullPage: true });
      }
      assert.deepEqual(q.errors, []);
      await q.close();
    }
  });

  await check('No page errors; nothing left the machine', async () => {
    assert.deepEqual(p.errors, []);
    assert.deepEqual(offMachine, []);
  });
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.log(`Field landing verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`Field landing verification passed (${checks} checks, 4 widths, no network).`);
