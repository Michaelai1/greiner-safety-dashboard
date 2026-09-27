/* Toolbox Talk office demo — verification.
 *
 * Loads the pure logic out of office.js and exercises it directly, so the
 * scheduling rules are tested rather than asserted about.
 *
 * Nothing here touches Supabase, n8n, Twilio, Resend, the network, or any
 * production table. The module under test is the ?demo=1 path only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../office.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../office.html', import.meta.url), 'utf8');
const includes = (hay, text, message) => assert.ok(hay.includes(text), message);

/* ------------------------------------------------------------------ *
 * 0. Load the demo module's logic into a sandbox
 * ------------------------------------------------------------------ */
const start = js.indexOf('/* ==================== TOOLBOX TALKS — DEMO ONLY');
const endLogic = js.indexOf('function pgTalksDemo(');
assert.ok(start > -1, 'the Toolbox Talk demo module is missing from office.js');
assert.ok(endLogic > start, 'could not find the end of the demo logic block');

const logic = js.slice(start, endLogic);
const sliceFn = (name) => {
  const i = js.indexOf(`function ${name}(`);
  assert.ok(i > -1, `function ${name} is missing`);
  // to the start of the next top-level function declaration
  const j = js.indexOf('\n  function ', i + 1);
  return js.slice(i, j > -1 ? j : undefined);
};

const store = new Map();
const sandbox = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  location: { search: '?demo=1' },
  URLSearchParams,
  console,
};

const exported = [
  'TBT_DEMO', 'TBT_KEY', 'TBT_WEEKS_NO_REPEAT', 'TBT_LIB', 'TBT_COMPANIES',
  'TBT_SEED_FILENAMES', 'tbtEligible', 'tbtById', 'tbtBlank', 'tbtDefaultState',
  'tbtLoad', 'tbtSave', 'tbtMonday', 'tbtMondayISO', 'tbtMondayLabel',
  'tbtRecentIds', 'tbtRotation', 'tbtAutoPick', 'tbtTalkForWeek',
  'tbtWeekCompletions', 'tbtCompletionStats', 'tbtQueueAdd', 'tbtQueueMove',
  'getTBT', 'setCompany',
];

const factory = new Function('localStorage', 'location', 'URLSearchParams', 'console', 'window', `
  ${logic}
  ${sliceFn('tbtQueueAdd')}
  ${sliceFn('tbtQueueMove')}
  // stubs for the render/notify calls the queue mutators make
  function pgTalksDemo() {}
  function toast(msg) { TOASTS.push(msg); }
  var TOASTS = [];
  function getTBT() { return TBT; }
  function setCompany(k) { tbtLoad(); TBT.company = k; tbtSave(); }
  // Drops the in-memory cache so a test can simulate a fresh page load.
  function reload() { TBT = null; return tbtLoad(); }
  return { ${exported.join(', ')}, reload: reload, TOASTS: TOASTS };
`);
// The office module reads its completion fixtures from window.DEMO when the
// demo build supplies them. This suite tests the scheduling logic on its own,
// so it runs with no fixtures present and the module falls back to empty.
const M = factory(sandbox.localStorage, sandbox.location, URLSearchParams, console, {});

/* ------------------------------------------------------------------ *
 * 1. Library classification
 * ------------------------------------------------------------------ */
assert.equal(M.TBT_LIB.length, 127, 'the library must carry all 127 delivered attachments');

const uniqueHashes = new Set(M.TBT_LIB.map((d) => d.i));
assert.equal(uniqueHashes.size, 124, 'there must be 124 unique talks (3 duplicate copies)');

const byStatus = {};
for (const d of M.TBT_LIB) byStatus[d.s] = (byStatus[d.s] || 0) + 1;
assert.deepEqual(byStatus, { Ready: 105, Collection: 12, Excluded: 7, 'Needs Review': 3 },
  `classification totals changed: ${JSON.stringify(byStatus)}`);

