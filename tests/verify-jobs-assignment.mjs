/* The "Add Inspection for This Week" shortcut must be a shortcut, not a second
 * assignment system. Everything it can do, the Jobs tab already does, through
 * the same records and the same rules.
 *
 * Nothing here touches Supabase, n8n, storage or authentication.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const js = fs.readFileSync(new URL('office.js', root), 'utf8');
const demoSrc = fs.readFileSync(new URL('office-demo.js', root), 'utf8');
const includes = (text, msg) => assert.ok(js.includes(text), msg);

const win = { location: { search: '?demo=1' }, URLSearchParams };
new Function('window', 'location', 'URLSearchParams', demoSrc)(win, win.location, URLSearchParams);
const DEMO = win.DEMO;

/* ------------------------------------------------------------------ *
 * 1. There is exactly one assignment system, and Jobs owns it
 * ------------------------------------------------------------------ */
includes('function siAddInspection()', 'the shortcut must exist');
assert.ok(!js.includes('function siAddRequirement('),
  'the separate requirement-creation panel must be gone');

// The shortcut ends by opening the Jobs drawer for the chosen job.
includes("go('jobs');", 'the shortcut must navigate to Jobs');
includes('openJob(id);', 'the shortcut must open the Jobs drawer');

// It writes nothing itself — the Jobs control does the writing.
const shortcut = js.slice(js.indexOf('function siAddInspection()'),
  js.indexOf('/* ---------------- B · Submission Log'));
for (const forbidden of ['cs_portal_user_forms_set', 'post(', 'SI_ASSIGN[', 'push(']) {
  assert.ok(!shortcut.includes(forbidden),
    `the shortcut must not write assignments itself — found "${forbidden}"`);
}
// The only write path is the one the Jobs tab already uses.
// Count real calls, not the comments that describe them.
const saveCalls = (js.match(/post\('cs_portal_user_forms_set'/g) || []).length;
assert.equal(saveCalls, 1, 'there must be exactly one place that saves form assignments');
const jobsSave = js.slice(js.indexOf('function loadJobFieldAccess'), js.indexOf('function openJob('));
assert.ok(jobsSave.includes('cs_portal_user_forms_set'),
  'that one place must be the Jobs field-access editor');

/* ------------------------------------------------------------------ *
 * 2. Requirements are derived from the Jobs records, not stored twice
 * ------------------------------------------------------------------ */
includes('function siReqs()', 'requirements must be derivable');
includes("post('cs_portal_job_field_users'", 'requirements must read the Jobs assignment records');
assert.ok(!demoSrc.includes('var REQUIREMENTS'),
  'there must be no separate requirements fixture');
assert.ok(!js.includes('window.DEMO.requirements'),
  'nothing may read a separate requirements list');
// Each derived requirement is tagged as coming from Jobs.
includes('fromJobs: true', 'derived requirements must be marked as coming from Jobs');

/* ------------------------------------------------------------------ *
 * 3. The write path is the guard: unsupported forms cannot be assigned
 * ------------------------------------------------------------------ */
// The older checkbox-style JHA ('jobsiteanalysis') is no longer offered for new
// work (Tony, Oct 1): the guided JHA is the one JHA form.
const SUPPORTED = ['hotwork', 'aerial', 'forklift', 'jha'];

// The canonical list the office already had.
const permBlock = js.slice(js.indexOf('var FIELD_PERM_FORMS = ['), js.indexOf('function loadJobFieldAccess'));
for (const k of SUPPORTED) {
  assert.ok(permBlock.includes(`key: '${k}'`), `${k} must be a canonical permission key`);
}
// And the shortcut offers exactly those.
const readyKeys = [...js.slice(js.indexOf('var SI_FORMS_READY = ['), js.indexOf('var SI_FORMS_REVIEW'))
  .matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]);
assert.deepEqual(readyKeys.slice().sort(), SUPPORTED.slice().sort(),
  'the shortcut must offer exactly the supported forms');

