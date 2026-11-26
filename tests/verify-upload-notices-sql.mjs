/* Upload notices, server side, in PGlite: sql/2026-11-25-upload-notices.sql (+ switch-on and rollback) on top of
 * the live talk tables fixture (tests/fixtures/tbt-live-2026-10-29.sql), the Talk Library draft, and small
 * stand-ins for what the fixture does not carry: cs_company_docs, cs_job_docs, cs_portal_cid, cs_program_settings
 * (the Pipeline email settings), pg_net (net.http_post only records the request here), Vault and pg_cron.
 *
 * Made-up files and people. Nothing leaves the machine. Needs PGLITE_NODE_MODULES; skips cleanly without it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('../', import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FIXTURE = read('tests/fixtures/tbt-live-2026-10-29.sql');
const LIBRARY = read('sql/2026-11-25-tbt-talk-library.sql');
const NOTICES = read('sql/2026-11-25-upload-notices.sql');
const SWITCH_ON = read('sql/2026-11-25-upload-notices-switch-on.sql');
const ROLLBACK = read('sql/2026-11-25-talks-and-notices-rollback.sql');
const PRECHECK = read('sql/2026-11-25-talks-precheck.READONLY.sql');
let PGlite, pgcrypto;
try {
  const preq = createRequire(path.join(process.env.PGLITE_NODE_MODULES || '/nonexistent', 'noop.js'));
  ({ PGlite } = await import(pathToFileURL(preq.resolve('@electric-sql/pglite')).href));
  ({ pgcrypto } = await import(pathToFileURL(preq.resolve('@electric-sql/pglite/contrib/pgcrypto')).href));
} catch {
  console.log('Upload notices SQL verification skipped (set PGLITE_NODE_MODULES).');
  process.exit(0);
}
const GREINER = '8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2', CHOICE = '3da7dc46-30d3-4870-bbd9-a85bd2227a3c';
const TESTCO = '7e570000-0000-4000-8000-000000000001';
const JOB = '40000000-0000-4000-8000-000000000001';
const HOOK = 'https://example.invalid/webhook/stand-in';
const DOCS_TABLES = `
  create table cs_program_settings (company_id uuid, key text, value jsonb, primary key (company_id, key));
  create table cs_company_docs (id uuid primary key default gen_random_uuid(), company_id uuid not null references cs_companies(id),
    category text, filename text not null, path text not null, size_bytes bigint, created_at timestamptz not null default now());
  create table cs_job_docs (id uuid primary key default gen_random_uuid(), company_id uuid not null references cs_companies(id),
    job_id uuid not null references cs_jobs(id), section text not null, title text not null, filename text not null,
    mime text not null default 'application/pdf', size_bytes bigint not null, sha256 text not null, source_date text,
    path text not null unique, created_at timestamptz not null default now(), created_by text, archived_at timestamptz,
    unique (job_id, sha256));
  create or replace function public.cs_portal_cid(p_token text, p_scope text) returns uuid
  language plpgsql stable security definer set search_path = public as $$
  declare s cs_portal_sessions;
  begin
    select * into s from cs_portal_sessions where token = p_token and expires_at > now();
    if not found then raise exception 'invalid token'; end if;
    if p_scope = 'full' and s.scope <> 'full' then raise exception 'insufficient scope'; end if;
    return s.company_id;
  end $$;`;
const PLATFORM = `
  create schema if not exists net;
  create table net.requests (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds int);
  create table net._http_response (id bigint primary key, status_code int, content text, timed_out boolean, error_msg text,
    created timestamptz default now());
  create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
    headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as
    $$ insert into net.requests (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds) returning id $$;
  create schema if not exists vault;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
  insert into vault.decrypted_secrets values ('cs_pipeline_email_key', 'Bearer local-test-value');
  create schema if not exists cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
       on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
  create or replace function cron.unschedule(job_id bigint) returns boolean language sql as
    $$ delete from cron.job where jobid = job_id returning true $$;
`;
const SEED = `
  insert into cs_companies (id, name) values ('${GREINER}', 'Greiner Brothers'), ('${CHOICE}', 'Choice'), ('${TESTCO}', 'zz Pipeline TEST');
  insert into cs_portals (slug, company_id) values ('greiner', '${GREINER}');
  insert into cs_jobs (id, company_id, job_number, name) values ('${JOB}', '${GREINER}', 'C800-2025', 'Purdue Academic Bldg.');
  insert into cs_portal_sessions (token, company_id, scope, slug, expires_at) values
    ('office', '${GREINER}', 'full', 'greiner', now() + interval '1 day');
  insert into cs_program_settings values
    ('${TESTCO}', 'notify_provider_url', '"${HOOK}"'), ('${TESTCO}', 'notify_secret_name', '"cs_pipeline_email_key"'),
    ('${TESTCO}', 'notify_email_to', '"someone-else@example.invalid"');`;

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
const n = async (db, q) => (await one(db, `select count(*)::int as n from ${q}`)).n;
const fnDefs = async (db) => JSON.stringify((await db.query(
  `select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h from pg_proc p
    join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prokind = 'f'
     and p.proname not like 'cs_upload_notice%' order by 1`)).rows);
const snap = async (db) => JSON.stringify([
  (await db.query('select * from cs_tbt_assignments order by id')).rows,
  (await db.query('select * from cs_tbt_sends order by id')).rows,
  (await db.query('select * from cs_tbt_library order by id')).rows]);
// Pretend time passed: notices are only emailed once they are 2 minutes old.
const age = (db) => db.exec(`update cs_upload_notices set created_at = created_at - interval '3 minutes'`);
const send = async (db) => (await one(db, 'select cs_upload_notice_send() as r')).r;
const addDoc = (db, co, cat, file) => db.query(
  `insert into cs_company_docs (company_id, category, filename, path, size_bytes) values ($1, $2, $3, $4, 10) returning id`,
  [co, cat, file, co + '/' + file]).then((r) => r.rows[0].id);

// ---- wrong project / wrong order --------------------------------------------
{
  const db = new PGlite({ extensions: { pgcrypto } });
  await check('refuses to install where the Greiner document tables are missing, and changes nothing', async () => {
    await assert.rejects(db.exec(NOTICES), /WRONG PROJECT/);
    await db.exec('rollback');
    assert.equal((await one(db, `select to_regclass('public.cs_upload_notices') as t`)).t, null);
  });
  await db.close();
}
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(FIXTURE); await db.exec(DOCS_TABLES); await db.exec(SEED);
await check('refuses to install before the Talk Library is installed', async () => {
  await assert.rejects(db.exec(NOTICES), /Install the Talk Library first/);
  await db.exec('rollback');
});
await db.exec(LIBRARY);
await check('refuses to install where pg_net or Vault is missing (not the live project)', async () => {
  await assert.rejects(db.exec(NOTICES), /pg_net or Vault is missing/);
  await db.exec('rollback');
  assert.equal((await one(db, `select to_regclass('public.cs_upload_notices') as t`)).t, null);
});
await db.exec(PLATFORM);
await check('the read-only pre-check runs here and changes nothing', async () => {
  const fixtureLacksVaultSecrets = `create view vault.secrets as select name, now() as created_at from vault.decrypted_secrets;`;
  await db.exec(fixtureLacksVaultSecrets);
  const before = await fnDefs(db);
  const rows = (await db.query(PRECHECK)).rows;
  assert.equal(await fnDefs(db), before);
  assert.equal(rows.length, 12, 'one result table, one row per question');
  const ans = Object.fromEntries(rows.map((r) => [r.check_name, r.answer]));
  assert.match(ans['01 right project'], /greiner_portal=1 company_docs=true job_docs=true talk_sender=true pg_net=true pg_cron=true vault=true/);
  assert.match(ans['02 new names free'], /library_table=true notices_table=false/);
  assert.match(ans['03 cs_company_docs columns'], /^id uuid not null, company_id uuid not null, category text/);
  assert.equal(ans['05 cs_portal_doc_add body'], 'missing');
  assert.match(ans['08 pipeline email settings'], /notify_provider_url=https:/);
  assert.ok(!/someone-else@/.test(JSON.stringify(rows)), 'no email address is printed');
  assert.equal(ans['09 vault secret by name'], '1 named cs_pipeline_email_key');
  assert.ok(/^nothing scheduled yet$|^\d{4}-\d{2}-\d{2} /.test(ans['12 greiner weeks ahead, already scheduled']), ans['12 greiner weeks ahead, already scheduled']);
  assert.ok(!/\+1555|recipient/.test(ans['12 greiner weeks ahead, already scheduled']), 'talk names and counts only');
  assert.ok(!/insert |update |delete |drop |create |alter /i.test(PRECHECK.replace(/--.*$/gm, '')), 'pre-check only reads');
});
await db.exec(`insert into cs_tbt_assignments (company_id, talk_key, talk_title, recipient_name, recipient_phone, week_start, is_test,
    token_hash, token_prefix, expires_at, role) values
  ('${GREINER}', 'fall-protection', 'Fall Protection', 'Foreman One (Test)', '+15555550101', '2026-11-23', false, repeat('a', 64), 'p1', now() + interval '7 day', 'leader');`);
const docBefore = await addDoc(db, GREINER, 'Other', 'Before install.pdf');
const before = await snap(db), fnBefore = await fnDefs(db);

await check('installs, and installs a second time without error', async () => {
  await db.exec(NOTICES); await db.exec(NOTICES);
});
await check('the install changed no talk record, send, library row or existing function, and recorded nothing old', async () => {
  assert.equal(await snap(db), before); assert.equal(await fnDefs(db), fnBefore);
  assert.equal(await n(db, 'cs_upload_notices'), 0);
  assert.equal(await n(db, `cs_company_docs where id = '${docBefore}'`), 1);
});
await check('email is OFF after install; the Pipeline webhook address and Vault secret name were copied, no key stored', async () => {
  const s = await one(db, 'select email_on, email_to, provider_url, auth_header, secret_name from cs_upload_notice_settings');
  assert.deepEqual(s, { email_on: false, email_to: null, provider_url: HOOK, auth_header: 'Authorization', secret_name: 'cs_pipeline_email_key' });
  assert.ok(!/local-test-value/.test(JSON.stringify((await db.query('select * from cs_upload_notice_settings')).rows)));
  assert.ok(!/n8n\.cloud|webhook\/greiner|@gmail|@confirmsafety|@greinerbrothers/i.test(NOTICES + SWITCH_ON), 'no key, webhook or inbox in the files');
});
await check('the browser roles cannot read the notices or settings, or run the sender', async () => {
  const r = await one(db, `select has_table_privilege('anon', 'public.cs_upload_notices', 'select') as a,
    has_table_privilege('authenticated', 'public.cs_upload_notice_settings', 'select') as b,
    has_function_privilege('anon', 'public.cs_upload_notice_send()', 'execute') as c,
    has_function_privilege('authenticated', 'public.cs_upload_notice_send()', 'execute') as d`);
  assert.deepEqual(r, { a: false, b: false, c: false, d: false });
});

let otherId, talkDocId;
await check('a Greiner upload in Documents > Other is recorded with its folder and file name', async () => {
  otherId = await addDoc(db, GREINER, 'Other', 'Near Miss Form.pdf');
  const r = await one(db, `select kind, title, folder, file_name, email_status from cs_upload_notices where source_id = $1`, [otherId]);
  assert.deepEqual(r, { kind: 'document', title: 'Near Miss Form.pdf', folder: 'Other', file_name: 'Near Miss Form.pdf', email_status: 'waiting' });
});
await check('a job document is recorded with the job name, section and who uploaded it', async () => {
  const id = (await one(db, `insert into cs_job_docs (company_id, job_id, section, title, filename, size_bytes, sha256, path, created_by)
    values ($1, $2, 'Forms to convert', 'Incident Report', 'Incident_Report.pdf', 10, repeat('d', 64), $3, 'Office (Test)') returning id`,
    [GREINER, JOB, GREINER + '/jobs/' + JOB + '/x.pdf'])).id;
  const r = await one(db, `select kind, title, folder, job_name, uploaded_by from cs_upload_notices where source_id = $1`, [id]);
  assert.deepEqual(r, { kind: 'job_document', title: 'Incident Report', folder: 'Forms to convert', job_name: 'Purdue Academic Bldg.', uploaded_by: 'Office (Test)' });
});
await check('a Talk Library upload is recorded once (the file), and the talk name and category are filled in later', async () => {
  talkDocId = await addDoc(db, GREINER, 'Toolbox Talks', 'Step_Ladder_Safety.pdf');
  const r = (await one(db, `select cs_portal_tbt_library_add('office', $1, 'Step Ladder Safety', 'Ladders') as r`, [talkDocId])).r;
  assert.equal(r.ok, true);
  assert.equal(await n(db, `cs_upload_notices where source_id = '${talkDocId}'`), 1);
});
await check('Choice, the Pipeline test company and other Creekside companies are never recorded', async () => {
  await addDoc(db, CHOICE, 'Other', 'Choice file.pdf'); await addDoc(db, TESTCO, 'Other', 'Test co file.pdf');
  assert.equal(await n(db, `cs_upload_notices where company_id <> '${GREINER}'`), 0);
  assert.equal(await n(db, 'cs_upload_notices'), 3);
});
await check('with email OFF the sender sends nothing and keeps every notice waiting', async () => {
  await age(db);
  const r = await send(db);
  assert.equal(r.sent, 0); assert.equal(r.why, 'email is off');
  assert.equal(await n(db, 'net.requests'), 0);
  assert.equal(await n(db, `cs_upload_notices where email_status = 'waiting'`), 3);
});
await check('the switch-on file refuses until the EDIT line has a real address, and changes nothing', async () => {
  await assert.rejects(db.exec(SWITCH_ON), /Put your email address/);
  await db.exec('rollback');
  assert.equal((await one(db, 'select email_on from cs_upload_notice_settings')).email_on, false);
  assert.equal(await n(db, `cron.job where jobname = 'cs-upload-notices'`), 0);
});
await check('switch-on with an address turns email on and schedules the sender every 10 minutes', async () => {
  await db.exec(SWITCH_ON.replace('PUT-YOUR-EMAIL-HERE', 'owner@example.invalid'));
  const j = await one(db, `select schedule, command from cron.job where jobname = 'cs-upload-notices'`);
  assert.deepEqual(j, { schedule: '*/10 * * * *', command: 'select public.cs_upload_notice_send()' });
  assert.equal((await one(db, 'select email_on from cs_upload_notice_settings')).email_on, true);
});
let firstReq;
await check('one run sends ONE email listing all three uploads, to the chosen inbox, through the Pipeline webhook', async () => {
  const r = await send(db);
  assert.equal(r.sent, 3); firstReq = r.request_id;
  assert.equal(await n(db, 'net.requests'), 1);
  const q = await one(db, 'select url, body, headers from net.requests');
  assert.equal(q.url, HOOK);
  assert.deepEqual(q.body.to, ['owner@example.invalid']);
  assert.equal(q.body.subject, 'Greiner office: 3 new uploads');
  assert.equal(q.headers.Authorization, 'Bearer local-test-value', 'a stored "Bearer ..." value is sent as it is');
  assert.match(q.body.text, /Documents > Other \| Near Miss Form\.pdf/);
  assert.match(q.body.text, /Jobs > Purdue Academic Bldg\. > Job documents > Forms to convert \| Incident Report \(Incident_Report\.pdf\)/);
  assert.match(q.body.text, /Toolbox Talks > Talk Library > Ladders \| Step Ladder Safety \(Step_Ladder_Safety\.pdf\)/);
  assert.match(q.body.html, /Open the office page/);
  if (process.env.EMAIL_HTML_OUT) fs.writeFileSync(process.env.EMAIL_HTML_OUT, q.body.html);
  assert.equal(await n(db, `cs_upload_notices where email_status = 'handed_over' and request_id = ${firstReq}`), 3);
});
await check('a file uploaded less than 2 minutes ago waits for the next run; nothing is emailed twice', async () => {
  await addDoc(db, GREINER, 'Safety Program', 'Fresh <upload> & co.pdf');
  const r = await send(db);
  assert.equal(r.sent, 0); assert.equal(await n(db, 'net.requests'), 1);
});
await check('when the email service answers 200 the batch reads "accepted"', async () => {
  await db.exec(`insert into net._http_response (id, status_code) values (${firstReq}, 200)`);
  await age(db);
  const r = await send(db);
  assert.equal(r.accepted, 3); assert.equal(r.sent, 1);
  assert.equal(await n(db, `cs_upload_notices where email_status = 'accepted'`), 3);
  const q = await one(db, 'select body from net.requests order by id desc limit 1');
  assert.match(q.body.html, /Fresh &lt;upload&gt; &amp; co\.pdf/, 'file names are escaped in the email');
});
await check('a refused email is tried again, and after 3 tries is marked failed (never silently lost)', async () => {
  for (let i = 0; i < 3; i++) {
    const req = (await one(db, `select request_id from cs_upload_notices where email_status = 'handed_over'`)).request_id;
    await db.exec(`insert into net._http_response (id, status_code) values (${req}, 500)`);
    await send(db);
  }
  const r = await one(db, `select email_status, attempts, email_note from cs_upload_notices where title like 'Fresh%'`);
  assert.equal(r.email_status, 'failed'); assert.equal(r.attempts, 3); assert.match(r.email_note, /answer 500/);
});
await check('with the Vault secret missing nothing is sent and the notice keeps waiting', async () => {
  await db.exec(`update vault.decrypted_secrets set name = 'moved' where name = 'cs_pipeline_email_key'`);
  await addDoc(db, GREINER, 'Other', 'While key missing.pdf'); await age(db);
  const sentBefore = await n(db, 'net.requests');
  const r = await send(db);
  assert.equal(r.sent, 0); assert.match(r.why, /email service key in Vault/);
  assert.equal(await n(db, 'net.requests'), sentBefore);
  await db.exec(`update vault.decrypted_secrets set name = 'cs_pipeline_email_key' where name = 'moved'`);
  assert.equal((await send(db)).sent, 1);
});
await check('a talk uploaded for a week says which week in the email', async () => {
  const id = await addDoc(db, GREINER, 'Toolbox Talks', 'Cold_Weather_Safety.pdf');
  const wk = (await one(db, `select (date_trunc('week', (now() at time zone 'America/Indiana/Indianapolis'))::date + 7) as w`)).w;
  const label = (await one(db, `select to_char($1::date, 'Mon FMDD') as l`, [wk])).l;
  const r = (await one(db, `select cs_portal_tbt_library_add_week('office', $1, 'Cold Weather Safety', 'Cold Weather', $2::date) as r`, [id, wk])).r;
  assert.equal(r.ok, true);
  await age(db);
  assert.equal((await send(db)).sent, 1);
  const q = await one(db, 'select body from net.requests order by id desc limit 1');
  assert.ok(q.body.text.includes('Toolbox Talks > Talk Library > Cold Weather > for the week of ' + label + ' | Cold Weather Safety'), q.body.text);
});
await check('if the notice cannot be written, the upload still succeeds', async () => {
  await db.exec(`alter table cs_upload_notices add constraint break_it check (false) not valid`);
  const id = await addDoc(db, GREINER, 'Other', 'Still uploads.pdf');
  assert.equal(await n(db, `cs_company_docs where id = '${id}'`), 1);
  assert.equal(await n(db, `cs_upload_notices where source_id = '${id}'`), 0);
  await db.exec(`alter table cs_upload_notices drop constraint break_it`);
});
await check('after all of that, every talk record, send and existing function is exactly as it was', async () => {
  const s = JSON.parse(await snap(db)), b = JSON.parse(before);
  assert.deepEqual(s[0], b[0]); assert.deepEqual(s[1], b[1]);
  assert.equal(await fnDefs(db), fnBefore);
});
await check('rollback stops recording and emailing, deletes no file or document, and leaves the talk sender alone', async () => {
  const docs = await n(db, 'cs_company_docs'), jobDocs = await n(db, 'cs_job_docs');
  await db.exec(ROLLBACK); await db.exec(ROLLBACK);
  assert.equal(await n(db, `cron.job where jobname = 'cs-upload-notices'`), 0);
  assert.equal(await n(db, `pg_trigger where tgname = 'cs_upload_notice'`), 0);
  assert.equal(await n(db, `pg_proc where proname like 'cs_portal_tbt_library%' or proname like 'cs_upload_notice%'`), 0);
  const notices = await n(db, 'cs_upload_notices');
  await addDoc(db, GREINER, 'Other', 'After rollback.pdf');
  assert.equal(await n(db, 'cs_upload_notices'), notices, 'nothing recorded after rollback');
  assert.equal(await n(db, 'cs_company_docs'), docs + 1); assert.equal(await n(db, 'cs_job_docs'), jobDocs);
  const s = JSON.parse(await snap(db)), b = JSON.parse(before);
  assert.deepEqual(s[0], b[0]); assert.deepEqual(s[1], b[1]);
});
await db.close();
if (failures) { console.log(`Upload notices SQL verification FAILED (${failures} failing, ${checks} passing).`); process.exit(1); }
console.log(`Upload notices SQL verification passed (${checks} checks, local database only, nothing sent).`);
