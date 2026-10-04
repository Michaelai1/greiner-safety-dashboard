/* Runs sql/2026-10-05-equipment-management.sql against an in-memory copy of the
 * production schema slice (tests/fixtures/prod-schema-slice.sql) and checks every
 * rule the Equipment tab and the phone depend on.
 *
 * Needs @electric-sql/pglite (set PGLITE_NODE_MODULES or PLAYWRIGHT_NODE_MODULES to
 * a node_modules folder that has it). Never connects to Supabase.
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
catch { console.log('Equipment SQL verification skipped (set PGLITE_NODE_MODULES to a folder with @electric-sql/pglite).'); process.exit(0); }
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const { pgcrypto } = await import(pathToFileURL(req.resolve('@electric-sql/pglite/contrib/pgcrypto')).href);

export async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(fs.readFileSync(path.join(ROOT, 'tests/fixtures/prod-schema-slice.sql'), 'utf8'));
  return db;
}

const MIGRATION = fs.readFileSync(path.join(ROOT, 'sql/2026-10-05-equipment-management.sql'), 'utf8');
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const db = await freshDb();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const call = async (fn, args) => {
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  const r = await one(`select ${fn}(${ph}) as r`, args);
  return typeof r.r === 'string' ? JSON.parse(r.r) : r.r;
};
const fails = async (p, re, msg) => {
  try { await p; } catch (e) { ok(re.test(e.message), `${msg} (got: ${e.message})`); return; }
  assert.fail(msg + ' — expected an error');
};

/* ---------- seed: two companies, jobs, sessions, existing units ---------- */
const A = (await one(`insert into cs_companies (name) values ('Greiner (test)') returning id`)).id;
const Bc = (await one(`insert into cs_companies (name) values ('Other company (test)') returning id`)).id;
const job = async (cid, num, name) => (await one(
  `insert into cs_jobs (company_id, job_number, name) values ($1, $2, $3) returning id`, [cid, num, name])).id;
const IU = await job(A, 'C799-2025', 'IU Health Plaza G Med. Gas');
const PUR = await job(A, 'C800-2025', 'Purdue (test)');
const OTHER = await job(Bc, 'X100', 'Other company job');
const sess = async (token, cid, scope, jobs, uid = null, uname = null) => db.query(
  `insert into cs_portal_sessions (token, company_id, scope, slug, expires_at, user_id, user_name, job_ids)
   values ($1, $2, $3, 'greiner', now() + interval '1 day', $4, $5, $6)`, [token, cid, scope, uid, uname, jobs]);
const OFFICE_UID = '00000000-0000-4000-8000-000000000001';
const FIELD_UID = '00000000-0000-4000-8000-000000000002';
await sess('office', A, 'full', null, OFFICE_UID, 'Office Tester');
await sess('field-iu', A, 'field', [IU], FIELD_UID, 'Field Tester');
await sess('field-pur', A, 'field', [PUR], FIELD_UID, 'Field Tester');
await sess('field-anon', A, 'field', [IU], null, null);
await sess('other-office', Bc, 'full', null, null, 'Other Office');
await db.query(`insert into cs_equipment (company_id, unit_number, equipment_type, job_id) values
  ($1, 'SL-19-01', 'Scissor lift', $2), ($1, 'FL-01', 'Forklift', null), ($3, 'X-1', 'Scissor lift', $4)`,
  [A, PUR, Bc, OTHER]);

await db.query(`insert into cs_workers (company_id, name, job_id, phone) values ($1, 'Worker (test)', $2, null)`, [A, PUR]);
const snapshotOthers = async () => JSON.stringify({
  workers: (await db.query(`select id, name, job_id, phone, active from cs_workers order by id`)).rows,
  jobs: (await db.query(`select id, job_number, name, status from cs_jobs order by id`)).rows,
  otherCo: (await db.query(`select id, unit_number, job_id, active from cs_equipment where company_id = $1 order by id`, [Bc])).rows });

