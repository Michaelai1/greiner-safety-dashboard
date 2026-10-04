/* Runs the SQL printed by tools/provision-iu-c799.mjs against an in-memory copy
 * of the production schema slice, with FAKE 555 mobile numbers, and checks that
 * provisioning is idempotent, never duplicates a person, never grants office
 * access, never overwrites a PIN, and waits for the PIN decision by default.
 *
 * Needs @electric-sql/pglite (PGLITE_NODE_MODULES or PLAYWRIGHT_NODE_MODULES).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

/* ---------- static: nothing private is tracked ---------- */
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'provisioning/iu-c799-2025.spec.json'), 'utf8'));
const specText = JSON.stringify(spec);
ok(!/\d{3}\D?\d{3}\D?\d{4}/.test(specText), 'the tracked spec holds no phone numbers');
ok(!/pin/i.test(specText.replace(/PINs/g, '')), 'the tracked spec holds no PINs');
ok(!('people' in spec) && !('pm_name' in spec.job) && !('foreman_name' in spec.job),
  'the tracked spec names no person (the repository is public)');
eq(spec.expected_people, 6, 'six IU people expected');
eq(spec.job.address, '1330 N Senate Ave, Indianapolis, IN 46202', 'exact address');
ok(!spec.form_keys.includes('jobsiteanalysis'), 'the retired checklist is not granted');
eq([...spec.form_keys].sort(), ['aerial', 'forklift', 'hotwork', 'jha'], 'same forms as the fullest Purdue field user');
const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'provisioning/iu-c799-2025.local.example.json'), 'utf8'));
ok(example.people.every(p => /-555-01\d\d$/.test(p.mobile) && /\(Test\)$/.test(p.name)), 'the example file is fake people with 555 numbers');
const P = example.people.map(p => p.name), MOB = Object.fromEntries(example.people.map(p => [p.name, p.mobile]));
const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
ok(ignore.includes('provisioning/*.local.json'), 'real mobile files are git-ignored');

// Files git would commit (tracked + new, minus ignored) never hold the real people or a PIN hash.
{
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size < 5e6);
  const realFile = path.join(ROOT, 'provisioning/iu-c799-2025.local.json');
  ok(!files.includes('provisioning/iu-c799-2025.local.json'), 'the real local file is never committed');
  const real = fs.existsSync(realFile) ? JSON.parse(fs.readFileSync(realFile, 'utf8')) : null;
  const needles = real ? real.people.flatMap((p) => [p.name, String(p.mobile).replace(/\D/g, '')]).concat(real.pm_name ? [real.pm_name] : []) : [];
  const leaks = [];
  for (const f of files) {
    const body = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/.test(body)) leaks.push(f + ': PIN hash');
    const flat = body.replace(/\D/g, '');
    for (const n of needles) if (/^\d+$/.test(n) ? flat.includes(n) && body.replace(/[^0-9-]/g, '').includes(n.slice(0, 3) + '-' + n.slice(3, 6)) : body.includes(n)) leaks.push(f + ': ' + (/^\d/.test(n) ? 'a real mobile' : 'a real name'));
  }
  // Older SQL files committed before this work already name some people (see the report); only new files are checked for names.
  const newFiles = new Set(execFileSync('git', ['ls-files', '-o', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    .concat(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)));
  eq(leaks.filter((l) => newFiles.has(l.split(':')[0]) || /PIN hash/.test(l)), [], 'no real IU names, mobiles or PIN hashes in files git would commit');
  if (!real) console.log('  (real local file absent: name/mobile scan used no real data)');
}

