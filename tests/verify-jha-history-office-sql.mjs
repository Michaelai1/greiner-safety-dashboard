/* Office JHA history against the REAL release SQL (end to end, local only).
 *
 * PGlite runs worker S's release migration (sql/release-2026-10-22/01-jha-revisions.sql)
 * on S's test schema (tests/release-sql/fixture-schema.sql) over the live function
 * bodies (LIVE_DEFS, the coordinator's read-only copy). Fictional originals are
 * inserted, revisions are made through cs_jha_revise with the field session, PDFs are
 * attached with cs_jha_revision_attach_pdf, and the clock is pinned with a TEST-ONLY
 * cs_jha_now() override (production: now()). The office (office.html, WebKit) then
 * talks to that database: every cs_portal_field_inspections / cs_portal_jha_history /
 * cs_portal_field_doc call is answered by PGlite, and the field-pdf edge 'url' action is
 * answered by cs_portal_field_pdf_path, exactly as the edge function does.
 *
 * Proves the office reads S's actual output (not only the stubs in
 * verify-jha-history-office.mjs): list badge, head shown, history order, open / closed /
 * no-window, the revision PDF resolved by revision id, originals never changed,
 * nothing off the machine.
 *
 * Needs PLAYWRIGHT_NODE_MODULES (playwright-webkit) and PGLITE_NODE_MODULES
 * (@electric-sql/pglite); skips cleanly without them, without S's SQL files, or without
 * LIVE_DEFS (default: ~/.nextgen-hq/coordinator/run-2026-10-22-release/live-defs/
 * live-functions-2026-10-22-1720.sql).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIG = path.join(ROOT, 'sql/release-2026-10-22/01-jha-revisions.sql');
const SCHEMA = path.join(ROOT, 'tests/release-sql/fixture-schema.sql');
const LIVE_DEFS = process.env.LIVE_DEFS ||
  path.join(os.homedir(), '.nextgen-hq/coordinator/run-2026-10-22-release/live-defs/live-functions-2026-10-22-1720.sql');
for (const f of [MIG, SCHEMA, LIVE_DEFS]) {
  if (!fs.existsSync(f)) { console.log(`JHA history office + SQL verification skipped (${f} not found).`); process.exit(0); }
}
let webkit, PGlite, pgcrypto;
try {
  ({ webkit } = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'))('playwright-webkit'));
  const preq = createRequire(path.join(process.env.PGLITE_NODE_MODULES || '/nonexistent', 'noop.js'));
  ({ PGlite } = await import(pathToFileURL(preq.resolve('@electric-sql/pglite')).href));
  ({ pgcrypto } = await import(pathToFileURL(preq.resolve('@electric-sql/pglite/contrib/pgcrypto')).href));
} catch {
  console.log('JHA history office + SQL verification skipped (set PLAYWRIGHT_NODE_MODULES and PGLITE_NODE_MODULES).'); process.exit(0);
}

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n       ')}`); }
}

/* ---- the database: S's schema + live bodies + S's migration, unchanged ---- */
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(SCHEMA, 'utf8'));
await db.exec(fs.readFileSync(LIVE_DEFS, 'utf8'));
await db.exec(fs.readFileSync(MIG, 'utf8'));
await db.exec(`
  create table test_clock (t timestamptz);
  -- TEST ONLY: production cs_jha_now() is now(). This override exists in this PGlite database and nowhere else.
  create or replace function public.cs_jha_now() returns timestamptz language sql stable as $$ select coalesce((select t from test_clock limit 1), now()) $$;`);
const q = async (s, p = []) => (await db.query(s, p)).rows;
const setClock = async (iso) => { await db.exec('delete from test_clock'); await q('insert into test_clock values ($1)', [iso]); };