// A "Volume" document is a bundle of many talks. It must never be schedulable
// as a single talk — either it is a Collection, or it is excluded supporting
// material (e.g. the Volume V corrected sheet).
for (const d of M.TBT_LIB) {
  if (/\bvolume\b/i.test(d.f)) {
    assert.notEqual(d.s, 'Ready',
      `"${d.f}" is a Volume and must not be schedulable as one talk`);
    assert.ok(['Collection', 'Excluded'].includes(d.s),
      `"${d.f}" has an unexpected classification: ${d.s}`);
  }
}

// The three duplicate copies must be excluded and must name their original.
const dupes = M.TBT_LIB.filter((d) => /duplicate copy of/i.test(d.note || ''));
assert.equal(dupes.length, 3, `expected 3 duplicate copies, found ${dupes.length}`);
for (const d of dupes) {
  assert.equal(d.s, 'Excluded', `duplicate "${d.f}" must be excluded from scheduling`);
  const original = /duplicate copy of (.+)$/i.exec(d.note)[1].trim();
  assert.ok(M.TBT_LIB.some((o) => o.f === original && o.i === d.i),
    `"${d.f}" claims to duplicate "${original}", which must share its content hash`);
}

// Anything uncertain is flagged for review, never silently scheduled.
const review = M.TBT_LIB.filter((d) => d.s === 'Needs Review');
assert.equal(review.length, 3, 'three documents could not be read confidently');
assert.ok(review.every((d) => d.note), 'every flagged document must say why');

// Only Ready talks may be scheduled.
const elig = M.tbtEligible();
assert.equal(elig.length, 105, 'only the 105 standalone talks are eligible to schedule');
assert.ok(elig.every((d) => d.s === 'Ready'), 'an ineligible document leaked into the schedulable pool');

// Original filenames are preserved verbatim.
assert.ok(M.TBT_LIB.every((d) => typeof d.f === 'string' && d.f.length > 0),
  'every library entry must keep its original filename');
assert.ok(M.TBT_LIB.some((d) => d.f.endsWith('.pdf')), 'filenames must keep their extension');

/* ------------------------------------------------------------------ *
 * 2. Seeded queue
 * ------------------------------------------------------------------ */
assert.equal(M.TBT_SEED_FILENAMES.length, 6, 'six clearly-valid standalone talks must be seeded');
for (const f of M.TBT_SEED_FILENAMES) {
  const hit = M.TBT_LIB.filter((d) => d.f === f);
  assert.equal(hit.length >= 1, true, `seed filename not found in the library: ${f}`);
  assert.equal(hit[0].s, 'Ready', `seed "${f}" must be a standalone talk`);
}

/* ------------------------------------------------------------------ *
 * 3. Monday maths
 * ------------------------------------------------------------------ */
const m0 = M.tbtMonday(0);
assert.equal(m0.getDay(), 1, 'week 0 must resolve to a Monday');
for (const n of [1, 5, 12, 40]) {
  const mn = M.tbtMonday(n);
  assert.equal(mn.getDay(), 1, `week ${n} must also be a Monday`);
  const weeks = Math.round((mn - m0) / (7 * 24 * 3600 * 1000));
  assert.equal(weeks, n, `week ${n} must be exactly ${n} weeks after week 0`);
}
assert.match(M.tbtMondayISO(0), /^\d{4}-\d{2}-\d{2}$/, 'the week key must be an ISO date');
// Negative offsets are how the 12-week cutoff is computed.
const cutoff = M.tbtMondayISO(-M.TBT_WEEKS_NO_REPEAT);
assert.ok(cutoff < M.tbtMondayISO(0), 'the no-repeat cutoff must be in the past');

/* ------------------------------------------------------------------ *
 * 4. Company separation
 * ------------------------------------------------------------------ */
const keys = Object.keys(M.TBT_COMPANIES);
assert.deepEqual(keys.sort(), ['choice', 'greiner', 'peine'],
  'Greiner, Choice and Peine must each be configured');

assert.equal(M.TBT_COMPANIES.choice.defaultMode, 'group', 'Choice defaults to foreman-led group');
assert.equal(M.TBT_COMPANIES.peine.defaultMode, 'individual', 'Peine defaults to individual');
assert.equal(M.TBT_COMPANIES.choice.modeConfigurable, false,
  "Choice's completion method is confirmed and must be locked");
