/* Toolbox Talk foreman attendance, server side (Oct 29, 2026), in PGlite: the live talk functions
 * (tests/fixtures/tbt-live-2026-10-29.sql, read from production) plus
 * supabase/migrations/20261029230000_greiner_tbt_foreman_attendance.sql.
 *
 * Fictional jobs and people under the real company ids (the live link-open function names Greiner's id).
 * Nothing leaves the machine. Needs PGLITE_NODE_MODULES; skips cleanly without it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('../', import.meta.url).pathname);
const FIXTURE = path.join(ROOT, 'tests/fixtures/tbt-live-2026-10-29.sql');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261029230000_greiner_tbt_foreman_attendance.sql');
let PGlite, pgcrypto;
try {
  const preq = createRequire(path.join(process.env.PGLITE_NODE_MODULES || '/nonexistent', 'noop.js'));
  ({ PGlite } = await import(pathToFileURL(preq.resolve('@electric-sql/pglite')).href));
  ({ pgcrypto } = await import(pathToFileURL(preq.resolve('@electric-sql/pglite/contrib/pgcrypto')).href));
} catch {
  console.log('Toolbox Talk foreman SQL verification skipped (set PGLITE_NODE_MODULES).');
  process.exit(0);
}

export const GREINER = '8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2';
export const CHOICE = '3da7dc46-30d3-4870-bbd9-a85bd2227a3c';
export const J = { westin: '10000000-0000-4000-8000-000000000796', taylor: '10000000-0000-4000-8000-000000000808',
  iu: '10000000-0000-4000-8000-000000000799', other: '10000000-0000-4000-8000-000000000999',
  closed: '10000000-0000-4000-8000-000000000111', choice: '20000000-0000-4000-8000-000000000001' };
const SITE = 'https://example.invalid/greiner-QR/toolbox.html';
const WEEK = '2026-10-26';
const future = () => new Date(Date.now() + 36e5).toISOString();

export async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(fs.readFileSync(FIXTURE, 'utf8'));
  await db.exec(`
    insert into cs_companies (id, name) values ('${GREINER}', 'Greiner Brothers'), ('${CHOICE}', 'Choice');
    insert into cs_portals (slug, company_id) values ('greiner', '${GREINER}'), ('choice', '${CHOICE}');
    insert into cs_jobs (id, company_id, job_number, name, status) values
      ('${J.westin}', '${GREINER}', 'T796', 'Test Hotel (Test)', 'active'),
      ('${J.taylor}', '${GREINER}', 'T808', 'Test School (Test)', 'active'),
      ('${J.iu}', '${GREINER}', 'T799', 'Test Hospital (Test)', 'active'),
      ('${J.other}', '${GREINER}', 'T999', 'Other Job (Test)', 'active'),
      ('${J.closed}', '${GREINER}', 'T111', 'Closed Job (Test)', 'closed'),
      ('${J.choice}', '${CHOICE}', 'CREW', 'Choice crew (Test)', 'active');
    insert into cs_workers (company_id, name, job_id, active) values
      ('${GREINER}', 'Rob Foreman (Test)', '${J.taylor}', true), ('${GREINER}', 'Casey Crew (Test)', '${J.taylor}', true),
      ('${GREINER}', 'Jordan Crew (Test)', '${J.taylor}', true), ('${GREINER}', 'Gone Worker (Test)', '${J.taylor}', false),
      ('${GREINER}', 'Other Job Person (Test)', '${J.other}', true),
      ('${GREINER}', 'Old Roster Spelling (Test)', '${J.westin}', true), ('${GREINER}', 'Stale Hotel Worker (Test)', '${J.westin}', true),
      ('${CHOICE}', 'Choice Tech (Test)', '${J.choice}', true);
    insert into cs_portal_users (slug, name, role, active, job_ids, mobile) values
      ('greiner', 'Pat Account (Test)', 'field', true, array['${J.taylor}'::uuid], null),
      ('greiner', 'Admin Person (Test)', 'full', true, array['${J.taylor}'::uuid], null),
      ('greiner', 'Other Account (Test)', 'field', true, array['${J.other}'::uuid], null);
  `);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  await db.exec(`
    insert into cs_tbt_attendance_roles (company_id, job_id, recipient_name, role, documents_only, source_ref) values
      ('${GREINER}', '${J.taylor}', 'Rob Foreman (Test)', 'leader', false, 'test'),
      ('${GREINER}', '${J.westin}', 'Roger Lead (Test)', 'leader', true, 'test: documents only'),
      ('${GREINER}', '${J.westin}', 'Matt Second (Test)', 'leader', true, 'test: documents only'),
      ('${GREINER}', '${J.iu}', 'Jason Lead (Test)', 'leader', false, 'test'),
      ('${GREINER}', '${J.iu}', 'Dakota Crew (Test)', 'participant', false, 'test');
    insert into cs_tbt_crew_lists (job_id, name, source_ref) values
      ('${J.westin}', 'Roger Lead (Test)', 't'), ('${J.westin}', 'Matt Second (Test)', 't'),
      ('${J.westin}', 'Verified Crew A (Test)', 't'), ('${J.westin}', 'Verified Crew B (Test)', 't');
  `);
  return db;
}
export async function issue(db, o) {
  const r = await db.query(`select * from cs_tbt_issue_foreman($1, $2, $3, 'hot-work-general-awareness',
      'Hot Work Talk 1: General Awareness and Tips', $4, $5::date, $6::timestamptz, $7, $8, $9, 'test')`,
    [GREINER, o.job, o.name, o.format || 'doc', o.week || WEEK, o.at || future(), SITE, o.phone || null, o.email || null]);
  return r.rows[0];
}
export const tokenOf = async (db, aid) => {
  const r = await db.query(`select coalesce((select substring(body from '#(.+)$') from cs_tbt_sends where assignment_id = $1 limit 1),
                                            (select substring(link_url from '#(.+)$') from cs_tbt_email_links where assignment_id = $1 limit 1)) t`, [aid]);
  return r.rows[0].t;
};
const refused = async (p, re) => { await assert.rejects(p, (e) => { assert.match(String(e.message), re); return true; }); };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let checks = 0, failures = 0;
  const check = async (name, fn) => {
    try { await fn(); checks++; console.log(`  ok  ${name}`); }
    catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n       ')}`); }
  };

  await check('The Oct 26 bug path is refused: the old email issue (no role) for an agreed foreman', async () => {
    const db = await freshDb();
    await refused(db.query(`select * from cs_tbt_issue_email($1, 'hot-work-general-awareness', 'T', 'Rob Foreman (Test)', 'rob@example.invalid', $2::date, false, $3, $4::timestamptz)`,
      [GREINER, WEEK, SITE, future()]), /agreed Toolbox Talk role \(leader on T808\)/);
    await refused(db.query(`select * from cs_tbt_issue($1, 'hot-work-general-awareness', 'T', 'Rob Foreman (Test)', '3175550100', $2::date, $3::timestamptz, false, $4)`,
      [GREINER, WEEK, future(), SITE]), /agreed Toolbox Talk role/);
    assert.equal((await db.query('select count(*)::int n from cs_tbt_assignments')).rows[0].n, 0);
  });

  await check('Foreman by text AND email: ONE leader record on his job, one held text and one email link carrying the same link', async () => {
    const db = await freshDb();
    const r = await issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', phone: '(317) 555-0100', email: 'Rob@Example.invalid' });
    assert.equal(r.role, 'leader');
    const a = (await db.query('select * from cs_tbt_assignments')).rows;
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].role, a[0].roster_job_id, a[0].channel, a[0].talk_format, a[0].recipient_email], ['leader', J.taylor, 'sms', 'doc', 'rob@example.invalid']);
    const s = (await db.query('select * from cs_tbt_sends')).rows, e = (await db.query('select * from cs_tbt_email_links')).rows;
    assert.equal(s.length, 1); assert.equal(e.length, 1);
    assert.equal(s[0].status, 'held', 'nothing scheduled until released');
    assert.equal(s[0].body.slice(s[0].body.indexOf('https://')), e[0].link_url, 'the text and the email carry the same link');
    assert.match(s[0].body, /^Greiner Brothers Toolbox Talk: Hot Work Talk 1: General Awareness and Tips\. Please review it and confirm here: https:\/\/\S+#[A-Za-z0-9_-]{20,}$/);
    assert.equal((await db.query('select count(*)::int n from cs_tbt_site_links')).rows[0].n, 0, 'a leader carries the job itself');
  });

  await check('The foreman’s link shows his job’s crew only: active roster + field accounts, no inactive, other-job, admin or other-company names', async () => {
    const db = await freshDb();
    const r = await issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', email: 'rob@example.invalid' });
    const o = (await db.query('select * from cs_tbt_link_open($1)', [await tokenOf(db, r.assignment_id)])).rows[0];
    assert.equal(o.role, 'leader'); assert.equal(o.group_label, 'Test School (Test) (T808)');
    assert.deepEqual(o.roster, ['Casey Crew (Test)', 'Jordan Crew (Test)', 'Pat Account (Test)', 'Rob Foreman (Test)']);
  });

  await check('A job with a verified crew list shows exactly that list (stale roster rows and old spellings are not shown)', async () => {
    const db = await freshDb();
    const r = await issue(db, { job: J.westin, name: 'Roger Lead (Test)', phone: '3175550101' });
    const o = (await db.query('select * from cs_tbt_link_open($1)', [await tokenOf(db, r.assignment_id)])).rows[0];
    assert.deepEqual(o.roster, ['Matt Second (Test)', 'Roger Lead (Test)', 'Verified Crew A (Test)', 'Verified Crew B (Test)']);
  });

  await check('Documents only: a video can never be queued for Westin’s foremen, by any path, test or not', async () => {
    const db = await freshDb();
    await refused(issue(db, { job: J.westin, name: 'Roger Lead (Test)', phone: '3175550101', format: 'video' }), /document talks only/);
    await refused(db.query(`insert into cs_tbt_assignments (company_id, talk_key, talk_title, recipient_name, recipient_phone, week_start, is_test, token_hash, token_prefix, expires_at, role, roster_job_id)
      values ($1, 'x', 'x', 'Matt Second (Test)', '+13175550102', $2::date, true, repeat('a', 64), 'aaaaaa', now() + interval '1 day', 'leader', $3)`, [GREINER, WEEK, J.westin]), /document talks only/);
    const ok = await issue(db, { job: J.westin, name: 'Matt Second (Test)', phone: '3175550102', format: 'doc' });
    await refused(db.query(`update cs_tbt_assignments set talk_format = 'video' where id = $1`, [ok.assignment_id]), /document talks only/);
  });

  await check('Duplicate protection: the same person, talk and week cannot be issued twice', async () => {
    const db = await freshDb();
    await issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', email: 'rob@example.invalid' });
    await refused(issue(db, { job: J.taylor, name: 'rob foreman (test)', phone: '3175550100' }), /already has hot-work-general-awareness/);
  });

  await check('Refusals: no agreed role, wrong job, closed job, other company, past time, video/doc undeclared, no channel', async () => {
    const db = await freshDb();
    await refused(issue(db, { job: J.taylor, name: 'Nobody Agreed (Test)', email: 'n@example.invalid' }), /no agreed Toolbox Talk role/);
    await refused(issue(db, { job: J.other, name: 'Rob Foreman (Test)', email: 'r@example.invalid' }), /no agreed Toolbox Talk role/);
    await refused(issue(db, { job: J.closed, name: 'Rob Foreman (Test)', email: 'r@example.invalid' }), /not an active job/);
    await refused(issue(db, { job: J.choice, name: 'Rob Foreman (Test)', email: 'r@example.invalid' }), /not an active job/);
    await refused(issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', email: 'r@example.invalid', at: '2020-01-01T10:00:00Z' }), /future/);
    await refused(issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', email: 'r@example.invalid', format: 'pdf' }), /doc or video/);
    await refused(issue(db, { job: J.taylor, name: 'Rob Foreman (Test)' }), /phone or an email/);
    await refused(db.query(`select * from cs_tbt_issue_foreman($1, $2, 'Choice Tech (Test)', 'k', 't', 'doc', $3::date, $4::timestamptz, $5, null, 'c@example.invalid')`,
      [CHOICE, J.choice, WEEK, future(), SITE]), /Greiner Brothers messages only/);
  });

  await check('Participant (IU crew named for text, no attendance role): individual link, no crew list, site link kept for the office', async () => {
    const db = await freshDb();
    const r = await issue(db, { job: J.iu, name: 'Dakota Crew (Test)', phone: '3175550103' });
    assert.equal(r.role, 'participant');
    const a = (await db.query('select role, roster_job_id from cs_tbt_assignments')).rows[0];
    assert.deepEqual([a.role, a.roster_job_id], ['participant', null]);
    assert.equal((await db.query('select job_id from cs_tbt_site_links')).rows[0].job_id, J.iu);
    const tok = await tokenOf(db, r.assignment_id);
    const o = (await db.query('select * from cs_tbt_link_open($1)', [tok])).rows[0];
    assert.deepEqual([o.role, o.roster], ['participant', []]);
    const s = (await db.query(`select * from cs_tbt_link_submit($1, 60000, 'doc', null)`, [tok])).rows;
    assert.equal(s.length, 1);
  });

  await check('Submit validation and persistence: a foreman needs a presenter and at least one attendee; then it is stored once', async () => {
    const db = await freshDb();
    const r = await issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', email: 'rob@example.invalid' });
    const tok = await tokenOf(db, r.assignment_id);
    for (const g of [null, { presenter: '', attendees: ['Casey Crew (Test)'] }, { presenter: 'Rob Foreman (Test)', attendees: [], manual: [] }]) {
      assert.equal((await db.query(`select * from cs_tbt_link_submit($1, 60000, 'doc', $2)`, [tok, g])).rows.length, 0);
    }
    assert.equal((await db.query('select submitted_at from cs_tbt_assignments')).rows[0].submitted_at, null, 'nothing stored');
    const first = (await db.query(`select * from cs_tbt_link_submit($1, 60000, 'doc', $2)`, [tok,
      { presenter: 'Rob Foreman (Test)', attendees: ['Casey Crew (Test)', 'Jordan Crew (Test)'], manual: ['Walk In (Test)'] }])).rows[0];
    assert.equal(first.attendees_stored, true);
    const again = (await db.query(`select * from cs_tbt_link_submit($1, 99, 'doc', $2)`, [tok, { presenter: 'X', attendees: ['Other'] }])).rows[0];
    assert.equal(String(again.submitted_at), String(first.submitted_at), 'a second submit changes nothing');
    const a = (await db.query('select presenter, attendees, manual_attendees from cs_tbt_assignments')).rows[0];
    assert.deepEqual([a.presenter, a.attendees, a.manual_attendees], ['Rob Foreman (Test)', ['Casey Crew (Test)', 'Jordan Crew (Test)'], ['Walk In (Test)']]);
  });

  await check('Expired and revoked links open nothing and accept nothing', async () => {
    const db = await freshDb();
    const r1 = await issue(db, { job: J.taylor, name: 'Rob Foreman (Test)', email: 'rob@example.invalid' });
    const t1 = await tokenOf(db, r1.assignment_id);
    await db.query(`update cs_tbt_assignments set expires_at = now() - interval '1 minute' where id = $1`, [r1.assignment_id]);
    assert.equal((await db.query('select * from cs_tbt_link_open($1)', [t1])).rows.length, 0);
    assert.equal((await db.query(`select * from cs_tbt_link_submit($1, 1, 'doc', $2)`, [t1, { presenter: 'R', attendees: ['A'] }])).rows.length, 0);
    await db.query(`update cs_tbt_assignments set expires_at = now() + interval '1 day', revoked_at = now() where id = $1`, [r1.assignment_id]);
    assert.equal((await db.query('select * from cs_tbt_link_open($1)', [t1])).rows.length, 0);
  });

  await check('Converting an existing individual email record: allowed only to the agreed role and job; the same link then opens the crew list', async () => {
    const db = await freshDb();
    await db.query(`delete from cs_tbt_attendance_roles where recipient_name = 'Rob Foreman (Test)'`);
    const old = (await db.query(`select * from cs_tbt_issue_email($1, 'hot-work-general-awareness', 'Hot Work Talk 1: General Awareness and Tips', 'Rob Foreman (Test)', 'rob@example.invalid', $2::date, false, $3, $4::timestamptz)`,
      [GREINER, WEEK, SITE, future()])).rows[0];
    await db.query(`insert into cs_tbt_attendance_roles (company_id, job_id, recipient_name, role, source_ref) values ($1, $2, 'Rob Foreman (Test)', 'leader', 'test')`, [GREINER, J.taylor]);
    await refused(db.query(`update cs_tbt_assignments set role = 'leader', roster_job_id = $2, talk_format = 'doc' where id = $1`, [old.assignment_id, J.other]), /does not match/);
    await db.query(`update cs_tbt_assignments set role = 'leader', roster_job_id = $2, talk_format = 'doc' where id = $1`, [old.assignment_id, J.taylor]);
    const o = (await db.query('select * from cs_tbt_link_open($1)', [old.link_url.split('#')[1]])).rows[0];
    assert.equal(o.role, 'leader'); assert.equal(o.roster.length, 4);
  });

  await check('Choice and records without an agreed role are untouched (old functions still work for them)', async () => {
    const db = await freshDb();
    const r = (await db.query(`select * from cs_tbt_issue_email($1, 'choice-x', 'T', 'Choice Tech (Test)', 'c@example.invalid', $2::date, false, $3, $4::timestamptz)`,
      [CHOICE, WEEK, SITE, future()])).rows[0];
    assert.ok(r.assignment_id);
    await db.query(`update cs_tbt_assignments set role = 'leader', roster_job_id = $2 where id = $1`, [r.assignment_id, J.choice]);
    const o = (await db.query('select * from cs_tbt_link_open($1)', [r.link_url.split('#')[1]])).rows[0];
    assert.deepEqual([o.company, o.role, o.roster], ['Choice', 'leader', ['Choice Tech (Test)']]);
  });

  console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