const G = 'e0000000-0000-4000-8000-0000000000a1', J1 = 'e0000000-0000-4000-8000-000000000301';
const U1 = 'e0000000-0000-4000-8000-000000000501', U2 = 'e0000000-0000-4000-8000-000000000502';
const ID = { a: 'e0000000-0000-4000-8000-00000000a001', b: 'e0000000-0000-4000-8000-00000000b001',
  c: 'e0000000-0000-4000-8000-00000000c001', d: 'e0000000-0000-4000-8000-00000000d001', h: 'e0000000-0000-4000-8000-00000000e001' };
const TOK = { f1: 'fake-field-one', f2: 'fake-field-two', office: 'fake-office-full' };
const doc = (marker) => ({ doc: { title: 'JHA', sections: [{ title: 'Task', items: [{ label: 'Task description', response: marker, flagged: false, photos: [] }] }] } });
await q(`insert into cs_companies (id, name) values ($1, 'Greiner Brothers (fictional test copy)')`, [G]);
await q(`insert into cs_jobs (id, company_id, job_number, name) values ($1, $2, 'C900-F', 'Maple Street Clinic (fictional)')`, [J1, G]);
await db.exec(`insert into cs_portal_sessions (token, company_id, scope, slug, expires_at, user_id, user_name, job_ids) values
  ('${TOK.f1}', '${G}', 'field', 'greiner', now() + interval '2 days', '${U1}', 'Dana Fictional', array['${J1}']::uuid[]),
  ('${TOK.f2}', '${G}', 'field', 'greiner', now() + interval '2 days', '${U2}', 'Robin Placeholder', array['${J1}']::uuid[]),
  ('${TOK.office}', '${G}', 'full', 'greiner', now() + interval '2 days', null, 'Office (fictional)', null);`);