assert.equal(M.TBT_COMPANIES.peine.modeConfigurable, false,
  "Peine's completion method is confirmed and must be locked");
assert.equal(M.TBT_COMPANIES.greiner.modeConfigurable, true,
  'Greiner must stay configurable');

// Choice's confirmed submitters are the three with full access.
const choiceLeads = M.TBT_COMPANIES.choice.employees.filter((e) => e.lead).map((e) => e.n);
assert.deepEqual(choiceLeads.sort(), ['Adrian Gable (Demo)', 'Ainsley Frost (Demo)', 'Zane Fairlie (Demo)'],
  `Choice's submitters must be exactly the three confirmed names, got ${choiceLeads.join(', ')}`);
assert.equal(M.TBT_COMPANIES.choice.groups.length, 1,
  'Choice runs one group talk at the Monday morning meeting');

// Each company keeps its own independent state.
const st = M.tbtDefaultState();
for (const k of keys) {
  assert.ok(st.companies[k], `${k} must have its own state bucket`);
  assert.ok(Array.isArray(st.companies[k].queue), `${k} must have its own queue`);
  assert.equal(st.companies[k].mode, M.TBT_COMPANIES[k].defaultMode,
    `${k} must start in its own default completion mode`);
}
assert.notEqual(st.companies.choice.queue, st.companies.peine.queue,
  'company queues must not share an array reference');

/* ------------------------------------------------------------------ *
 * 5. Seeded state, persistence and reset
 * ------------------------------------------------------------------ */
store.clear();
const loaded = M.reload();
assert.equal(loaded.companies.greiner.queue.length, 6, 'a fresh state seeds 6 weeks');
M.tbtSave();
assert.ok(store.has(M.TBT_KEY), 'state must persist to localStorage');
const persisted = JSON.parse(store.get(M.TBT_KEY));
assert.equal(persisted.companies.greiner.queue.length, 6, 'the persisted queue must survive a reload');

// Reset: clearing the key rebuilds the seeded defaults.
store.clear();
const afterReset = M.tbtDefaultState();
assert.equal(afterReset.companies.greiner.queue.length, 6, 'reset must restore the seeded schedule');
assert.deepEqual(afterReset.companies.greiner.completions, [], 'reset must clear completions');
assert.deepEqual(afterReset.companies.greiner.history, [], 'reset must clear history');

/* ------------------------------------------------------------------ *
 * 6. Queue add / duplicate prevention / move
 * ------------------------------------------------------------------ */
store.clear();
M.reload();
const co = () => M.getTBT().companies[M.getTBT().company];

const before = co().queue.length;
const dup = co().queue[0];
M.tbtQueueAdd(dup);
assert.equal(co().queue.length, before, 'a talk already in the queue must not be added twice');
assert.equal(co().queue.filter((id) => id === dup).length, 1, 'no duplicate ids in the queue');

const fresh = elig.map((d) => d.i).find((id) => co().queue.indexOf(id) === -1);
M.tbtQueueAdd(fresh);
assert.equal(co().queue.length, before + 1, 'a new talk must be added');
assert.equal(co().queue[co().queue.length - 1], fresh, 'a new talk is appended to the end');

// A collection can never be queued as a single talk.
const collection = M.TBT_LIB.find((d) => d.s === 'Collection');
const lenBefore = co().queue.length;
M.tbtQueueAdd(collection.i);
assert.equal(co().queue.length, lenBefore,
  `a Collection ("${collection.f}") must not be schedulable as one talk`);

// Move to top preserves membership and moves exactly one item.
const order = co().queue.slice();
M.tbtQueueMove(3, 0);
const moved = co().queue;
assert.equal(moved[0], order[3], 'Move to top must put the chosen talk first');
assert.equal(moved.length, order.length, 'reordering must not add or drop talks');
assert.deepEqual(moved.slice().sort(), order.slice().sort(), 'reordering must preserve the set');

