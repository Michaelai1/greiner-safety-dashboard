/* Peine Phase 1 preview — data rules, privacy and build safety.
 * Nothing here touches Supabase, n8n, storage or authentication.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const SRC = path.join(root, 'peine-src');
const read = (f) => fs.readFileSync(f, 'utf8');

/* ---------- load the data module the way a browser would ---------- */
const win = {};
new Function('window', read(path.join(SRC, 'data.js')))(win);
const P = win.PEINE;
assert.ok(P, 'peine-src/data.js must define window.PEINE');

/* ------------------------------------------------------------------ *
 * 1. Exactly 26 fictional field employees, plus a few administrators
 * ------------------------------------------------------------------ */
assert.equal(P.FIELD.length, 26, 'there must be exactly 26 field employees');
assert.ok(P.ADMINS.length >= 2 && P.ADMINS.length <= 5, 'a few administrators');
assert.equal(new Set(P.FIELD.map((p) => p.name)).size, 26, 'no duplicate employees');
assert.ok(P.FIELD.every((p) => p.role === 'Field employee'),
  'only field employees are in the roster');
// Toolbox Talks go to field employees only.
assert.equal(P.ASSIGNMENTS.length, P.FIELD.length,
  'one assignment per field employee and no more');
const fieldIds = new Set(P.FIELD.map((p) => p.id));
assert.ok(P.ASSIGNMENTS.every((a) => fieldIds.has(a.employeeId)),
  'no administrator may be assigned a Toolbox Talk');

/* ------------------------------------------------------------------ *
 * 2. Tokens: opaque, unique, per assignment, no identifiers
 * ------------------------------------------------------------------ */
const tokens = P.FIELD.map((p) => p.token);
assert.equal(new Set(tokens).size, 26, 'every token must be unique');
for (const t of tokens) {
  assert.ok(/^demo-/.test(t), 'demo tokens must be obviously fictional');
  assert.ok(t.length >= 15, 'a token must not be trivially short');
  assert.ok(!/\d{3}-?\d{3}-?\d{4}/.test(t), 'a token must not look like a phone number');
  assert.ok(!/\d{7,}/.test(t), 'a token must not contain a long digit run');
  assert.ok(!/fe-\d/.test(t), 'a token must not contain an employee id');
}
// A token resolves to exactly one assignment, and an unknown one resolves to none.
for (const p of P.FIELD) {
  const a = P.assignmentByToken(p.token);
  assert.ok(a, 'every token must resolve');
  assert.equal(a.employeeId, p.id, 'a token must belong to exactly one employee');
}
assert.equal(P.assignmentByToken('demo-not-a-real-token'), null,
  'an unknown token must resolve to nothing — there is no generic submission URL');

/* ------------------------------------------------------------------ *
 * 3. Notification rules
 * ------------------------------------------------------------------ */
const S = P.SETTINGS;
assert.equal(S.sendDay, 'Monday');
assert.equal(S.firstReminderHours, 48, 'first reminder is 48 hours later');
assert.equal(S.repeatReminderHours, 24, 'then every 24 hours');
assert.equal(S.digestDay, 'Monday');
assert.equal(S.digestTime, '07:00', 'admin digest at 7:00 AM Monday');
assert.equal(P.SEND_AT.getDay(), 1, 'the initial send lands on a Monday');
assert.equal(P.SEND_AT.getHours(), +S.sendTime.split(':')[0], 'at the configured hour');
assert.equal(P.DIGEST_AT.getDay(), 1, 'the digest lands on a Monday');
assert.equal(P.DIGEST_AT.getHours(), 7, 'at 7am');
// The send time really is configurable.
{
  const moved = P.at(P.MONDAY, '06:15');
  assert.equal(moved.getHours(), 6, 'the send hour is configurable');
  assert.equal(moved.getMinutes(), 15, 'and the minute');
}