const orig = async (id, type, title, who, at, marker, pdf) => q(
  `insert into cs_field_submissions (id, company_id, job_id, user_id, inspector_name, form_type, form_title, fields, pdf_path, submitted_at)
   values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [id, G, J1, U1, who, type, title, JSON.stringify(doc(marker)), pdf, at]);
await orig(ID.a, 'jha', 'JHA (Task / Hazard / Control)', 'Dana Fictional', '2026-10-19T11:05:00Z', 'ORIGINAL-A answer', `greiner/${ID.a}.pdf`);   // Mon 7:05 AM
await orig(ID.b, 'jha', 'JHA (Task / Hazard / Control)', 'Lee Example', '2026-10-12T12:00:00Z', 'ORIGINAL-B answer', `greiner/${ID.b}.pdf`);      // Mon a week earlier
await orig(ID.c, 'jha', 'JHA (Task / Hazard / Control)', 'Sam Sample', '2026-10-17T14:00:00Z', 'ORIGINAL-C answer', `greiner/${ID.c}.pdf`);       // Saturday
await orig(ID.d, 'jha', 'JHA (Task / Hazard / Control)', 'Dana Fictional', '2026-10-22T11:00:00Z', 'ORIGINAL-D answer', `greiner/${ID.d}.pdf`);   // Thursday
await orig(ID.h, 'hot_work_permit', 'Hot Work Permit', 'Sam Sample', '2026-10-21T13:00:00Z', 'HOT WORK', `greiner/${ID.h}.pdf`);
const before = await q(`select id, md5(row(s.*)::text) as m from cs_field_submissions s order by id`);

const revise = async (tok, original, marker, key) => (await q(
  `select public.cs_jha_revise(p_token => $1, p_original => $2, p_fields => $3::jsonb, p_photos => '[]'::jsonb,
     p_has_defects => false, p_defect_count => 0, p_client_key => $4) as r`, [tok, original, JSON.stringify(doc(marker)), key]))[0].r;
const attach = async (tok, rid) => (await q(`select public.cs_jha_revision_attach_pdf($1, $2, $3) as r`, [tok, rid, `greiner/${rid}.pdf`]))[0].r;
await setClock('2026-10-20T13:30:00Z');
const a1 = await revise(TOK.f1, ID.a, 'REVISION-1-A answer', 'k-a1'); await attach(TOK.f1, a1.revision_id);
await setClock('2026-10-21T18:45:00Z');
const a2 = await revise(TOK.f2, ID.a, 'REVISION-2-A answer', 'k-a2'); await attach(TOK.f2, a2.revision_id);
await setClock('2026-10-14T15:10:00Z');
const b1 = await revise(TOK.f1, ID.b, 'REVISION-1-B answer', 'k-b1');            // no PDF attached
await setClock('2026-10-22T16:00:00Z');   // "now": Thursday Oct 22, 12:00 PM Indianapolis

async function callSql(fn, body) {
  const keys = Object.keys(body);
  const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  return (await q(`select public.${fn}(${args}) as r`, keys.map((k) => body[k])))[0].r;
}

/* ---- the office, talking to that database ------------------------------- */
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'office.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const SQL_FNS = new Set(['cs_portal_field_inspections', 'cs_portal_jha_history', 'cs_portal_field_doc']);
const STUB = { cs_portal_bundle: () => ({ company: { id: G, name: 'Greiner Brothers' },
  jobs: [{ id: J1, job_number: 'C900-F', name: 'Maple Street Clinic (fictional)', status: 'active' }],
  reports: [], certs: [], workers: [], stats: [], docs: [], equipment: [], gc_templates: [] }),
  cs_portal_findings: () => ({}), cs_portal_incidents: () => [] };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const unexpected = [], edge = [], sqlCalls = [];
const FULL = { ok: true, session: TOK.office, expires_at: new Date(Date.now() + 864e5).toISOString(), user: 'Office (fictional)', role: 'full', job_ids: [], company: 'Greiner Brothers' };
const browser = await webkit.launch();
async function open(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((v) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('cs_session_greiner', v); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(FULL));
  await ctx.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return r.continue();
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const reply = (status, body) => r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const m = u.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      const body = JSON.parse(r.request().postData() || '{}');
      if (SQL_FNS.has(m[1])) {
        sqlCalls.push(m[1]);
        try { return reply(200, await callSql(m[1], body)); } catch (e) { return reply(400, { message: e.message }); }
      }
      return reply(200, STUB[m[1]] ? STUB[m[1]](body) : []);
    }
    if (/supabase\.co\/functions\/v1\/field-pdf$/.test(u)) {
      const body = JSON.parse(r.request().postData() || '{}');
      try {   // what the live edge function does for 'url': cs_portal_field_pdf_path(token, id) -> signed URL
        const res = await callSql('cs_portal_field_pdf_path', { p_token: body.token, p_id: body.id });
        edge.push({ ...body, pdf_path: res.pdf_path });
        return reply(200, { url: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK' });
      } catch (e) { edge.push({ ...body, error: e.message }); return reply(400, { error: e.message }); }
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.abort();
    unexpected.push(u); return r.abort();
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(BASE + 'office.html#insp');
  await page.waitForSelector(`tr[data-crewi="${ID.a}"]`);
  return page;
}
const txt = async (p, sel) => (await p.innerText(sel)).replace(/\s+/g, ' ').trim();
async function openRow(p, id) {
  await p.evaluate(() => document.querySelectorAll('.scrim,.drawer').forEach((e) => e.remove()));
  await p.click(`tr[data-crewi="${id}"] td:nth-child(2)`);
  await p.waitForSelector('#jrv-list, #jrv-err, #crew-doc');
  await p.waitForFunction(() => { const b = document.querySelector('#crew-doc'); return b && !/Loading/.test(b.textContent); });
}
const waitEdge = async (n) => { const t0 = Date.now(); while (edge.length < n && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50)); };

try {
  await check('the real cs_portal_field_inspections adds revision_count / head_revision_at to JHA rows only', async () => {
    const rows = await callSql('cs_portal_field_inspections', { p_token: TOK.office });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by[ID.a].revision_count, 2); assert.equal(new Date(by[ID.a].head_revision_at).toISOString(), '2026-10-21T18:45:00.000Z');
    assert.equal(by[ID.b].revision_count, 1); assert.equal(by[ID.c].revision_count, 0); assert.equal(by[ID.c].head_revision_at, null);
    assert.ok(!('revision_count' in by[ID.h]), 'Hot Work row unchanged');
  });

  for (const width of [1440, 390]) {
    await check(`${width}px: list badge and the revised JHA's current version, from the real SQL`, async () => {
      const p = await open(width);
      assert.match(await txt(p, `tr[data-crewi="${ID.a}"]`), /Revised \(2\), current version Oct 21, 2026 · 2:45 PM/);
      assert.match(await txt(p, `tr[data-crewi="${ID.b}"]`), /Revised \(1\), current version Oct 14, 2026 · 11:10 AM/);
      for (const id of [ID.c, ID.d, ID.h]) assert.ok(!/Revised/.test(await txt(p, `tr[data-crewi="${id}"]`)));
      await openRow(p, ID.a);
      assert.match(await txt(p, '#jrv-cur'), /Showing the current version: Revision 2, Oct 21, 2026 · 2:45 PM by Robin Placeholder/);
      assert.match(await txt(p, '#crew-doc'), /REVISION-2-A answer/);
      const vers = await p.$$eval('#jrv-list .jrv-item', (li) => li.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
      assert.equal(vers.length, 3);
      assert.match(vers[0], /^Original Oct 19, 2026 · 7:05 AM · Dana Fictional/);
      assert.match(vers[1], /^Revision 1 Oct 20, 2026 · 9:30 AM · Dana Fictional/);
      assert.match(vers[2], /^Revision 2 Current Oct 21, 2026 · 2:45 PM · Robin Placeholder/);
      assert.match(await txt(p, '#jrv-window'), /Open until Fri, Oct 23, 6:00 PM/);
      edge.length = 0;
      await p.click(`#jrv-list [data-jrv-pdf="${a1.revision_id}"]`); await waitEdge(1);
      await p.click('#dl-crewi'); await waitEdge(2);
      await p.click(`#jrv-list [data-jrv-pdf="${ID.a}"]`); await waitEdge(3);
      assert.deepEqual(edge, [
        { action: 'url', token: TOK.office, id: a1.revision_id, pdf_path: `greiner/${a1.revision_id}.pdf` },
        { action: 'url', token: TOK.office, id: a2.revision_id, pdf_path: `greiner/${a2.revision_id}.pdf` },
        { action: 'url', token: TOK.office, id: ID.a, pdf_path: `greiner/${ID.a}.pdf` }], 'each version resolves to its own PDF');
      await openRow(p, ID.b);
      assert.match(await txt(p, '#jrv-window'), /Closed at Fri, Oct 16, 6:00 PM/);
      assert.match(await txt(p, '#jrv-nopdf'), /The PDF for Revision 1 is not attached yet/);
      await openRow(p, ID.c);
      assert.match(await txt(p, '#jrv-window'), /No revision window/);
      assert.match(await txt(p, '#crew-doc'), /ORIGINAL-C answer/);
      await openRow(p, ID.d);
      assert.match(await txt(p, '#jrv-window'), /Open until Fri, Oct 23, 6:00 PM/);
      assert.match(await txt(p, '#jrv-cur'), /This JHA has not been revised/);
      const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(o.sw <= o.cw + 1, `no sideways scroll (${o.sw} > ${o.cw})`);
      assert.deepEqual(p.errors, []);
      await p.context().close();
    });
  }

  await check('the originals were never changed by any revision or read', async () => {
    assert.deepEqual(await q(`select id, md5(row(s.*)::text) as m from cs_field_submissions s order by id`), before);
    assert.equal(b1.revision_number, 1);
  });
  await check('nothing left the machine', async () => { assert.deepEqual(unexpected, []); assert.ok(sqlCalls.includes('cs_portal_jha_history')); });
} finally {
  await browser.close();
  server.close();
  await db.close();
}
if (failures) { console.log(`JHA history office + SQL verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`JHA history office + SQL verification passed (${checks} checks, office against the release SQL in PGlite, fictional data, nothing sent).`);
