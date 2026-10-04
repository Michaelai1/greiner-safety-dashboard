/* Runs sql/2026-10-05b-job-docs-and-crew.sql on an in-memory copy of the
 * production schema slice: job-scoped document access, idempotent uploads, and
 * the IU crew list built from roster jobs plus field-login job access.
 * Needs @electric-sql/pglite (PGLITE_NODE_MODULES or PLAYWRIGHT_NODE_MODULES). No Supabase.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modDir = process.env.PGLITE_NODE_MODULES || process.env.PLAYWRIGHT_NODE_MODULES;
let req;
try { req = createRequire(path.join(modDir || ROOT, 'noop.js')); req.resolve('@electric-sql/pglite'); }
catch { console.log('Job docs SQL verification skipped (set PGLITE_NODE_MODULES).'); process.exit(0); }
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const { pgcrypto } = await import(pathToFileURL(req.resolve('@electric-sql/pglite/contrib/pgcrypto')).href);

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(path.join(ROOT, 'tests/fixtures/prod-schema-slice.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(ROOT, 'sql/2026-10-05-equipment-management.sql'), 'utf8'));
const one = async (s, p = []) => (await db.query(s, p)).rows[0];
const call = async (fn, args) => {
  const r = await one(`select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')}) as r`, args);
  return typeof r.r === 'string' ? JSON.parse(r.r) : r.r;
};
const fails = async (p, re, m) => { try { await p; } catch (e) { ok(re.test(e.message), `${m} (got ${e.message})`); return; } assert.fail(m + ': expected an error'); };

const A = (await one(`insert into cs_companies (name) values ('Greiner (test)') returning id`)).id;
const B = (await one(`insert into cs_companies (name) values ('Other (test)') returning id`)).id;
const job = async (c, n) => (await one(`insert into cs_jobs (company_id, job_number, name) values ($1, $2, $2) returning id`, [c, n])).id;
const IU = await job(A, 'C799-2025'), C785 = await job(A, 'C785-2023'), PUR = await job(A, 'C800-2025'), BJ = await job(B, 'X1');
const P = ['Lead (Test)', 'Two (Test)', 'Three (Test)', 'Four (Test)', 'Five (Test)', 'Six (Test)'];
// Four of the six are on the C785 roster, two on IU, plus unrelated people.
for (const [n, j] of [[P[0], C785], [P[2], C785], [P[3], C785], [P[4], C785], [P[1], IU], [P[5], IU], ['C785 Only (Test)', C785], ['Inactive (Test)', IU]]) {
  await db.query(`insert into cs_workers (company_id, name, job_id, active) values ($1, $2, $3, $4)`, [A, n, j, n !== 'Inactive (Test)']);
}
await db.query(`insert into cs_workers (company_id, name, job_id) values ($1, 'Other Company Person', $2)`, [B, BJ]);
const users = {};
for (const n of P) users[n] = (await call('cs_portal_set_user', ['greiner', n, String(4800 + P.indexOf(n) * 37), null, 'field', `{${IU}}`])).id;
users.multi = (await call('cs_portal_set_user', ['greiner', 'Multi Job (Test)', '5917', null, 'field', `{${C785},${IU}}`])).id;
users.c785 = (await call('cs_portal_set_user', ['greiner', 'C785 Login (Test)', '6283', null, 'field', `{${C785}}`])).id;
users.office = (await call('cs_portal_set_user', ['greiner', 'Office (Test)', '7391', null, 'full', null])).id;
await db.query(`insert into cs_portal_users (slug, name, pin_hash, role, job_ids) values ('othercorp', 'Other Login', 'x', 'field', $1)`, [`{${IU}}`]);
const sess = (t, c, scope, jobs, uid, name, slug = 'greiner') => db.query(
  `insert into cs_portal_sessions (token, company_id, scope, slug, expires_at, user_id, user_name, job_ids) values ($1,$2,$3,$4, now() + interval '1 hour', $5, $6, $7)`,
  [t, c, scope, slug, uid, name, jobs]);
await sess('office', A, 'full', null, users.office, 'Office (Test)');
await sess('iu', A, 'field', [IU], users[P[1]], P[1]);
await sess('c785', A, 'field', [C785], users.c785, 'C785 Login (Test)');
await sess('multi-login', A, 'field', [C785, IU], users.multi, 'Multi Job (Test)');
await sess('multi-ticket-iu', A, 'field', [IU], users.multi, 'Multi Job (Test)');
await sess('other-office', B, 'full', null, null, 'Other office', 'othercorp');
await sess('expired', A, 'full', null, users.office, 'x');
await db.query(`update cs_portal_sessions set expires_at = now() - interval '1 minute' where token = 'expired'`);

const rosterBefore = JSON.stringify((await db.query(`select name, job_id, active from cs_workers order by name`)).rows);
const usersBefore = JSON.stringify((await db.query(`select name, job_ids, role from cs_portal_users order by name`)).rows);
const homeBefore = ['company', 'equipment', 'hotwork_locations', 'jobs', 'people', 'recent', 'user'];   // live 2026-09-16 keys

await db.exec(fs.readFileSync(path.join(ROOT, 'sql/2026-10-05b-job-docs-and-crew.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(ROOT, 'sql/2026-10-05b-job-docs-and-crew.sql'), 'utf8'));
ok(true, 'migration applies twice');

/* ---------- crew list ---------- */
const home = await call('cs_portal_field_home', ['iu']);
eq(Object.keys(home).sort(), homeBefore, 'field_home keeps the live keys');
const crew = home.people.map((p) => p.name);
for (const n of P) ok(crew.includes(n), `${n} is in the IU crew list`);
eq(crew.length, new Set(crew.map((n) => n.toLowerCase())).size, 'no one listed twice');
ok(crew.includes('Multi Job (Test)'), 'a multi-job login with IU access is listed');
ok(!crew.includes('C785 Only (Test)') && !crew.includes('C785 Login (Test)'), 'people without IU access are not listed');
ok(!crew.includes('Inactive (Test)'), 'inactive roster members are not listed');
ok(!crew.includes('Other Company Person') && !crew.includes('Other Login'), 'other companies never appear');
eq(home.people.find((p) => p.name === P[1]).phone, null, 'roster record wins for a person on both lists');
const c785crew = (await call('cs_portal_field_home', ['c785'])).people.map((p) => p.name);
ok(c785crew.includes(P[0]) && c785crew.includes('C785 Only (Test)'), 'C785 crew still lists its roster');
ok(!c785crew.includes(P[1]), 'an IU-only login is not on the C785 crew');
eq(JSON.stringify((await db.query(`select name, job_id, active from cs_workers order by name`)).rows), rosterBefore, 'no roster job changed');
eq(JSON.stringify((await db.query(`select name, job_ids, role from cs_portal_users order by name`)).rows), usersBefore, 'no login changed');
const multi = await call('cs_portal_field_home', ['multi-login']);
eq(multi.jobs.map((j) => j.job_number).sort(), ['C785-2023', 'C799-2025'], 'a multi-job login sees both jobs');