const modDir = process.env.PGLITE_NODE_MODULES || process.env.PLAYWRIGHT_NODE_MODULES;
let req;
try { req = createRequire(path.join(modDir || ROOT, 'noop.js')); req.resolve('@electric-sql/pglite'); }
catch { console.log(`IU provisioning: ${checks} static checks passed; database part skipped (set PGLITE_NODE_MODULES).`); process.exit(0); }
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const { pgcrypto } = await import(pathToFileURL(req.resolve('@electric-sql/pglite/contrib/pgcrypto')).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-prov-'));
const localFile = path.join(tmp, 'iu.local.json');
fs.writeFileSync(localFile, JSON.stringify(example));
const gen = (...extra) => execFileSync(process.execPath,
  [path.join(ROOT, 'tools/provision-iu-c799.mjs'), '--local', localFile, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const outPending = gen();
const outLast4 = gen('--pin-policy=last4-of-mobile');
ok(!/pin_hash/i.test(outLast4), 'generated SQL never mentions PIN hashes');
for (const m of Object.values(MOB)) {
  ok(!outLast4.includes(`'${m.slice(-4)}'`), 'no PIN literal is printed');
}
ok(outPending.includes('PIN policy: NONE'), 'default output says no login is created');
const bad = (obj) => { fs.writeFileSync(localFile, JSON.stringify(obj)); try { gen(); return false; } catch { return true; } finally { fs.writeFileSync(localFile, JSON.stringify(example)); } };
ok(bad({ ...example, people: example.people.slice(0, 5) }), 'refuses fewer than six people');
ok(bad({ ...example, people: example.people.map(p => ({ ...p, lead: false })) }), 'refuses a list with no lead');
ok(bad({ ...example, people: example.people.map((p, i) => i === 1 ? { ...p, mobile: example.people[0].mobile } : p) }), 'refuses a shared mobile');
ok(bad({ ...example, people: example.people.map((p, i) => i === 2 ? { ...p, mobile: '555-01' } : p) }), 'refuses a short mobile');
let threw = false;
try { gen('--pin-policy=1234'); } catch { threw = true; }
ok(threw, 'an unknown PIN policy is refused');

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(path.join(ROOT, 'tests/fixtures/prod-schema-slice.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(ROOT, 'sql/2026-10-05-equipment-management.sql'), 'utf8'));
const q = async (s, p = []) => (await db.query(s, p)).rows;
const one = async (s, p = []) => (await q(s, p))[0];
const notices = [];
const run = async (sql) => {
  notices.length = 0;
  try { await db.exec(sql, { onNotice: (n) => notices.push(n.message) }); }
  catch (e) { await db.exec('rollback'); throw e; }
};

/* Production-shaped starting state (names only; all phones fake). */
await db.query(`insert into cs_companies (id, name) values ($1, 'Greiner (test)')`, [spec.company_id]);
const other = (await one(`insert into cs_companies (name) values ('Other (test)') returning id`)).id;
const IU = (await one(`insert into cs_jobs (company_id, job_number, name, address, status)
  values ($1, 'C799-2025', 'IU Health Plaza G Med. Gas', '1330 N Senate Ave Indianapolis, IN 46202', 'closed') returning id`, [spec.company_id])).id;
const C785 = (await one(`insert into cs_jobs (company_id, job_number, name) values ($1, 'C785-2023', 'IU Health Plmb Core & Shell') returning id`, [spec.company_id])).id;
// Four of the six already on the roster of another IU job with no phone, as in
// production; two not on the roster at all.
for (const [n, c] of [[P[0], 'JNY FMN L3'], [P[2], 'JNY FMN L2'], [P[3], 'JNY FMN L1'], [P[4], 'JNY FMN L1']]) {
  await db.query(`insert into cs_workers (company_id, name, job_id, classification) values ($1, $2, $3, $4)`, [spec.company_id, n, C785, c]);
}
await db.query(`insert into cs_workers (company_id, name, phone) values ($1, $2, $3)`, [other, P[0], MOB[P[0]]]);
await db.query(`select cs_portal_set_user('greiner', 'Existing Purdue User', '4827', null, 'field', array[$1]::uuid[])`, [C785]);

/* 1. Default run: job + roster prepared, nobody gets a login. */
await run(outPending);
let job = await one(`select * from cs_jobs where id = $1`, [IU]);
eq([job.status, job.closed_at, job.address, job.gc_name, job.pm_name, job.foreman_name, job.foreman_phone],
  ['active', null, '1330 N Senate Ave, Indianapolis, IN 46202', 'Wilhelm Gilbane', example.pm_name, P[0], MOB[P[0]]],
  'job reopened with exact details');
eq((await one(`select count(*)::int n from cs_portal_users where slug = 'greiner'`)).n, 1, 'no login created without the PIN decision');
eq(notices.filter(n => /PENDING/.test(n)).length, 6, 'all six reported as pending the PIN decision');
let roster = await q(`select name, job_id, phone, classification from cs_workers where company_id = $1 order by name`, [spec.company_id]);
eq(roster.length, 6, 'four matched + two added, no duplicates');
eq(roster.find(r => r.name === P[0]).job_id, C785, 'without --move-roster an existing record keeps its job');
eq(roster.find(r => r.name === P[0]).phone, MOB[P[0]], 'missing phone filled in');
eq(roster.find(r => r.name === P[0]).classification, 'JNY FMN L3', 'classification preserved');
eq(roster.find(r => r.name === P[1]).job_id, IU, 'a new roster record lands on C799');
eq((await one(`select phone from cs_workers where company_id = $1`, [other])).phone, MOB[P[0]], 'other company untouched');

/* 2. Approved PIN policy, run twice. */
await run(outLast4);
await run(outLast4);
const users = await q(`select * from cs_portal_users where slug = 'greiner' and name <> 'Existing Purdue User' order by name`);
eq(users.length, 6, 'six logins, no duplicates after two runs');
ok(users.every(u => u.role === 'field'), 'all field role — no office access');
ok(users.every(u => JSON.stringify(u.job_ids) === JSON.stringify([IU])), 'each assigned to C799 only');
ok(users.every(u => /^\d{3}-555-01\d\d$/.test(u.mobile)), 'mobile stored');
for (const u of users) {
  const last4 = MOB[u.name].slice(-4);
  const m = await one(`select extensions.crypt($1, pin_hash) = pin_hash as m from cs_portal_users where id = $2`, [last4, u.id]);
  ok(m.m, `${u.name}'s login accepts the approved PIN`);
}
const forms = await q(`select user_id, form_keys from cs_field_user_forms where job_id = $1`, [IU]);
eq(forms.length, 6, 'one permission row each');
ok(forms.every(f => [...f.form_keys].sort().join() === 'aerial,forklift,hotwork,jha'), 'same forms as the comparable job');

/* 3. Re-runs never overwrite a PIN or an office edit. */
const lead = users.find(u => u.name === P[0]);
eq(lead.title, spec.titles.lead, 'the lead foreman gets the lead title');
await db.query(`update cs_field_user_forms set form_keys = '{jha}' where user_id = $1`, [lead.id]);
const hashBefore = lead.pin_hash;
await run(outLast4);
eq((await one(`select pin_hash from cs_portal_users where id = $1`, [lead.id])).pin_hash, hashBefore, 'existing PIN untouched');
eq((await one(`select form_keys from cs_field_user_forms where user_id = $1`, [lead.id])).form_keys, ['jha'], 'office edit kept');
ok(notices.some(n => n.startsWith(P[0] + ': existing login kept')), 're-run reports existing logins');

/* 3b. PINs Michael chooses, from the local file: weak and shared codes are refused. */
{
  const withPins = { ...example, people: example.people.map((p, i) => ({ ...p, pin: String(4827 + i * 1111) })) };
  fs.writeFileSync(localFile, JSON.stringify(withPins));
  const out = gen('--pin-policy=local-file');
  ok(out.includes('AND PINs: do not commit or share'), 'output warns that it contains PINs');
  const db2 = new PGlite({ extensions: { pgcrypto } });
  await db2.exec(fs.readFileSync(path.join(ROOT, 'tests/fixtures/prod-schema-slice.sql'), 'utf8'));
  await db2.query(`insert into cs_companies (id, name) values ($1, 'Greiner (test)')`, [spec.company_id]);
  await db2.query(`insert into cs_jobs (company_id, job_number, name) values ($1, 'C799-2025', 'IU')`, [spec.company_id]);
  await db2.exec(out);
  const u2 = (await db2.query(`select name from cs_portal_users where extensions.crypt($1, pin_hash) = pin_hash`, [withPins.people[2].pin])).rows;
  eq(u2.map(r => r.name), [withPins.people[2].name], 'each login accepts exactly its chosen PIN');
  fs.writeFileSync(localFile, JSON.stringify({ ...withPins, people: withPins.people.map((p, i) => i === 1 ? { ...p, pin: withPins.people[0].pin } : p) }));
  let shared = false; try { gen('--pin-policy=local-file'); } catch { shared = true; }
  ok(shared, 'two people with one PIN are refused before any SQL is printed');
  fs.writeFileSync(localFile, JSON.stringify({ ...withPins, people: withPins.people.map((p, i) => i === 1 ? { ...p, pin: '1234' } : p) }));
  const db3 = new PGlite({ extensions: { pgcrypto } });
  await db3.exec(fs.readFileSync(path.join(ROOT, 'tests/fixtures/prod-schema-slice.sql'), 'utf8'));
  await db3.query(`insert into cs_companies (id, name) values ($1, 'Greiner (test)')`, [spec.company_id]);
  await db3.query(`insert into cs_jobs (company_id, job_number, name) values ($1, 'C799-2025', 'IU')`, [spec.company_id]);
  await assert.rejects(db3.exec(gen('--pin-policy=local-file')), /too easy to guess/, 'a weak PIN stops the whole run');
  checks++;
  fs.writeFileSync(localFile, JSON.stringify(example));
}

/* 4. --move-roster moves the four existing records onto C799. */
await run(gen('--pin-policy=last4-of-mobile', '--move-roster'));
roster = await q(`select name, job_id from cs_workers where company_id = $1`, [spec.company_id]);
ok(roster.every(r => r.job_id === IU), 'with --move-roster all six are on the IU crew');
eq(roster.length, 6, 'still no duplicates');

/* 5. Conflicts stop everything. */
const snapshot = await one(`select count(*)::int n from cs_portal_users`);
await db.query(`update cs_portal_users set role = 'full' where id = $1`, [lead.id]);
await assert.rejects(run(outLast4), /office access/, 'an office login is never changed');
checks++;
await db.query(`update cs_portal_users set role = 'field' where id = $1`, [lead.id]);
await db.query(`update cs_portal_users set mobile = $1 where name = 'Existing Purdue User'`, [MOB[P[1]]]);
await assert.rejects(run(outLast4), /matches 2 logins|belongs to login "Existing Purdue User"/, 'a phone owned by someone else stops the run');
checks++;
eq((await one(`select count(*)::int n from cs_portal_users`)).n, snapshot.n, 'a stopped run changes nothing');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`IU provisioning verification: ${checks} checks passed (fake numbers, in-memory Postgres).`);