/* ---------- migration applies, and applies again (idempotent) ---------- */
await db.exec(MIGRATION);
await db.exec(MIGRATION);
ok(true, 'migration applies twice without error');
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'cs_equipment'`))
  .rows.map(r => r.column_name);
for (const c of ['description', 'archived_at', 'updated_at']) ok(cols.includes(c), `cs_equipment gains ${c}`);
eq((await one(`select count(*)::int n from cs_equipment`)).n, 3, 'existing units are untouched');

const othersBefore = await snapshotOthers();

/* ---------- add ---------- */
let r = await call('cs_portal_equipment_add', ['office', '  ld-8-01 ', 'Step ladder', '8 ft fiberglass', null, null, null, null, null, IU]);
ok(r.ok && r.unit_number === 'LD-8-01', 'add trims and upper-cases the unit ID');
const LADDER = r.id;
r = await call('cs_portal_equipment_add', ['office', 'Ld-8-01', 'Step ladder', null, null, null, null, null, null, null]);
eq(r, { ok: false, error: 'duplicate_unit' }, 'duplicate IDs are refused regardless of case/spaces');
await fails(db.query(`insert into cs_equipment (company_id, unit_number) values ($1, ' ld-8-01')`, [A]),
  /duplicate key/, 'the database itself refuses a normalized duplicate');
r = await call('cs_portal_equipment_add', ['office', 'LD-8-01', 'Step ladder', null, null, null, null, null, null, null]);
ok(!r.ok, 'same ID cannot be added twice');
r = await call('cs_portal_equipment_add', ['other-office', 'LD-8-01', 'Step ladder', null, null, null, null, null, null, null]);
ok(r.ok, 'another company may use the same unit ID (isolation)');
r = await call('cs_portal_equipment_add', ['office', '', 'Step ladder', null, null, null, null, null, null, null]);
eq(r.error, 'unit_required', 'blank ID refused');
r = await call('cs_portal_equipment_add', ['office', 'Z-1', ' ', null, null, null, null, null, null, null]);
eq(r.error, 'type_required', 'blank type refused');
r = await call('cs_portal_equipment_add', ['office', 'Z-1', 'Ladder', null, null, null, null, null, null, OTHER]);
eq(r.error, 'bad_job', 'cannot assign to another company\'s job');
await fails(call('cs_portal_equipment_add', ['field-iu', 'Z-2', 'Ladder', null, null, null, null, null, null, null]),
  /insufficient scope/, 'field sessions cannot add equipment');
let h = await call('cs_portal_equipment_history', ['office', LADDER]);
eq(h.map(e => e.kind).sort(), ['assigned', 'created'], 'add with a job writes created + assigned');
eq(h.find(e => e.kind === 'created').by, 'Office Tester', 'actor comes from the session');

/* ---------- update (safe metadata only) ---------- */
const sl = (await one(`select id from cs_equipment where unit_number = 'SL-19-01'`)).id;
r = await call('cs_portal_equipment_update', ['office', sl, null, null, 'Genie 1930', 'Genie', 'GS-1930', 'GS30-123', '2019', 'Owned']);
ok(r.ok, 'update metadata');
let row = await one(`select * from cs_equipment where id = $1`, [sl]);
eq([row.unit_number, row.equipment_type, row.description, row.make, row.job_id], ['SL-19-01', 'Scissor lift', 'Genie 1930', 'Genie', PUR],
  'update keeps ID, type and job; changes only what was sent');
r = await call('cs_portal_equipment_update', ['office', sl, 'ld-8-01', null, null, null, null, null, null, null]);
eq(r.error, 'duplicate_unit', 'rename into an existing ID refused');
r = await call('cs_portal_equipment_update', ['office', sl, null, null, '', null, null, null, null, null]);
eq((await one(`select description from cs_equipment where id = $1`, [sl])).description, null, "'' clears a field");
r = await call('cs_portal_equipment_update', ['other-office', sl, null, null, 'hijack', null, null, null, null, null]);
eq(r.error, 'not_found', 'another company cannot edit this unit');

/* ---------- assign / unassign / reassign (the one write path) ---------- */
const fl = (await one(`select id from cs_equipment where unit_number = 'FL-01'`)).id;
eq((await call('cs_portal_equipment_set_job', ['office', fl, IU])).ok, true, 'assign');
eq((await call('cs_portal_equipment_set_job', ['office', fl, PUR])).ok, true, 'reassign');
eq((await call('cs_portal_equipment_set_job', ['office', fl, null])).ok, true, 'unassign');
eq((await call('cs_portal_equipment_set_job', ['office', fl, null])).unchanged, true, 'repeat unassign is a no-op');
h = await call('cs_portal_equipment_history', ['office', fl]);
eq(h.map(e => e.kind), ['unassigned', 'reassigned', 'assigned'], 'every move is recorded, newest first');
eq([h[1].from_job_id, h[1].to_job_id], [IU, PUR], 'reassign records from and to');
eq((await call('cs_portal_equipment_set_job', ['office', fl, OTHER])).error, 'bad_job', 'cross-company job refused');
eq((await call('cs_portal_equipment_set_job', ['other-office', fl, null])).error, 'not_found', 'cross-company unit refused');
await fails(call('cs_portal_equipment_set_job', ['field-iu', fl, IU]), /insufficient scope/, 'field cannot move equipment');

/* ---------- archive / restore ---------- */
await call('cs_portal_equipment_set_job', ['office', fl, IU]);
r = await call('cs_portal_equipment_archive', ['office', fl, true]);
row = await one(`select * from cs_equipment where id = $1`, [fl]);
ok(r.ok && row.archived_at && row.active === false && row.job_id === null, 'archive takes the unit off its job and out of service');
eq((await call('cs_portal_equipment_set_job', ['office', fl, IU])).error, 'archived', 'archived units cannot be assigned');
ok((await one(`select count(*)::int n from cs_equipment where id = $1`, [fl])).n === 1, 'archive never deletes');
r = await call('cs_portal_equipment_archive', ['office', fl, false]);
row = await one(`select * from cs_equipment where id = $1`, [fl]);
ok(r.ok && !row.archived_at && row.active && row.job_id === null, 'restore brings it back unassigned');
h = await call('cs_portal_equipment_history', ['office', fl]);
eq(h.slice(0, 2).map(e => e.kind), ['restored', 'archived'], 'archive and restore recorded');
eq(h.find(e => e.kind === 'archived').from_job_id, IU, 'archive records the job it left');

/* ---------- history is append-only ---------- */
await fails(db.query(`update cs_equipment_events set actor_name = 'x'`), /append-only/, 'events cannot be edited');
await fails(db.query(`delete from cs_equipment_events`), /append-only/, 'events cannot be deleted');
eq((await call('cs_portal_equipment_history', ['other-office', fl])), [], 'another company sees no history');

/* ---------- inventory ---------- */
let inv = await call('cs_portal_equipment_inventory', ['office']);
eq(inv.map(e => e.unit_number), ['FL-01', 'LD-8-01', 'SL-19-01'], 'inventory lists only this company, sorted');
ok(inv.find(e => e.unit_number === 'LD-8-01').is_ladder, 'ladders are recognized by type');
ok(!inv.find(e => e.unit_number === 'SL-19-01').is_ladder, 'a scissor lift is not a ladder');
await fails(call('cs_portal_equipment_inventory', ['field-iu']), /insufficient scope/, 'inventory is office-only');

/* ---------- phone: field equipment ---------- */
let fe = (await call('cs_portal_field_equipment', ['field-iu'])).equipment;
eq(fe.map(e => e.unit_number), ['LD-8-01'], 'phone sees only active units on its own job');
eq((await call('cs_portal_field_equipment', ['field-pur'])).equipment.map(e => e.unit_number), ['SL-19-01'], 'Purdue sees Purdue');
await fails(call('cs_portal_field_equipment', ['office']), /invalid token/, 'office session is not a field session');

/* ---------- phone: ladder safe-use and defect ---------- */
r = await call('cs_portal_field_ladder_safe', ['field-anon', LADDER, true, 'ladder-safe-use-v1', null, null]);
eq(r.error, 'sign_in_required', 'an inspection needs a signed-in employee');
r = await call('cs_portal_field_ladder_safe', ['field-iu', LADDER, false, 'ladder-safe-use-v1', null, null]);
eq(r.error, 'attestation_required', 'attestation must be affirmed');
r = await call('cs_portal_field_ladder_safe', ['field-iu', LADDER, true, 'other-v9', null, null]);
eq(r.error, 'attestation_required', 'attestation version must match');
r = await call('cs_portal_field_ladder_safe', ['field-pur', LADDER, true, 'ladder-safe-use-v1', null, null]);
eq(r.error, 'not_assigned_to_your_job', 'cannot inspect another job\'s ladder');
r = await call('cs_portal_field_ladder_safe', ['field-pur', sl, true, 'ladder-safe-use-v1', null, null]);
eq(r.error, 'not_a_ladder', 'a lift is not inspected through the ladder flow');
r = await call('cs_portal_field_ladder_safe', ['field-iu', LADDER, true, 'ladder-safe-use-v1', 'jha-root-1', 0]);
ok(r.ok && r.by === 'Field Tester' && r.by_user_id === FIELD_UID, 'safe check records the session employee');
fe = (await call('cs_portal_field_equipment', ['field-iu'])).equipment;
eq(fe[0].events[0].kind, 'inspection_safe', 'phone sees the new safe check');
eq(fe[0].events[0].data.attestation_version, 'ladder-safe-use-v1', 'attestation version stored');
r = await call('cs_portal_field_ladder_defect', ['field-iu', LADDER, '  ', true, null, null, null]);
eq(r.error, 'description_required', 'defect needs a description');
r = await call('cs_portal_field_ladder_defect', ['field-iu', LADDER, 'Cracked rail', false, null, null, null]);
eq(r.error, 'acknowledgment_required', 'defect needs the Do Not Use acknowledgment');
r = await call('cs_portal_field_ladder_defect', ['field-iu', LADDER, 'Cracked rail', true,
  JSON.stringify({ filename: 'd.jpg', mime: 'image/jpeg', data_url: 'data:image/jpeg;base64,AAAA' }), 'jha-root-1', 0]);
ok(r.ok, 'defect recorded');
let fe2 = await call('cs_portal_field_equipment', ['field-iu']);
eq(fe2.user, { id: FIELD_UID, name: 'Field Tester' }, 'phone learns who is signed in from the session');
eq(fe2.equipment[0].events[0].data.has_photo, true, 'phone is told a photo exists');
ok(!('photo' in fe2.equipment[0].events[0].data), 'the photo itself is not sent to every phone');
ok((await call('cs_portal_equipment_history', ['office', LADDER]))[0].data.photo.data_url, 'office history keeps the photo');
eq((await call('cs_portal_field_equipment', ['field-anon'])).user, null, 'a session without an employee has no user');
r = await call('cs_portal_field_ladder_defect', ['field-iu', LADDER, 'Big', true,
  JSON.stringify({ data_url: 'x'.repeat(4000001) }), null, null]);
eq(r.error, 'photo_too_large', 'oversized photo refused');
r = await call('cs_portal_field_ladder_safe', ['field-iu', LADDER, true, 'ladder-safe-use-v1', null, null]);
eq(r.error, 'do_not_use', 'a Do Not Use ladder cannot be confirmed safe');
inv = await call('cs_portal_equipment_inventory', ['office']);
const ld = inv.find(e => e.unit_number === 'LD-8-01');
ok(ld.open_defect && ld.open_defect.description === 'Cracked rail', 'office inventory shows the open defect');
eq(ld.last_inspection.kind, 'defect_reported', 'last inspection reflects the latest field event');
await call('cs_portal_equipment_archive', ['office', LADDER, true]);
r = await call('cs_portal_field_ladder_safe', ['field-iu', LADDER, true, 'ladder-safe-use-v1', null, null]);
eq(r.error, 'not_found', 'an archived ladder cannot be inspected');
eq((await call('cs_portal_field_equipment', ['field-iu'])).equipment.length, 0, 'archived ladder leaves the phone list');

/* ---------- nothing else moved ---------- */
const afterOthers = JSON.parse(await snapshotOthers()), beforeOthers = JSON.parse(othersBefore);
eq(afterOthers.workers, beforeOthers.workers, 'equipment changes never touch employees');
eq(afterOthers.jobs, beforeOthers.jobs, 'equipment changes never touch jobs');
eq(afterOthers.otherCo.filter((r) => r.unit_number === 'X-1'), beforeOthers.otherCo.filter((r) => r.unit_number === 'X-1'),
  "another company's unit is untouched");
await call('cs_portal_equipment_add', ['office', 'LD-FREE', 'Ladder', null, null, null, null, null, null, null]);
ok(!(await call('cs_portal_field_equipment', ['field-iu'])).equipment.some((e) => e.unit_number === 'LD-FREE'),
  'an unassigned unit never appears as assigned to a job');

/* ---------- grants ---------- */
const anonCan = async (sig) => (await one(`select has_function_privilege('anon', $1, 'execute') as c`, [sig])).c;
ok(await anonCan('cs_portal_equipment_inventory(text)'), 'inventory callable through the API');
ok(!(await anonCan('cs_field_ladder_guard(text, uuid)')), 'internal guard is not callable through the API');
ok(!(await anonCan('cs_session_actor(text)')), 'internal actor lookup is not callable through the API');

console.log(`Equipment SQL verification: ${checks} checks passed (in-memory Postgres, no Supabase).`);