const now = new Date();
{
  const open = P.ASSIGNMENTS.find((a) => !a.submitted);
  assert.ok(open, 'the fixture must include an incomplete assignment');
  const r = P.remindersFor(open, now);
  assert.ok(r.length >= 1, 'an incomplete assignment gets reminders');
  assert.equal(Math.round((r[0] - open.delivered) / 3600000), 48,
    'the first reminder is 48 hours after delivery');
  if (r.length > 1) {
    assert.equal(Math.round((r[1] - r[0]) / 3600000), 24,
      'later reminders repeat every 24 hours');
  }
  assert.ok(r.every((t) => t <= now), 'a reminder is never shown before it would fire');
}
{
  // Someone who finished inside the window is never reminded.
  const quick = P.ASSIGNMENTS.find((a) => a.submitted &&
    (a.submitted - a.delivered) / 3600000 < S.firstReminderHours);
  assert.ok(quick, 'the fixture must include someone who finished quickly');
  assert.equal(P.remindersFor(quick, now).length, 0,
    'no reminder may be sent to someone who already signed');
}
// Overdue = still incomplete past the first reminder window.
for (const a of P.ASSIGNMENTS) {
  const expected = !a.submitted &&
    now > new Date(a.delivered.getTime() + S.firstReminderHours * 3600000);
  assert.equal(P.isOverdue(a, now), expected, 'overdue must follow the rule');
  if (a.submitted) assert.equal(P.isOverdue(a, now), false, 'a completed talk is never overdue');
}

/* ------------------------------------------------------------------ *
 * 4. Completion and engagement figures are derived
 * ------------------------------------------------------------------ */
{
  const done = P.ASSIGNMENTS.filter((a) => a.submitted);
  const out = P.ASSIGNMENTS.filter((a) => !a.submitted);
  assert.equal(done.length + out.length, 26, 'completed plus outstanding is the roster');
  assert.ok(done.length >= 15, 'the demo should read as a healthy week');
  assert.ok(out.length >= 2, 'but with real outstanding people');
  const over = P.ASSIGNMENTS.filter((a) => P.isOverdue(a, now));
  assert.ok(over.every((a) => out.includes(a)), 'overdue is a subset of outstanding');

  // every completed assignment carries the timestamps the office displays
  for (const a of done) {
    assert.ok(a.delivered, 'delivery time recorded');
    assert.ok(a.opened, 'first opening recorded');
    assert.ok(a.lastActive, 'last activity recorded');
    assert.ok(a.submitted, 'submission recorded');
    assert.ok(a.activeMs > 0, 'active engagement time recorded');
    assert.ok(a.opened >= a.delivered, 'cannot open before delivery');
    assert.ok(a.submitted >= a.opened, 'cannot submit before opening');
  }
  // someone never opened it: no engagement, no opening
  const never = P.ASSIGNMENTS.filter((a) => !a.opened);
  assert.ok(never.length >= 1, 'the fixture must include someone who never opened it');
  assert.ok(never.every((a) => a.activeMs === 0 && !a.submitted),
    'never opened means no engagement and no submission');
}

/* ------------------------------------------------------------------ *
 * 5. Training documents — records only, never scored
 * ------------------------------------------------------------------ */
{
  assert.ok(P.TRAINING.length > 26, 'several documents per employee');
  assert.ok(P.TRAINING.every((t) => fieldIds.has(t.employeeId)), 'records belong to real employees');
  assert.ok(P.TRAINING.every((t) => t.name && t.issued && t.expires),
    'every record needs a name, an issue date and an expiry');
  assert.ok(P.TRAINING.every((t) => t.expires > t.issued), 'expiry must follow issue');
  const buckets = { current: 0, soon: 0, expired: 0 };
  P.TRAINING.forEach((t) => { buckets[P.certStatus(t, now).key]++; });
  for (const k of ['current', 'soon', 'expired']) {
    assert.ok(buckets[k] > 0, `the filters need at least one ${k} record`);
  }
  assert.ok(buckets.current > buckets.expired, 'most records should be current');
  // No requirement-by-role mapping exists, so nothing computes compliance.
  const office = read(path.join(SRC, 'office/index.html'));
  assert.ok(/requirements by role are not configured/i.test(office),
    'the page must say requirements are not configured');
  assert.ok(!/complianceP(er)?cent|trainingCompliance/i.test(office),
    'no training compliance percentage may be calculated');
}

/* ------------------------------------------------------------------ *
 * 6. Engagement is measured honestly
 * ------------------------------------------------------------------ */
{
  const phone = read(path.join(SRC, 'phone/index.html'));
  assert.ok(phone.includes("document.addEventListener('visibilitychange'"),
    'the clock must react to visibility');
  assert.ok(phone.includes('if (document.hidden) engStop(); else engStart();'),
    'hiding the page must stop the clock');
  assert.ok(phone.includes("window.addEventListener('pagehide', engStop)"),
    'leaving the page must stop the clock');
  assert.ok(phone.includes('Active engagement time'), 'the label must be used');
  assert.ok(/not proof of reading and not proof of comprehension|not proof of reading/i.test(phone),
    'it must be stated that this is not proof of reading or comprehension');
  assert.ok(/background|locked/i.test(phone),
    'it must be stated that backgrounded and locked-screen time is excluded');
  const office = read(path.join(SRC, 'office/index.html'));
  assert.ok(/not proof of reading/i.test(office),
    'the office must carry the same caveat');
}

