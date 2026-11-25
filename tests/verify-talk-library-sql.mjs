/* Talk Library, server side, in PGlite: the draft sql/2026-11-25-tbt-talk-library.sql on top of the live talk
 * tables (tests/fixtures/tbt-live-2026-10-29.sql, read from production Oct 29) plus small stand-ins for the
 * two things that fixture does not carry: cs_company_docs and cs_portal_cid(token, scope).
 *
 * Fictional talks and sessions. Nothing leaves the machine. Needs PGLITE_NODE_MODULES; skips cleanly without it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('../', import.meta.url).pathname);
const FIXTURE = path.join(ROOT, 'tests/fixtures/tbt-live-2026-10-29.sql');
const MIGRATION = path.join(ROOT, 'sql/2026-11-25-tbt-talk-library.sql');
let PGlite, pgcrypto;
try {
  const preq = createRequire(path.join(process.env.PGLITE_NODE_MODULES || '/nonexistent', 'noop.js'));
  ({ PGlite } = await import(pathToFileURL(preq.resolve('@electric-sql/pglite')).href));
  ({ pgcrypto } = await import(pathToFileURL(preq.resolve('@electric-sql/pglite/contrib/pgcrypto')).href));
} catch {
  console.log('Talk Library SQL verification skipped (set PGLITE_NODE_MODULES).');
  process.exit(0);
}
const GREINER = '8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2', CHOICE = '3da7dc46-30d3-4870-bbd9-a85bd2227a3c';
const D = { fall: '30000000-0000-4000-8000-000000000001', step: '30000000-0000-4000-8000-000000000002',
  other: '30000000-0000-4000-8000-000000000003', choice: '30000000-0000-4000-8000-000000000009' };
const STANDINS = `
  create table cs_company_docs (id uuid primary key default gen_random_uuid(), company_id uuid not null references cs_companies(id),
    category text, filename text not null, path text not null, size_bytes bigint, created_at timestamptz not null default now());
  create or replace function public.cs_portal_cid(p_token text, p_scope text) returns uuid
  language plpgsql stable security definer set search_path = public as $$
  declare s cs_portal_sessions;
  begin
    select * into s from cs_portal_sessions where token = p_token and expires_at > now();
    if not found then raise exception 'invalid token'; end if;
    if p_scope = 'full' and s.scope <> 'full' then raise exception 'insufficient scope'; end if;
    return s.company_id;
  end $$;`;
const SEED = `
  insert into cs_companies (id, name) values ('${GREINER}', 'Greiner Brothers'), ('${CHOICE}', 'Choice');
  insert into cs_portals (slug, company_id) values ('greiner', '${GREINER}');
  insert into cs_portal_sessions (token, company_id, scope, slug, expires_at) values
    ('office', '${GREINER}', 'full', 'greiner', now() + interval '1 day'),
    ('crew', '${GREINER}', 'field', 'greiner', now() + interval '1 day'),
    ('choice-office', '${CHOICE}', 'full', 'choice', now() + interval '1 day');
  insert into cs_company_docs (id, company_id, category, filename, path, size_bytes) values
    ('${D.fall}', '${GREINER}', 'Toolbox Talks', 'Fall Protection.pdf', 'g/fall.pdf', 1000),
    ('${D.step}', '${GREINER}', 'Toolbox Talks', 'Step_Ladder_Safety.pdf', 'g/step.pdf', 2000),
    ('${D.other}', '${GREINER}', 'Toolbox Talks', 'Arc Welding.pdf', 'g/arc.pdf', 3000),
    ('${D.choice}', '${CHOICE}', 'Toolbox Talks', 'Choice only.pdf', 'c/x.pdf', 10);`;

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
const snap = async (db) => JSON.stringify([
  (await db.query('select * from cs_tbt_assignments order by id')).rows,
  (await db.query('select * from cs_tbt_sends order by id')).rows,
  (await db.query('select * from cs_tbt_email_links order by id')).rows]);
const fnDefs = async (db) => JSON.stringify((await db.query(
  `select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
     and p.proname not like 'cs_portal_tbt_library%' order by 1`)).rows);

// ---- wrong project ---------------------------------------------------------
{
  const db = new PGlite({ extensions: { pgcrypto } });
  await check('refuses to install where the Greiner talk tables are missing, and changes nothing', async () => {
    await assert.rejects(db.exec(fs.readFileSync(MIGRATION, 'utf8')), /WRONG PROJECT/);
    await db.exec('rollback');
    const r = await one(db, `select to_regclass('public.cs_tbt_library') as t`);
    assert.equal(r.t, null);
  });
  await db.close();
}

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(FIXTURE, 'utf8'));
await db.exec(STANDINS);
await check('refuses to install where there is no "greiner" portal', async () => {
  await assert.rejects(db.exec(fs.readFileSync(MIGRATION, 'utf8')), /WRONG PROJECT/);
  await db.exec('rollback');
});
await db.exec(SEED);
// A real-looking sent talk, so "last sent" has something to read and "nothing changed" has something to compare.
await db.exec(`
  insert into cs_tbt_assignments (company_id, talk_key, talk_title, recipient_name, recipient_phone, week_start, is_test,
      token_hash, token_prefix, expires_at, role) values
    ('${GREINER}', 'fall-protection', 'Fall Protection', 'Foreman One (Test)', '+15555550101', '2026-11-23', false, repeat('a', 64), 'p1', now() + interval '7 day', 'leader'),
    ('${GREINER}', 'fall-protection', 'Fall Protection', 'Foreman Two (Test)', '+15555550102', '2026-10-05', false, repeat('b', 64), 'p2', now() + interval '7 day', 'leader'),
    ('${GREINER}', 'fall-protection', 'Fall Protection', 'Office Copy (Test)', '+15555550103', '2026-11-30', true, repeat('c', 64), 'p3', now() + interval '7 day', 'participant');`);
const before = await snap(db), fnBefore = await fnDefs(db);

await check('installs, and installs a second time without error', async () => {
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
});
await check('the install left every talk record, send and existing function exactly as it was', async () => {
  assert.equal(await snap(db), before); assert.equal(await fnDefs(db), fnBefore);
});
await check('the table is closed to the browser roles; only the three functions are callable', async () => {
  const r = await one(db, `select relrowsecurity as rls,
    has_table_privilege('anon', 'public.cs_tbt_library', 'select') as a,
    has_table_privilege('authenticated', 'public.cs_tbt_library', 'select,insert,update,delete') as b
    from pg_class where oid = 'public.cs_tbt_library'::regclass`);
  assert.deepEqual(r, { rls: true, a: false, b: false });
});
let fallId;
await check('the office files an uploaded document as a talk with a category; it belongs to Greiner only', async () => {
  const r = (await one(db, `select cs_portal_tbt_library_add('office', '${D.fall}', '  Fall Protection ', 'Fall Protection') as r`)).r;
  assert.equal(r.ok, true); fallId = r.id;
  const row = await one(db, `select title, category, status, company_id from cs_tbt_library where id = $1`, [fallId]);
  assert.deepEqual(row, { title: 'Fall Protection', category: 'Fall Protection', status: 'received', company_id: GREINER });
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'cs_tbt_library'`)).rows.map((x) => x.column_name);
  assert.ok(!cols.includes('companies'), 'no "which companies" list: each upload is Greiner\'s');
  await assert.rejects(db.query(`select cs_portal_tbt_library_add('office', '${D.step}', 'Step', 'Ladders', array['greiner','choice'])`), /does not exist/);
});
await check('filing the same file twice gives back the same talk, not a duplicate', async () => {
  const r = (await one(db, `select cs_portal_tbt_library_add('office', '${D.fall}', 'Again', 'Ladders') as r`)).r;
  assert.equal(r.id, fallId); assert.equal(r.existing, true);
  assert.equal((await one(db, 'select count(*)::int as n from cs_tbt_library')).n, 1);
});
await check('a talk needs a name, a category and a file of this company', async () => {
  const q = async (sql) => (await one(db, `select ${sql} as r`)).r.error;
  assert.equal(await q(`cs_portal_tbt_library_add('office', '${D.step}', ' ', 'Ladders')`), 'title_required');
  assert.equal(await q(`cs_portal_tbt_library_add('office', '${D.step}', 'Step', '')`), 'category_required');
  assert.equal(await q(`cs_portal_tbt_library_add('office', '${D.choice}', 'Step', 'Ladders')`), 'bad_doc');
  assert.equal(await q(`cs_portal_tbt_library_add('office', null, 'Step', 'Ladders')`), 'bad_doc');
  assert.equal((await one(db, 'select count(*)::int as n from cs_tbt_library')).n, 1);
});
await check('a crew sign-in, a signed-out token and no token are all refused', async () => {
  for (const t of ['crew', 'nope', '']) {
    await assert.rejects(db.query(`select cs_portal_tbt_library($1)`, [t]), /insufficient scope|invalid token/);
    await assert.rejects(db.query(`select cs_portal_tbt_library_add($1, '${D.step}', 'Step', 'Ladders')`, [t]), /insufficient scope|invalid token/);
    await assert.rejects(db.query(`select cs_portal_tbt_library_set($1, '${fallId}', p_archived => true)`, [t]), /insufficient scope|invalid token/);
  }
});
await check('the library lists the talk with its file; "last sent" is empty until the phone version is linked', async () => {
  await db.query(`select cs_portal_tbt_library_add('office', '${D.step}', 'Step Ladder Safety', 'Ladders')`);
  const rows = (await one(db, `select cs_portal_tbt_library('office') as r`)).r;
  assert.deepEqual(rows.map((x) => [x.category, x.title, x.filename, x.status, x.times_sent, x.last_week, 'companies' in x]), [
    ['Fall Protection', 'Fall Protection', 'Fall Protection.pdf', 'received', 0, null, false],
    ['Ladders', 'Step Ladder Safety', 'Step_Ladder_Safety.pdf', 'received', 0, null, false]]);
  assert.ok(!JSON.stringify(rows).includes('g/fall.pdf'), 'the storage path is never returned');
});
await check('once the owner links the phone version it reads Ready, with real sends counted and tests left out', async () => {
  await assert.rejects(db.exec(`update cs_tbt_library set status = 'ready' where id = '${fallId}'`), /cs_tbt_library_ready_check/);
  await db.exec(`update cs_tbt_library set status = 'ready', talk_key = 'fall-protection' where id = '${fallId}'`);
  const x = (await one(db, `select cs_portal_tbt_library('office') as r`)).r[0];
  assert.equal(x.status, 'ready'); assert.equal(x.times_sent, 2); assert.equal(x.last_week, '2026-11-23');
});
await check('another company\'s office sees none of it and cannot change it', async () => {
  assert.deepEqual((await one(db, `select cs_portal_tbt_library('choice-office') as r`)).r, []);
  assert.equal((await one(db, `select cs_portal_tbt_library_set('choice-office', '${fallId}', p_archived => true) as r`)).r.error, 'not_found');
});
await check('rename and re-file; an untouched field stays as it was', async () => {
  const r = (await one(db, `select cs_portal_tbt_library_set('office', '${fallId}', p_category => 'Working at Height') as r`)).r;
  assert.equal(r.ok, true);
  const row = await one(db, `select title, category, talk_key from cs_tbt_library where id = $1`, [fallId]);
  assert.deepEqual(row, { title: 'Fall Protection', category: 'Working at Height', talk_key: 'fall-protection' });
  assert.equal((await one(db, `select cs_portal_tbt_library_set('office', '${fallId}', p_title => '  ') as r`)).r.error, 'title_required');
});
await check('removing hides the talk but deletes nothing; the stored file cannot be deleted from under a talk', async () => {
  await db.query(`select cs_portal_tbt_library_set('office', '${fallId}', p_archived => true)`);
  assert.equal((await one(db, `select cs_portal_tbt_library('office') as r`)).r.length, 1);
  assert.equal((await one(db, 'select count(*)::int as n from cs_tbt_library')).n, 2);
  await assert.rejects(db.exec(`delete from cs_company_docs where id = '${D.fall}'`), /foreign key/);
  await db.query(`select cs_portal_tbt_library_set('office', '${fallId}', p_archived => false)`);
  assert.equal((await one(db, `select cs_portal_tbt_library('office') as r`)).r.length, 2);
});
await check('after all of that, every talk record and send is still exactly as it was', async () => {
  assert.equal(await snap(db), before); assert.equal(await fnDefs(db), fnBefore);
});
await db.close();
if (failures) { console.log(`Talk Library SQL verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`Talk Library SQL verification passed (${checks} checks, local database only).`);