/* ------------------------------------------------------------------ *
 * 7. Auto-fallback: shuffle-once rotation when there is no history
 * ------------------------------------------------------------------ */
store.clear();
M.reload();
const c1 = co();
c1.queue = [];
c1.history = [];
c1.rotation = [];

const rot1 = M.tbtRotation(c1).slice();
assert.equal(rot1.length, elig.length, 'the rotation must cover every eligible talk');
assert.equal(new Set(rot1).size, rot1.length, 'the rotation must not repeat a talk');
const rot2 = M.tbtRotation(c1).slice();
assert.deepEqual(rot2, rot1, 'the rotation is shuffled once, then kept stable');

// Auto-pick is stable: reading the same week twice gives the same talk.
const pick0a = M.tbtAutoPick(c1, 0);
const pick0b = M.tbtAutoPick(c1, 0);
assert.equal(pick0a, pick0b, 'auto-pick must be stable for a given week (safe to call while rendering)');
assert.notEqual(M.tbtAutoPick(c1, 1), pick0a, 'consecutive weeks must get different talks');

// Auto-pick only ever returns a schedulable talk.
for (let n = 0; n < 20; n++) {
  const id = M.tbtAutoPick(c1, n);
  assert.equal(M.tbtById(id).s, 'Ready', `auto-pick returned a non-schedulable document at week ${n}`);
}

/* ------------------------------------------------------------------ *
 * 8. Auto-fallback: least-recently-used with a 12-week exclusion
 * ------------------------------------------------------------------ */
store.clear();
M.reload();
const c2 = co();
c2.queue = [];
c2.rotation = [];

// Give EVERY eligible talk a history entry so the LRU ordering is the only
// thing that can decide, then make one of them recent.
const ids = elig.map((d) => d.i);
const recentId = ids[0];
const oldestId = ids[1];
c2.history = ids.map((id, i) => ({
  // everything 20+ weeks back, except recentId which is last week
  week: id === recentId ? M.tbtMondayISO(-1)
    : id === oldestId ? M.tbtMondayISO(-90)
    : M.tbtMondayISO(-20 - (i % 40)),
  talkId: id,
}));

const recentIds = M.tbtRecentIds(c2);
assert.ok(recentIds.includes(recentId), 'a talk used last week must count as recent');
assert.ok(!recentIds.includes(oldestId), 'a talk used 90 weeks ago must not count as recent');

const nextUp = M.tbtAutoPick(c2, 0);
assert.notEqual(nextUp, recentId,
  'a talk used within the last 12 weeks must not be auto-selected again');
assert.equal(nextUp, oldestId,
  'auto-selection must choose the least recently used eligible talk');

// Nothing inside the exclusion window may appear in the next several weeks.
for (let n = 0; n < 8; n++) {
  assert.notEqual(M.tbtAutoPick(c2, n), recentId,
    `the recently-used talk reappeared at week ${n}`);
}

// When every talk is inside the window, selection still returns something
// rather than leaving a week with no talk.
const c3 = M.tbtBlank('greiner');
c3.queue = [];
c3.history = ids.map((id) => ({ week: M.tbtMondayISO(-1), talkId: id }));
const forced = M.tbtAutoPick(c3, 0);
assert.ok(forced && M.tbtById(forced), 'with everything recent, a talk must still be selected');

/* ------------------------------------------------------------------ *
 * 9. Queue takes priority, auto-fallback fills the rest
 * ------------------------------------------------------------------ */
store.clear();
M.reload();
const c4 = co();
const queued = c4.queue.slice();
assert.equal(queued.length, 6, 'expected the seeded 6-week queue');
for (let n = 0; n < queued.length; n++) {
  const w = M.tbtTalkForWeek(c4, n);
  assert.equal(w.id, queued[n], `week ${n} must come from the queue`);
  assert.equal(w.auto, false, `week ${n} is scheduled, not auto-selected`);
}
const past = M.tbtTalkForWeek(c4, queued.length);
assert.ok(past, 'the week after the queue must still resolve to a talk');
assert.equal(past.auto, true, 'the week after the queue must be flagged as auto-selected');
assert.ok(!queued.includes(past.id), 'the auto-selected talk must not duplicate a queued one');