/* ------------------------------------------------------------------ *
 * 6b. The document library is a separate, fictional fixture
 * ------------------------------------------------------------------ */
{
  assert.ok(Array.isArray(P.DOCS) && P.DOCS.length >= 8,
    'there must be a company document library');
  assert.ok(Array.isArray(P.DOC_CATS) && P.DOC_CATS.length >= 3,
    'the library must be grouped into categories');
  const cats = new Set(P.DOC_CATS.map((c) => c[0]));
  assert.ok(P.DOCS.every((d) => cats.has(d.cat)),
    'every document must sit in a declared category');
  assert.equal(new Set(P.DOCS.map((d) => d.id)).size, P.DOCS.length,
    'document ids must be unique');
  assert.ok(P.DOCS.every((d) => d.pages > 0 && d.kb > 0),
    'every document needs a page count and a size');
  // The library is company-wide: it must not name a person.
  const people = new Set(P.FIELD.map((p) => p.name).concat(P.ADMINS.map((a) => a.name)));
  assert.ok(P.DOCS.every((d) => ![...people].some((n) => d.title.includes(n))),
    'the document library must not name an employee');
}

/* ------------------------------------------------------------------ *
 * 7. The office stays narrow, and the field flow needs no login
 * ------------------------------------------------------------------ */
{
  const office = read(path.join(SRC, 'office/index.html'));
  const tabs = [...office.matchAll(/\['(overview|talks|training|documents)', '([^']+)'\]/g)]
    .map((m) => m[2]);
  assert.deepEqual(tabs, ['Overview', 'Toolbox Talks', 'Training', 'Documents'],
    'the office must have exactly four sections, with Training and Documents separate');
  // Each section needs a renderer, and the combined label must be gone.
  for (const fn of ['overview', 'talks', 'training', 'documents']) {
    assert.ok(new RegExp('function ' + fn + '\\(').test(office),
      `the office needs a ${fn}() renderer`);
  }
  assert.ok(!/Training Documents/.test(office),
    'the combined "Training Documents" label must be gone');
  // Documents is a company library, distinct from the per-employee records.
  assert.ok(/P\.DOCS/.test(office), 'Documents must read the document library fixture');
  assert.ok(/P\.TRAINING/.test(office), 'Training must still read the certification records');
  assert.ok(/private bucket/i.test(office),
    'Documents must say the live build keeps files in a private bucket');
  const phone = read(path.join(SRC, 'phone/index.html'));
  for (const banned of ['PIN', 'password', 'Sign in', 'signin', 'login']) {
    const re = new RegExp('(placeholder|label|>)\\s*' + banned, 'i');
    assert.ok(!re.test(phone), `Phase 1 must not ask for a ${banned}`);
  }
  assert.ok(/no PIN and no login/i.test(phone), 'the demo must say there is no login');
  // Future expansion is explained but not built.
  assert.ok(/Future expansion/i.test(phone), 'future expansion must be explained');
  assert.ok(/not built|not part of Phase 1/i.test(phone), 'and marked as not built');
  assert.ok(!/portalLogin|pinPortal/i.test(phone), 'the PIN portal must not be implemented');
}

/* ------------------------------------------------------------------ *
 * 8. Security design is documented
 * ------------------------------------------------------------------ */
{
  const landing = read(path.join(SRC, 'index.html'));
  for (const [re, what] of [
    [/signed or hashed assignment token/i, 'signed/hashed tokens'],
    [/expire/i, 'token expiry'],
    [/never contain or reveal a phone number or an employee ID/i, 'no identifiers in tokens'],
    [/no generic public submission URL/i, 'no generic submission URL'],
  ]) assert.ok(re.test(landing), `the security design must document ${what}`);
}

/* ------------------------------------------------------------------ *
 * 9. Pricing is stated, and kept off the operational screens
 * ------------------------------------------------------------------ */
{
  assert.equal(P.PRICING.implementation, 750, 'one-time implementation');
  assert.equal(P.PRICING.monthly, 400, 'monthly');
  assert.ok(P.PRICING.includes.some((x) => /26 field employees/.test(x)), 'includes the 26 seats');
  for (const need of ['Toolbox Talk scheduling', 'reminders', 'Engagement analytics',
    'training-document management', 'Office / admin access']) {
    assert.ok(P.PRICING.includes.some((x) => new RegExp(need, 'i').test(x)),
      `pricing must list: ${need}`);
  }
  assert.ok(P.PRICING.excludes.some((x) => /PIN portal/i.test(x)),
    'the PIN portal must be excluded');
  assert.ok(P.PRICING.excludes.some((x) => /separate approval/i.test(x)),
    'extra modules need separate approval');
  // Not on the working screens.
  for (const f of ['office/index.html', 'phone/index.html']) {
    const src = read(path.join(SRC, f));
    assert.ok(!/\$750|\$400/.test(src), `${f} must not show pricing`);
  }
}

/* ------------------------------------------------------------------ *
 * 10. Privacy and isolation, in source and in the build
 * ------------------------------------------------------------------ */
const NAMES_FILE = path.join(root, 'tests/real-names.local.json');
let REAL = [], FIRST = [], HAVE = false;
if (fs.existsSync(NAMES_FILE)) {
  const j = JSON.parse(read(NAMES_FILE));
  REAL = j.people || []; FIRST = j.firstNames || []; HAVE = true;
}
const srcFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f); else if (/\.(html|js|css)$/.test(e.name)) srcFiles.push(f);
  }
})(SRC);
assert.ok(srcFiles.length >= 4, 'the Peine source must be present');