await (async () => {
  // Unsupported keys are dropped by the store, whichever caller sends them.
  const r = await DEMO.call('cs_portal_user_forms_set', {
    p_user_id: 'fu-1', p_job_id: 'demo-job-a',
    p_form_keys: ['jha', 'ladder', 'powertool', 'powderactuated', 'scaffold'],
  });
  assert.equal(r.ok, true, 'a valid save must succeed');
  assert.deepEqual(r.form_keys, ['jha'], 'unsupported forms must be dropped, not stored');
  for (const bad of ['ladder', 'powertool', 'powderactuated', 'scaffold']) {
    assert.ok(!r.form_keys.includes(bad), `"${bad}" must never be assignable`);
  }

  // A user cannot be assigned forms on a job they are not on.
  const wrong = await DEMO.call('cs_portal_user_forms_set',
    { p_user_id: 'fu-1', p_job_id: 'demo-job-f', p_form_keys: ['jha'] });
  assert.equal(wrong.ok, false, 'a cross-job assignment must be refused');
})();

/* ------------------------------------------------------------------ *
 * 4. The shortcut produces the same result as editing through Jobs
 * ------------------------------------------------------------------ */
await (async () => {
  const snapshot = () => JSON.parse(JSON.stringify(DEMO.fieldUsers));
  const before = snapshot();

  // Route A: the Jobs tab's save (this is literally the same call the
  // shortcut lands on, since the shortcut opens that editor).
  const viaJobs = await DEMO.call('cs_portal_user_forms_set',
    { p_user_id: 'fu-3', p_job_id: 'demo-job-b', p_form_keys: ['jha', 'hotwork'] });
  const afterJobs = snapshot();

  // Reset, then apply the identical payload again — the shortcut cannot
  // produce anything different because it uses this same endpoint.
  await DEMO.call('cs_portal_user_forms_set',
    { p_user_id: 'fu-3', p_job_id: 'demo-job-b',
      p_form_keys: before.find((u) => u.id === 'fu-3').form_keys });
  const viaShortcut = await DEMO.call('cs_portal_user_forms_set',
    { p_user_id: 'fu-3', p_job_id: 'demo-job-b', p_form_keys: ['jha', 'hotwork'] });
  const afterShortcut = snapshot();

  assert.deepEqual(viaShortcut, viaJobs, 'both routes must return the same result');
  assert.deepEqual(afterShortcut, afterJobs, 'both routes must leave the same records');

  /* ---- no duplicate requirements ---- */
  const u = DEMO.fieldUsers.find((x) => x.id === 'fu-3');
  assert.equal(new Set(u.form_keys).size, u.form_keys.length,
    'a form may not be assigned to the same user twice');
  // Saving the same thing twice changes nothing.
  const twice = await DEMO.call('cs_portal_user_forms_set',
    { p_user_id: 'fu-3', p_job_id: 'demo-job-b', p_form_keys: ['jha', 'hotwork'] });
  assert.deepEqual(twice.form_keys, viaJobs.form_keys, 'a repeat save must be idempotent');
  assert.deepEqual(snapshot(), afterJobs, 'a repeat save must not duplicate anything');

  /* ---- employee / job access unchanged ---- */
  before.forEach((b) => {
    const now = DEMO.fieldUsers.find((x) => x.id === b.id);
    assert.equal(now.job_id, b.job_id, `${b.name} must stay on the same job`);
    assert.equal(now.name, b.name, 'no employee may be renamed');
    assert.equal(now.title, b.title, 'no employee role may change');
  });
  assert.equal(DEMO.fieldUsers.length, before.length,
    'no field user may be added or removed by a form assignment');

  /* ---- equipment unchanged ---- */
  const equipBefore = JSON.parse(JSON.stringify(DEMO.equipment));
  await DEMO.call('cs_portal_user_forms_set',
    { p_user_id: 'fu-3', p_job_id: 'demo-job-b', p_form_keys: ['jha', 'forklift'] });
  assert.deepEqual(DEMO.equipment, equipBefore,
    'assigning a form must not change equipment assignments');

  // restore
  await DEMO.call('cs_portal_user_forms_set',
    { p_user_id: 'fu-3', p_job_id: 'demo-job-b',
      p_form_keys: before.find((x) => x.id === 'fu-3').form_keys });
})();

/* ------------------------------------------------------------------ *
 * 5. The shortcut is honest about what it does
 * ------------------------------------------------------------------ */
includes('Inspections are assigned to a job in <b>Jobs</b>',
  'the panel must say where assignment really happens');
includes('it does not create a separate schedule',
  'the panel must say it is not a second system');
includes('does not mark anything ', 'the panel must say it does not complete anything');
includes('Open assignment controls in Jobs', 'the action must say where it goes');

console.log('Jobs assignment verification passed ' +
  `(${SUPPORTED.length} assignable forms, one write path, ${DEMO.fieldUsers.length} field users unchanged).`);