/* ------------------------------------------------------------------ *
 * 10. Completion stats — group mode
 *
 * In group mode the unit is the job/group, not the person: one foreman
 * submission credits the whole group.
 * ------------------------------------------------------------------ */
const week = M.tbtMondayISO(0);
const gDef = M.TBT_COMPANIES.choice;
const gco = M.tbtBlank('choice');
gco.mode = 'group';

let s = M.tbtCompletionStats(gco, gDef, week);
assert.equal(s.mode, 'group', 'Choice must report in group mode');
assert.equal(s.unitLabel, 'jobs / groups', 'group mode counts jobs/groups');
assert.equal(s.total, gDef.groups.length, 'group mode totals groups, not people');
assert.equal(s.completed.length, 0, 'no submissions means nothing completed');
assert.equal(s.outstanding.length, gDef.groups.length, 'every group starts outstanding');
assert.equal(s.attendance, 0, 'no attendance before anyone submits');
assert.equal(s.pct, 0, 'an empty week is 0%');

// One group submits: the group is credited and attendance counts everyone
// named, including a manually added name.
gco.completions = [{
  week, kind: 'group', group: gDef.groups[0], presenter: 'Ainsley Frost (Demo)',
  roster: gDef.employees.slice(0, 4).map((e) => e.n), manual: ['Temp Helper'],
  at: new Date().toISOString(),
}];
s = M.tbtCompletionStats(gco, gDef, week);
assert.equal(s.completed.length, 1, 'one group submission credits one group');
assert.deepEqual(s.completed, [gDef.groups[0]], 'the credited group must be the one that submitted');
assert.equal(s.outstanding.length, gDef.groups.length - 1, 'the rest stay outstanding');
assert.equal(s.attendance, 5, 'attendance must count roster plus manual entries');
assert.equal(s.completed.length + s.outstanding.length, s.total,
  'completed plus outstanding must equal the total');
assert.equal(s.pct, 100, "Choice has one group, so one submission is 100%");

// A submission belongs to exactly one week.
assert.equal(M.tbtCompletionStats(gco, gDef, M.tbtMondayISO(1)).completed.length, 0,
  "last week's submission must not credit next week");
assert.equal(M.tbtCompletionStats(gco, gDef, M.tbtMondayISO(-1)).completed.length, 0,
  "this week's submission must not credit a past week");

// An individual record must not earn group credit.
const mixed = M.tbtBlank('choice');
mixed.mode = 'group';
mixed.completions = [{ week, kind: 'individual', employee: 'Ainsley Frost (Demo)', at: new Date().toISOString() }];
assert.equal(M.tbtCompletionStats(mixed, gDef, week).completed.length, 0,
  'an individual submission must not complete a group talk');

/* ------------------------------------------------------------------ *
 * 11. Completion stats — individual mode
 * ------------------------------------------------------------------ */
const iDef = M.TBT_COMPANIES.peine;
const ico = M.tbtBlank('peine');
ico.mode = 'individual';

s = M.tbtCompletionStats(ico, iDef, week);
assert.equal(s.mode, 'individual', 'Peine must report in individual mode');
assert.equal(s.unitLabel, 'employees', 'individual mode counts employees');
assert.equal(s.total, iDef.employees.length, 'individual mode totals people, not groups');
assert.equal(s.outstanding.length, iDef.employees.length, 'everyone starts outstanding');

ico.completions = iDef.employees.slice(0, 3).map((e) => ({
  week, kind: 'individual', employee: e.n, at: new Date().toISOString(),
}));
s = M.tbtCompletionStats(ico, iDef, week);
assert.equal(s.completed.length, 3, 'three people completed');
assert.equal(s.outstanding.length, iDef.employees.length - 3, 'outstanding must be the remainder');
assert.equal(s.completed.length + s.outstanding.length, s.total,
  'completed plus outstanding must equal the roster');