for (const f of srcFiles) {
  const s = read(f);
  const rel = path.relative(root, f);
  for (const [re, what] of [
    [/[a-z0-9]{20}\.supabase\.co/i, 'a Supabase URL'],
    [/eyJhbGciOiJIUzI1NiI/, 'a JWT'],
    [/https?:\/\/[^'"\s]*n8n[^'"\s]*/i, 'an n8n endpoint'],
    [/\/Users\/[A-Za-z]/, 'a local path'],
    [/file:\/\/[^'"\s]/, 'a file:// URL'],
    [/\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/, 'a phone number'],
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'an email address'],
  ]) assert.ok(!re.test(s), `${rel} contains ${what}`);
  if (HAVE) {
    for (const p of REAL) assert.ok(!s.includes(p), `${rel} names a real person`);
    for (const n of FIRST) {
      assert.ok(!new RegExp('\\b' + n + '\\b').test(s), `${rel} names a real first name`);
    }
  }
  // No network call of any kind.
  for (const call of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) {
    if (path.basename(f) === 'phone/index.html') continue;
    assert.ok(!s.includes(call), `${rel} must make no network call — found ${call}`);
  }
}
if (!HAVE) console.warn('  ! real-name scan SKIPPED: tests/real-names.local.json is absent');

// The built artifact, if present.
const BUILT = path.join(root, 'demo-site/peine');
if (fs.existsSync(BUILT)) {
  const built = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (/\.(html|js|css|json|txt)$/.test(e.name)) built.push(f);
    }
  })(BUILT);
  for (const f of built) {
    const s = read(f);
    assert.match(s.slice(0, 2000) + s, /./, 'file readable');
    for (const [re, what] of [
      [/[a-z0-9]{20}\.supabase\.co/i, 'a Supabase URL'],
      [/eyJhbGciOiJIUzI1NiI/, 'a JWT'],
      [/\/Users\/[A-Za-z]/, 'a local path'],
      [/file:\/\/[^'"\s]/, 'a file:// URL'],
      [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'an email address'],
    ]) assert.ok(!re.test(s), `${path.relative(root, f)} contains ${what}`);
  }
  for (const page of ['index.html', 'office/index.html', 'phone/index.html']) {
    assert.match(read(path.join(BUILT, page)), /name="robots" content="noindex, nofollow"/,
      `peine/${page} must carry noindex`);
  }
  // Demo Data labelling
  assert.ok(/Demo Data/.test(read(path.join(BUILT, 'index.html'))), 'landing must be labelled');
  assert.ok(/Demo Data/.test(read(path.join(BUILT, 'office/index.html'))), 'office must be labelled');
  assert.ok(/DEMO DATA/i.test(read(path.join(BUILT, 'phone/index.html'))), 'phone must be labelled');
}

console.log(`Peine demo verification passed (${P.FIELD.length} field employees, ` +
  `${P.ASSIGNMENTS.filter((a) => a.submitted).length} signed, ` +
  `${P.TRAINING.length} training records, tokens opaque, no network).`);