/* ---------- documents ---------- */
const sha = (c) => c.repeat(64);
const pathFor = (j, n) => `${A}/jobs/${j}/${n}.pdf`;
const add = (tok, j, s, t, p, h) => call('cs_portal_job_doc_add', [tok, j, s, t, t + '.pdf', 'application/pdf', 1000, h, null, p]);
let r = await add('office', IU, 'Safety and Permits', 'Permit', pathFor(IU, 'a'), sha('a'));
ok(r.id && r.existing === false, 'office adds an IU document');
const DOC = r.id;
r = await add('office', IU, 'Safety and Permits', 'Permit again', pathFor(IU, 'a2'), sha('a'));
ok(r.existing === true && r.id === DOC, 'the same file twice returns the existing record');
await fails(add('office', IU, 'S', 'T', pathFor(C785, 'x'), sha('b')), /path outside job/, 'a path under another job is refused');
await fails(add('office', IU, 'S', 'T', `${B}/jobs/${IU}/x.pdf`, sha('c')), /path outside job/, 'a path under another company is refused');
await fails(add('iu', IU, 'S', 'T', pathFor(IU, 'f'), sha('d')), /insufficient scope/, 'field users cannot add documents');
await fails(add('other-office', IU, 'S', 'T', pathFor(IU, 'g'), sha('e')), /bad job/, 'another company cannot add to this job');
await fails(call('cs_portal_job_doc_add', ['office', IU, 'S', 'T', 'x.pdf', 'application/pdf', 1, 'nothex', null, pathFor(IU, 'h')]), /check/, 'checksum must be a sha256');
await add('office', C785, 'Field Operations', 'C785 doc', pathFor(C785, 'z'), sha('f'));

eq((await call('cs_portal_job_docs', ['iu', IU])).map((d) => d.title), ['Permit'], 'IU field user lists IU documents');
eq((await call('cs_portal_job_docs', ['multi-ticket-iu', IU])).length, 1, 'a multi-job user on an IU ticket lists them');
eq((await call('cs_portal_job_docs', ['office', IU])).length, 1, 'office lists them');
ok(!('path' in (await call('cs_portal_job_docs', ['iu', IU]))[0]), 'the list never exposes storage paths');
await fails(call('cs_portal_job_docs', ['c785', IU]), /not permitted/, 'a user without IU access cannot list IU documents');
await fails(call('cs_portal_job_docs', ['iu', C785]), /not permitted/, 'an IU user cannot list C785 documents');
await fails(call('cs_portal_job_docs', ['other-office', IU]), /not permitted/, 'another company cannot list them');
await fails(call('cs_portal_job_docs', ['expired', IU]), /invalid token/, 'an expired session cannot list them');
eq((await call('cs_portal_job_doc_path', ['iu', DOC])).path, pathFor(IU, 'a'), 'IU field user gets the file path (edge signs it)');
await fails(call('cs_portal_job_doc_path', ['c785', DOC]), /not permitted/, 'no path for a user without IU access');
await fails(call('cs_portal_job_doc_path', ['other-office', DOC]), /not permitted/, 'no path for another company');
await fails(call('cs_portal_job_doc_path', ['nope', DOC]), /invalid token/, 'no path without a session');

await fails(call('cs_portal_job_doc_archive', ['iu', DOC, true]), /insufficient scope/, 'field users cannot archive');
eq((await call('cs_portal_job_doc_archive', ['office', DOC, true])).ok, true, 'office archives');
eq((await call('cs_portal_job_docs', ['iu', IU])).length, 0, 'archived documents leave the list');
await fails(call('cs_portal_job_doc_path', ['iu', DOC]), /not found/, 'archived documents cannot be opened');
eq((await one(`select count(*)::int n from cs_job_docs where id = $1`, [DOC])).n, 1, 'archive never deletes');
eq((await call('cs_portal_job_doc_archive', ['office', DOC, false])).ok, true, 'office restores');
eq((await call('cs_portal_job_doc_archive', ['other-office', DOC, true])).ok, false, 'another company cannot archive');

const anon = async (sig) => (await one(`select has_function_privilege('anon', $1, 'execute') c`, [sig])).c;
ok(!(await anon('cs_job_doc_access(text, uuid)')), 'the access helper is not callable through the API');
ok(await anon('cs_portal_job_docs(text, uuid)'), 'listing is callable through the API');

console.log(`Job docs + crew SQL verification: ${checks} checks passed (in-memory Postgres, no Supabase).`);