assert.equal(s.pct, Math.round((3 / iDef.employees.length) * 100), 'percentage must reflect people');

// Outstanding must name the people who still owe it, so the office can chase them.
const outNames = s.outstanding.map((e) => e.n);
const doneNames = s.completed.map((e) => e.n);
assert.equal(outNames.filter((n) => doneNames.includes(n)).length, 0,
  'nobody may be both completed and outstanding');

// The same person completing twice must not be double-counted.
ico.completions.push({
  week, kind: 'individual', employee: iDef.employees[0].n, at: new Date().toISOString(),
});
assert.equal(M.tbtCompletionStats(ico, iDef, week).completed.length, 3,
  'a duplicate completion for the same person must not inflate the count');

// A group record must not earn individual credit.
const mixed2 = M.tbtBlank('peine');
mixed2.mode = 'individual';
mixed2.completions = [{
  week, kind: 'group', group: iDef.groups[0],
  roster: iDef.employees.map((e) => e.n), manual: [], at: new Date().toISOString(),
}];
assert.equal(M.tbtCompletionStats(mixed2, iDef, week).completed.length, 0,
  'a group submission must not complete an individual-mode week');

/* ------------------------------------------------------------------ *
 * 12. The demo is gated, local, and leaves production alone
 * ------------------------------------------------------------------ */
includes(js, 'if (TBT_DEMO) return pgTalksDemo();',
  'the demo page must be reachable only behind the ?demo=1 gate');

// The whole demo module must never reach a live system. Comments are stripped
// first so that prose describing the isolation cannot satisfy or break this.
const moduleSrc = js.slice(start, js.indexOf('function pgTalks()'));
const moduleCode = moduleSrc
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
for (const forbidden of ['sb.from(', 'sb.rpc(', 'supabase', 'rpc(', 'fetch(',
  'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'WEBHOOK', 'twilio', 'resend',
  'n8n', 'SERVICE_ROLE', 'anonKey']) {
  assert.ok(!moduleCode.toLowerCase().includes(forbidden.toLowerCase()),
    `the Toolbox Talk demo module must stay local — found "${forbidden}"`);
}
// It must not touch a cs_* production table. The one cs_-prefixed string it is
// allowed is its own localStorage key, which never leaves the browser.
const csRefs = [...moduleCode.matchAll(/['"](cs_[A-Za-z0-9_]+)['"]/g)].map((m) => m[1]);
assert.deepEqual(csRefs, [M.TBT_KEY],
  `the only cs_* name in the demo module may be its localStorage key, found: ${csRefs.join(', ')}`);
assert.equal(M.TBT_KEY, 'cs_tbt_demo_v1', 'the demo localStorage key must stay demo-scoped');

// Local file paths may exist only for the demo document preview.
const previewSrc = sliceFn('tbtPreview');
assert.ok(previewSrc.includes('TBT_DEMO'),
  'opening a local source document must be gated behind TBT_DEMO');
const pathHits = [...js.matchAll(/'file:\/\/[^']*'/g)].map((m) => m[0]);
for (const hit of pathHits) {
  assert.ok(previewSrc.includes(hit),
    `a local file:// path appears outside the gated preview: ${hit}`);
}

// Production Toolbox Talks behaviour is still present and untouched.
includes(js, 'function pgTalks() {', 'the production Toolbox Talks page must still exist');
const prodSrc = js.slice(js.indexOf('function pgTalks() {'));
includes(prodSrc, 'subtabs(talkTab', 'the production page must keep its existing subtabs');

// Cache-busted so the demo actually picks up this build.
assert.match(html, /office\.js\?v=\d+/, 'office.js must be cache-busted');

/* ------------------------------------------------------------------ *
 * 13. office.js still parses
 * ------------------------------------------------------------------ */
assert.doesNotThrow(() => new Function(js), 'office.js has invalid JavaScript');

console.log(`Toolbox Talk office verification passed (${M.TBT_LIB.length} documents, ` +
  `${uniqueHashes.size} unique, ${elig.length} schedulable, ${keys.length} companies).`);
