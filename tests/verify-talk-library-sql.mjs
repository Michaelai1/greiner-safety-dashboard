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
  other: '30000000-0000-4000-8000-000000000003', peine: '30000000-0000-4000-8000-000000000004',
  choiceFor: '30000000-0000-4000-8000-000000000005', peineWk: '30000000-0000-4000-8000-000000000006',
  choice: '30000000-0000-4000-8000-000000000009' };
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
    ('${D.peine}', '${GREINER}', 'Toolbox Talks', 'Peine Ladders.pdf', 'g/pl.pdf', 400),
    ('${D.choiceFor}', '${GREINER}', 'Toolbox Talks', 'Choice Trenching.pdf', 'g/ct.pdf', 500),
    ('${D.peineWk}', '${GREINER}', 'Toolbox Talks', 'Peine Cold Weather.pdf', 'g/pc.pdf', 600),
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
await check('the office files an uploaded document as a talk with a category (old 4-argument call): Greiner\'s, for Greiner', async () => {
  const r = (await one(db, `select cs_portal_tbt_library_add('office', '${D.fall}', '  Fall Protection ', 'Fall Protection') as r`)).r;
  assert.equal(r.ok, true); fallId = r.id;
  const row = await one(db, `select title, category, status, company_id, for_company from cs_tbt_library where id = $1`, [fallId]);
  assert.deepEqual(row, { title: 'Fall Protection', category: 'Fall Protection', status: 'received', company_id: GREINER, for_company: 'greiner' });
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
  assert.deepEqual(rows.map((x) => [x.category, x.title, x.filename, x.status, x.times_sent, x.last_week, x.for_company, 'companies' in x]), [
    ['Fall Protection', 'Fall Protection', 'Fall Protection.pdf', 'received', 0, null, 'greiner', false],
    ['Ladders', 'Step Ladder Safety', 'Step_Ladder_Safety.pdf', 'received', 0, null, 'greiner', false]]);
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
// ---- Nov 26: the week a talk was uploaded for ---------------------------------
const W = (await one(db, `select date_trunc('week', (now() at time zone 'America/Indiana/Indianapolis'))::date::text as w`)).w;
const wk = (n) => { const d = new Date(W + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7 * n); return d.toISOString().slice(0, 10); };
await check('the library table has a planned_week column that only takes a Monday', async () => {
  const c = await one(db, `select data_type, is_nullable from information_schema.columns where table_name = 'cs_tbt_library' and column_name = 'planned_week'`);
  assert.deepEqual(c, { data_type: 'date', is_nullable: 'YES' });
  await assert.rejects(db.exec(`update cs_tbt_library set planned_week = '${wk(1)}'::date + 2 where id = '${fallId}'`), /cs_tbt_library_week_monday/);
});
let weekId;
await check('"Upload for this week" files the talk with its week, Greiner\'s only, and the library returns the week', async () => {
  const r = (await one(db, `select cs_portal_tbt_library_add_week('office', '${D.other}', 'Arc Welding', 'Hot Work', '${wk(2)}') as r`)).r;
  assert.equal(r.ok, true); weekId = r.id;
  const row = await one(db, `select company_id, planned_week::text as w, status from cs_tbt_library where id = $1`, [weekId]);
  assert.deepEqual(row, { company_id: GREINER, w: wk(2), status: 'received' });
  const x = (await one(db, `select cs_portal_tbt_library('office') as r`)).r.find((y) => y.id === weekId);
  assert.equal(x.planned_week, wk(2));
  const plain = (await one(db, `select cs_portal_tbt_library('office') as r`)).r.find((y) => y.id === fallId);
  assert.equal(plain.planned_week, null);
});
await check('the week must be a Monday from this week up to 26 weeks ahead; the file must be this company\'s', async () => {
  const q = async (doc, w) => (await one(db, `select cs_portal_tbt_library_add_week('office', '${doc}', 'X', 'Y', ${w}) as r`)).r.error;
  assert.equal(await q(D.step, `'${wk(1)}'::date + 1`), 'bad_week');
  assert.equal(await q(D.step, 'null'), 'bad_week');
  assert.equal(await q(D.step, `'${wk(-1)}'`), 'week_out_of_range');
  assert.equal(await q(D.step, `'${wk(27)}'`), 'week_out_of_range');
  assert.equal(await q(D.choice, `'${wk(1)}'`), 'bad_doc');
  assert.equal((await one(db, 'select count(*)::int as n from cs_tbt_library')).n, 3);
});
await check('a talk can be moved to another week or have its week cleared; others cannot touch it', async () => {
  const set = async (tok, w) => (await one(db, `select cs_portal_tbt_library_week('${tok}', '${weekId}', ${w}) as r`)).r;
  assert.equal((await set('office', `'${wk(3)}'`)).ok, true);
  assert.equal((await one(db, `select planned_week::text as w from cs_tbt_library where id = $1`, [weekId])).w, wk(3));
  assert.equal((await set('office', `'${wk(3)}'::date + 3`)).error, 'bad_week');
  assert.equal((await set('office', `'${wk(-2)}'`)).error, 'week_out_of_range');
  assert.equal((await set('choice-office', `'${wk(1)}'`)).error, 'not_found');
  assert.equal((await set('office', 'null')).ok, true);
  assert.equal((await one(db, `select planned_week from cs_tbt_library where id = $1`, [weekId])).planned_week, null);
  for (const t of ['crew', 'nope']) {
    await assert.rejects(db.query(`select cs_portal_tbt_library_add_week($1, '${D.step}', 'S', 'L', '${wk(1)}')`, [t]), /insufficient scope|invalid token/);
    await assert.rejects(db.query(`select cs_portal_tbt_library_week($1, '${weekId}', '${wk(1)}')`, [t]), /insufficient scope|invalid token/);
  }
});
await check('every library function is callable by the browser roles, one argument list each (no ambiguous leftovers)', async () => {
  const r = await one(db, `select has_function_privilege('anon', 'public.cs_portal_tbt_library_add_week(text,uuid,text,text,date,text)', 'execute') as a,
    has_function_privilege('anon', 'public.cs_portal_tbt_library_week(text,uuid,date)', 'execute') as b,
    has_function_privilege('anon', 'public.cs_portal_tbt_library_add(text,uuid,text,text,text)', 'execute') as c,
    has_function_privilege('anon', 'public.cs_portal_tbt_library_set(text,uuid,text,text,boolean,text)', 'execute') as d,
    has_function_privilege('anon', 'public.cs_portal_tbt_library(text)', 'execute') as e,
    (select count(*)::int from pg_proc where proname like 'cs_portal_tbt_library%') as n`);
  assert.deepEqual(r, { a: true, b: true, c: true, d: true, e: true, n: 5 });
});
// ---- Nov 27: Tony uploads for Greiner, Peine and Choice from one page ------------
await check('for_company is a label column: not null, default greiner, only greiner, peine or choice', async () => {
  const c = await one(db, `select data_type, is_nullable, column_default from information_schema.columns where table_name = 'cs_tbt_library' and column_name = 'for_company'`);
  assert.deepEqual([c.data_type, c.is_nullable, /'greiner'/.test(c.column_default)], ['text', 'NO', true]);
  await assert.rejects(db.exec(`update cs_tbt_library set for_company = 'acme' where id = '${fallId}'`), /cs_tbt_library_for_check/);
  await assert.rejects(db.exec(`update cs_tbt_library set for_company = null where id = '${fallId}'`), /null/);
});
let peineId, choiceId, peineWkId;
await check('upload for Peine and for Choice (p_for): the row stays Greiner\'s, labelled for that company', async () => {
  const p = (await one(db, `select cs_portal_tbt_library_add('office', '${D.peine}', 'Peine Ladders', 'Ladders', 'peine') as r`)).r;
  const c = (await one(db, `select cs_portal_tbt_library_add('office', '${D.choiceFor}', 'Choice Trenching', 'Trenching', p_for => ' Choice ') as r`)).r;
  const w = (await one(db, `select cs_portal_tbt_library_add_week('office', '${D.peineWk}', 'Peine Cold Weather', 'Cold Weather', '${wk(1)}', 'peine') as r`)).r;
  assert.equal(p.ok && c.ok && w.ok, true); peineId = p.id; choiceId = c.id; peineWkId = w.id;
  const rows = (await db.query(`select id, company_id, for_company, planned_week::text as w from cs_tbt_library where id in ($1, $2, $3) order by title`, [peineId, choiceId, peineWkId])).rows;
  assert.deepEqual(rows.map((x) => [x.company_id, x.for_company, x.w]),
    [[GREINER, 'choice', null], [GREINER, 'peine', wk(1)], [GREINER, 'peine', null]]);
  const lib = (await one(db, `select cs_portal_tbt_library('office') as r`)).r;
  assert.equal(lib.find((x) => x.id === peineWkId).for_company, 'peine');
  assert.equal(lib.find((x) => x.id === choiceId).for_company, 'choice');
});
await check('an unknown company is refused and nothing is filed; null means Greiner', async () => {
  const n = (await one(db, 'select count(*)::int as n from cs_tbt_library')).n;
  assert.equal((await one(db, `select cs_portal_tbt_library_add('office', '${D.step}', 'X', 'Y', 'acme') as r`)).r.error, 'bad_company');
  assert.equal((await one(db, `select cs_portal_tbt_library_add_week('office', '${D.step}', 'X', 'Y', '${wk(1)}', '') as r`)).r.error, 'bad_company');
  assert.equal((await one(db, `select cs_portal_tbt_library_set('office', '${peineId}', p_for => 'acme') as r`)).r.error, 'bad_company');
  assert.equal((await one(db, 'select count(*)::int as n from cs_tbt_library')).n, n);
  assert.equal((await one(db, `select for_company from cs_tbt_library where id = $1`, [peineId])).for_company, 'peine');
});
await check('the change function can move a talk to another company; leaving p_for out keeps it', async () => {
  assert.equal((await one(db, `select cs_portal_tbt_library_set('office', '${choiceId}', p_for => 'peine') as r`)).r.ok, true);
  assert.equal((await one(db, `select for_company from cs_tbt_library where id = $1`, [choiceId])).for_company, 'peine');
  assert.equal((await one(db, `select cs_portal_tbt_library_set('office', '${choiceId}', 'Choice Trenching', 'Trenching', null) as r`)).r.ok, true);
  assert.equal((await one(db, `select for_company from cs_tbt_library where id = $1`, [choiceId])).for_company, 'peine', 'old 5-argument call leaves it');
  await db.query(`select cs_portal_tbt_library_set('office', '${choiceId}', p_for => 'choice')`);
  assert.equal((await one(db, `select for_company from cs_tbt_library where id = $1`, [choiceId])).for_company, 'choice');
  assert.equal((await one(db, `select cs_portal_tbt_library_set('choice-office', '${choiceId}', p_for => 'greiner') as r`)).r.error, 'not_found');
});
await check('old argument lists still work by name, the way the office page calls them (no p_for)', async () => {
  const before = (await one(db, 'select count(*)::int as n from cs_tbt_library')).n;
  await db.exec(`insert into cs_company_docs (id, company_id, category, filename, path) values
    ('30000000-0000-4000-8000-0000000000a1', '${GREINER}', 'Toolbox Talks', 'Old Call.pdf', 'g/old.pdf'),
    ('30000000-0000-4000-8000-0000000000a2', '${GREINER}', 'Toolbox Talks', 'Old Week.pdf', 'g/oldw.pdf')`);
  const a = (await one(db, `select cs_portal_tbt_library_add(p_token => 'office', p_doc_id => '30000000-0000-4000-8000-0000000000a1', p_title => 'Old Call', p_category => 'General Safety') as r`)).r;
  const b = (await one(db, `select cs_portal_tbt_library_add_week(p_token => 'office', p_doc_id => '30000000-0000-4000-8000-0000000000a2', p_title => 'Old Week', p_category => 'General Safety', p_week => '${wk(2)}') as r`)).r;
  const c = (await one(db, `select cs_portal_tbt_library_set(p_token => 'office', p_id => '${a.id}', p_title => 'Old Call Renamed') as r`)).r;
  assert.equal(a.ok && b.ok && c.ok, true);
  const rows = (await db.query(`select title, for_company from cs_tbt_library where id in ($1, $2) order by title`, [a.id, b.id])).rows;
  assert.deepEqual(rows, [{ title: 'Old Call Renamed', for_company: 'greiner' }, { title: 'Old Week', for_company: 'greiner' }]);
  assert.equal((await one(db, 'select count(*)::int as n from cs_tbt_library')).n, before + 2);
  for (const t of ['crew', 'nope']) {
    await assert.rejects(db.query(`select cs_portal_tbt_library_add($1, '${D.step}', 'S', 'L', 'peine')`, [t]), /insufficient scope|invalid token/);
  }
});
await check('a Peine or Choice talk never counts Greiner\'s sends, even if it carries the same talk key', async () => {
  await db.exec(`update cs_tbt_library set status = 'ready', talk_key = 'fall-protection' where id = '${peineId}'`);
  const x = (await one(db, `select cs_portal_tbt_library('office') as r`)).r.find((y) => y.id === peineId);
  assert.equal(x.times_sent, 0); assert.equal(x.last_week, null);
});
await check('another company\'s office still sees none of the Peine or Choice uploads', async () => {
  assert.deepEqual((await one(db, `select cs_portal_tbt_library('choice-office') as r`)).r, []);
});
await check('an install over an earlier draft (argument lists without p_for) leaves one function each, and calls are not ambiguous', async () => {
  const d2 = new PGlite({ extensions: { pgcrypto } });
  await d2.exec(fs.readFileSync(FIXTURE, 'utf8')); await d2.exec(STANDINS); await d2.exec(SEED);
  const old = fs.readFileSync(MIGRATION, 'utf8')
    .replace(/, p_for text default 'greiner'/g, '').replace(/, p_for text default null/g, '')
    .replace(/\(text, uuid, text, text, text\)/g, '(text, uuid, text, text)')
    .replace(/\(text, uuid, text, text, boolean, text\)/g, '(text, uuid, text, text, boolean)')
    .replace(/\(text, uuid, text, text, date, text\)/g, '(text, uuid, text, text, date)')
    .replace(/drop function if exists[^\n]*\n/g, '')
    .replace(/v_for := case when p_for[\s\S]*?end;/g, "v_for := 'greiner';");
  await d2.exec(old);
  assert.equal((await one(d2, `select count(*)::int as n from pg_proc where proname like 'cs_portal_tbt_library%'`)).n, 5, 'the stand-in old draft installed');
  assert.ok(await one(d2, `select to_regprocedure('public.cs_portal_tbt_library_add(text,uuid,text,text)') as f`).then((x) => x.f));
  await d2.exec(fs.readFileSync(MIGRATION, 'utf8'));
  assert.equal((await one(d2, `select count(*)::int as n from pg_proc where proname like 'cs_portal_tbt_library%'`)).n, 5);
  const r = (await one(d2, `select cs_portal_tbt_library_add('office', '${D.fall}', 'Fall', 'Fall Protection') as r`)).r;
  assert.equal(r.ok, true);
  await d2.close();
});
await check('installing again keeps every planned week', async () => {
  await db.query(`select cs_portal_tbt_library_week('office', '${weekId}', '${wk(4)}')`);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  assert.equal((await one(db, `select planned_week::text as w from cs_tbt_library where id = $1`, [weekId])).w, wk(4));
});
await check('after all of that, every talk record and send is still exactly as it was', async () => {
  assert.equal(await snap(db), before); assert.equal(await fnDefs(db), fnBefore);
});
await db.close();
if (failures) { console.log(`Talk Library SQL verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`Talk Library SQL verification passed (${checks} checks, local database only).`);
