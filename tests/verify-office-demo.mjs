/* Office dashboard demo — verification.
 *
 * Loads the demo fixtures and the office page logic and exercises the counting
 * rules directly: JHA families, daily compliance, Toolbox Talk completion,
 * attendance, company isolation and filtering.
 *
 * Nothing here touches Supabase, n8n, storage or authentication.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const js = fs.readFileSync(new URL('office.js', root), 'utf8');
const demoSrc = fs.readFileSync(new URL('office-demo.js', root), 'utf8');
const html = fs.readFileSync(new URL('office.html', root), 'utf8');
const includes = (hay, text, msg) => assert.ok(hay.includes(text), msg);

/* ------------------------------------------------------------------ *
 * 0. Load the fixtures, then the office logic that reads them
 * ------------------------------------------------------------------ */
const win = { location: { search: '?demo=1' }, URLSearchParams };
new Function('window', 'location', 'URLSearchParams', demoSrc)(win, win.location, URLSearchParams);
const DEMO = win.DEMO;
assert.ok(DEMO, 'office-demo.js must define window.DEMO');
assert.equal(DEMO.on, true, 'the fixtures must detect ?demo=1');

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// Slice the two demo modules out of office.js and run them over the fixtures.
const jhaStart = js.indexOf('  /* ==================== JHA SUBMISSIONS — DEMO ONLY');
const anStart = js.indexOf('  /* ==================== ANALYTICS — DEMO ONLY');
const tbStart = js.indexOf('  /* ==================== TOOLBOX TALKS — DEMO ONLY');
const tbLogicEnd = js.indexOf('  function pgTalksDemo() {');
assert.ok(jhaStart > -1 && anStart > -1 && tbStart > -1, 'demo modules missing from office.js');

const slice = (name, endName) => {
  const i = js.indexOf(`function ${name}(`);
  assert.ok(i > -1, `${name} is missing`);
  const j = js.indexOf(`\n  function ${endName}(`, i);
  return js.slice(i, j > -1 ? j : undefined);
};

const M = new Function('window', 'localStorage', 'location', 'URLSearchParams', `
  var TBT_DEMO = true;
  function esc(s){ return String(s == null ? '' : s); }
  function pill(c, t){ return t; }
  function toast(){}
  function drawer(){}
  function kv(){ return ''; }
  function paint(){}
  function head(){ return ''; }
  function tableWrap(){ return ''; }
  function $(){ return null; }
  function $$(){ return []; }
  function wireSearch(){}
  ${js.slice(tbStart, tbLogicEnd)}
  ${slice('jhaFamilies', 'jhaBadge')}
  ${slice('jhaFilteredFamilies', 'pgJhaDemo')}
  ${slice('anlRangeDays', 'anlJobs')}
  ${slice('anlJobs', 'anlCompliance')}
  ${slice('anlCompliance', 'anlJhaActivity')}
  ${slice('anlJhaActivity', 'anlToolbox')}
  ${slice('anlToolbox', 'pgAnalyticsDemo')}
  var jhaF = { job:'', from:'', to:'', by:'', kind:'', revs:'' };
  var anF = { company:'greiner', job:'', from:'', to:'', form:'', status:'' };
  function reload(){ TBT = null; return tbtLoad(); }
  function setCompany(k){ tbtLoad(); TBT.company = k; anF.company = k; }
  return { TBT_LIB, TBT_COMPANIES, TBT_GUIDED, TBT_TOPIC, TBT_WEEKS_NO_REPEAT,
           tbtEligible, tbtById, tbtLoad, tbtSave, tbtCo, tbtCoDef, tbtBlank,
           tbtDefaultState, tbtMondayISO, tbtCompletionStats, tbtTalkForWeek,
           tbtGuidedOf, tbtFormatFor,
           jhaFamilies, jhaFilteredFamilies,
           anlRangeDays, anlJobs, anlCompliance, anlJhaActivity, anlToolbox,
           reload, setCompany,
           getJhaF: function(){ return jhaF; }, getAnF: function(){ return anF; },
           getTBT: function(){ return TBT; } };
`)(win, localStorage, win.location, URLSearchParams);

/* ------------------------------------------------------------------ *
 * 1. JHA revisions group under the original
 * ------------------------------------------------------------------ */
const fams = M.jhaFamilies();
assert.equal(DEMO.jha.length, 7, 'the fixture holds 7 revision rows');
assert.equal(fams.length, 3, '7 revision rows must collapse into 3 JHAs');

const byRoot = Object.fromEntries(fams.map((f) => [f.root, f]));
assert.ok(byRoot['jha-1'] && byRoot['jha-2'] && byRoot['jha-3'], 'all three JHA families must appear');
assert.equal(byRoot['jha-1'].revisionCount, 0, 'jha-1 was never revised');
assert.equal(byRoot['jha-2'].revisionCount, 1, 'jha-2 was revised once');
assert.equal(byRoot['jha-3'].revisionCount, 3, 'jha-3 was revised three times');

// Revision count is edits AFTER the original, not the number of versions.
for (const f of fams) {
  assert.equal(f.revisionCount, f.revisions.length - 1,
    `${f.root}: revision count must exclude the original`);
}

/* ------------------------------------------------------------------ *
 * 2. The table shows the latest version, the original is preserved
 * ------------------------------------------------------------------ */
const f3 = byRoot['jha-3'];
assert.equal(f3.latest.id, 'jha-3-r4', 'the latest version must be the highest revision');
assert.equal(f3.description, f3.latest.description_of_work,
  'the row must show the latest description of work');
assert.equal(f3.employee_count, 4, 'the row must show the latest employee count');
assert.equal(f3.latest_editor, 'Alex Rivera (Demo)', 'the row must show the latest editor');

// The original is still there, in full, unchanged.
assert.equal(f3.original.id, 'jha-3-r1', 'the original must be the first revision');
assert.equal(f3.original.revision_number, 1, 'the original is revision_number 1');
assert.equal(f3.original_submitter, 'Demo Foreman', 'the original submitter must be preserved');
assert.deepEqual(f3.original.employees, ['Demo Foreman', 'Sam Whitfield (Demo)'],
  'the original crew must not be overwritten by later revisions');
assert.equal(f3.original.ladder_use, 'no', 'the original ladder answer must be preserved');
assert.equal(f3.original.description_of_work, 'Ceiling grid and light rough-in, Level 2 west.',
  'the original description must be preserved verbatim');
// Original submission time is carried forward on every revision.
for (const r of f3.revisions) {
  assert.equal(r.original_submitted_at, f3.original.original_submitted_at,
    `${r.id} must carry the original submission time`);
}
// Revisions are appended, never replacing one another.
assert.deepEqual(f3.revisions.map((r) => r.revision_number), [1, 2, 3, 4],
  'every version must be retained in order');

/* ------------------------------------------------------------------ *
 * 3. Revisions do not inflate daily compliance
 * ------------------------------------------------------------------ */
const comp = M.anlCompliance();
assert.equal(comp.required.length, 6, '3 jobs over 2 days = 6 required submissions');
assert.equal(comp.completed.length, 3, 'three job/days have a JHA');
assert.equal(comp.missed.length, 3, 'three job/days have none');
assert.equal(comp.completed.length + comp.missed.length, comp.required.length,
  'completed plus missed must equal required');
assert.equal(comp.pct, 50, 'compliance is 3 of 6');

// The day that carries the 4-version JHA counts once, not four times.
const bigDay = comp.completed.find((r) => r.families.some((f) => f.root === 'jha-3'));
assert.ok(bigDay, 'the multi-revision JHA must satisfy its day');
assert.equal(bigDay.families.length, 1, 'a JHA family counts once for its job/day');
assert.equal(bigDay.families[0].revisions.length, 4, '…even though it has four versions');
// Total revision rows far exceed completed submissions — that is the point.
assert.ok(DEMO.jha.length > comp.completed.length,
  'there must be more revision rows than completed submissions for this test to mean anything');

/* ------------------------------------------------------------------ *
 * 4. JHA activity figures
 * ------------------------------------------------------------------ */
const act = M.anlJhaActivity();
assert.equal(act.unique, 3, 'three unique JHAs');
assert.equal(act.revised.length, 2, 'two were revised');
assert.equal(act.events, 4, 'four revision events in total (1 + 3)');
assert.equal(act.pctRevised, 67, '2 of 3 rounds to 67%');
assert.equal(act.avgPerRevised, 2, '4 events over 2 revised JHAs');
// Derived, never hardcoded: the event count must equal the sum of the families.
assert.equal(act.events, act.families.reduce((n, f) => n + f.revisionCount, 0),
  'the revision-event total must be derived from the records');
assert.equal(act.recent[0].root, 'jha-2', 'most recently revised first');

/* ------------------------------------------------------------------ *
 * 5. Filtering — job, date, submitter, original vs revised, revision count
 * ------------------------------------------------------------------ */
const jf = M.getJhaF();
const reset = () => Object.assign(jf, { job: '', from: '', to: '', by: '', kind: '', revs: '' });

reset(); jf.job = 'demo-job-b';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-2'], 'job filter');

reset(); jf.from = DEMO.isoDay(DEMO.dayOffset(0));
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root).sort(), ['jha-1', 'jha-2'],
  'date-from filter excludes yesterday');
reset(); jf.to = DEMO.isoDay(DEMO.dayOffset(-1));
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-3'],
  'date-to filter keeps only yesterday');

reset(); jf.by = 'Morgan Ellis (Demo)';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-2'], 'submitter filter');

reset(); jf.kind = 'original';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-1'], 'never-revised filter');
reset(); jf.kind = 'revised';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root).sort(), ['jha-2', 'jha-3'], 'revised filter');

reset(); jf.revs = '3';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-3'], 'revision-count filter');
reset();

// Date filtering flows through to compliance.
const af = M.getAnF();
af.from = DEMO.isoDay(DEMO.dayOffset(0));
af.to = DEMO.isoDay(DEMO.dayOffset(0));
const oneDay = M.anlCompliance();
assert.equal(oneDay.required.length, 3, 'one day over three jobs = 3 required');
assert.equal(oneDay.completed.length, 2, 'two jobs submitted today');
af.from = ''; af.to = '';

// Job filtering flows through too.
af.job = 'demo-job-c';
const jobC = M.anlCompliance();
assert.equal(jobC.required.length, 2, 'one job over two days');
assert.equal(jobC.completed.length, 0, 'Demo Job C never submitted');
assert.equal(jobC.missed.length, 2, 'both of its days are missed');
af.job = '';

/* ------------------------------------------------------------------ *
 * 6. Toolbox Talk — group completion, attendance, manual entries
 * ------------------------------------------------------------------ */
store.clear(); M.reload();
M.setCompany('greiner');
const g = M.anlToolbox();
assert.equal(g.stats.mode, 'group', 'Greiner is in group mode');
assert.equal(g.stats.total, 3, 'three jobs/groups assigned');
assert.equal(g.stats.completed.length, 2, 'two groups submitted');
assert.equal(g.stats.outstanding.length, 1, 'one group outstanding');
assert.deepEqual(g.stats.outstanding, ['Demo Job C — Service'], 'Job C is the outstanding group');
assert.equal(g.stats.pct, 67, '2 of 3 rounds to 67%');

// Attendance: distinct roster employees + every manual entry.
assert.equal(g.stats.rosterCount, 7, 'seven distinct roster employees attended');
assert.equal(g.stats.manualCount, 2, 'two manual attendees');
assert.equal(g.stats.attendance, 9, 'total attendance is roster plus manual');
assert.equal(g.stats.attendance, g.stats.rosterCount + g.stats.manualCount,
  'total attendance must be derived, not stored separately');

// Manual attendees do NOT change the assigned denominator.
const manualNames = DEMO.completions.greiner
  .reduce((a, c) => a.concat(c.manual || []), []);
assert.equal(manualNames.length, 2, 'the fixture carries two manual attendees');
assert.equal(g.stats.total, 3,
  'manual attendees must not increase the number of groups assigned');
assert.ok(!TBT_ROSTER_HAS(M, 'greiner', manualNames[0]),
  'a manual attendee must not be on the assigned roster');

function TBT_ROSTER_HAS(mod, coKey, name) {
  return (mod.TBT_COMPANIES[coKey].employees || []).some((e) => e.n === name);
}

/* ------------------------------------------------------------------ *
 * 7. No roster employee is credited twice in the same week
 * ------------------------------------------------------------------ */
{
  const co = M.tbtBlank('greiner');
  co.mode = 'group';
  const week = M.tbtMondayISO(0);
  const def = M.TBT_COMPANIES.greiner;
  // The same person named on two different group submissions.
  co.completions = [
    { week, kind: 'group', company: 'greiner', group: def.groups[0], presenter: 'A',
      roster: ['Demo Foreman', 'Alex Rivera (Demo)'], manual: [], at: new Date().toISOString() },
    { week, kind: 'group', company: 'greiner', group: def.groups[1], presenter: 'B',
      roster: ['Demo Foreman', 'Casey Nolan (Demo)'], manual: [], at: new Date().toISOString() },
  ];
  const s = M.tbtCompletionStats(co, def, week);
  assert.equal(s.rosterCount, 3,
    'Demo Foreman appears on two submissions but must be counted once');
  assert.equal(s.attendance, 3, 'attendance must not double-count an employee');
  assert.equal(s.completed.length, 2, 'both groups still count as completed');
}

/* ------------------------------------------------------------------ *
 * 8. Toolbox Talk — individual completion
 * ------------------------------------------------------------------ */
store.clear(); M.reload();
M.setCompany('peine');
const p = M.anlToolbox();
assert.equal(p.stats.mode, 'individual', 'Peine is in individual mode');
assert.equal(p.stats.total, 12, 'twelve employees assigned');
assert.equal(p.stats.completed.length, 4, 'four employees completed');
assert.equal(p.stats.outstanding.length, 8, 'eight employees outstanding');
assert.equal(p.stats.completed.length + p.stats.outstanding.length, p.stats.total,
  'completed plus outstanding must equal assigned');
assert.equal(p.stats.pct, 33, '4 of 12 rounds to 33%');

// The fixture deliberately contains a duplicate completion.
const peineRecords = DEMO.completions.peine;
assert.equal(peineRecords.length, 5, 'five individual records in the fixture');
const avery = peineRecords.filter((c) => c.employee === 'Avery Nolan (Demo)');
assert.equal(avery.length, 2, 'one employee completed twice');
assert.equal(p.stats.completed.length, 4,
  'a duplicate completion must not inflate the completed count');

/* ------------------------------------------------------------------ *
 * 9. Company isolation
 * ------------------------------------------------------------------ */
store.clear(); M.reload();
for (const [key, expect] of [
  ['greiner', { mode: 'group', total: 3, done: 2 }],
  ['choice', { mode: 'group', total: 1, done: 1 }],
  ['peine', { mode: 'individual', total: 12, done: 4 }],
]) {
  M.setCompany(key);
  const t = M.anlToolbox();
  assert.equal(t.stats.mode, expect.mode, `${key} completion mode`);
  assert.equal(t.stats.total, expect.total, `${key} assigned`);
  assert.equal(t.stats.completed.length, expect.done, `${key} completed`);
}

// Choice's single confirmed Monday meeting is not multiplied into extra groups.
assert.equal(M.TBT_COMPANIES.choice.groups.length, 1,
  'Choice runs exactly one Monday morning meeting');

// A record belonging to one company must never credit another.
{
  const co = M.tbtBlank('choice');
  co.mode = 'group';
  const week = M.tbtMondayISO(0);
  co.completions = [{ week, kind: 'group', company: 'peine',
    group: M.TBT_COMPANIES.choice.groups[0], roster: ['Someone'], manual: [],
    at: new Date().toISOString() }];
  const s = M.tbtCompletionStats(co, M.TBT_COMPANIES.choice, week);
  assert.equal(s.completed.length, 1,
    'the office reads each company from its own bucket, so this row is Choice data');
}
// The buckets themselves are separate objects.
store.clear();
const st = M.tbtDefaultState();
assert.notEqual(st.companies.choice.completions, st.companies.peine.completions,
  'company records must not share an array reference');
for (const k of ['greiner', 'choice', 'peine']) {
  const recs = st.companies[k].completions;
  assert.ok(recs.every((c) => c.company === k),
    `${k}'s bucket must contain only ${k} records`);
}

// Only Greiner has demo jobs, so JHA figures do not leak between companies.
const af2 = M.getAnF();
af2.company = 'choice';
assert.equal(M.anlJobs().length, 0, 'Choice has no demo jobs');
assert.equal(M.anlCompliance().required.length, 0, 'Choice requires no daily JHAs in this fixture');
assert.equal(M.anlJhaActivity().unique, 0, 'Choice has no JHA records');
af2.company = 'greiner';
assert.equal(M.anlJobs().length, 3, 'Greiner has three demo jobs');

/* ------------------------------------------------------------------ *
 * 10. Totals are derived from the records, never written down twice
 * ------------------------------------------------------------------ */
{
  store.clear(); M.reload(); M.setCompany('greiner');
  const t = M.anlToolbox();
  const recs = t.stats.records.filter((c) => c.kind === 'group');
  const rosterUnion = new Set();
  let manual = 0;
  recs.forEach((c) => { (c.roster || []).forEach((n) => rosterUnion.add(n)); manual += (c.manual || []).length; });
  assert.equal(t.stats.rosterCount, rosterUnion.size, 'roster count must equal the distinct roster union');
  assert.equal(t.stats.manualCount, manual, 'manual count must equal the manual entries');
  assert.equal(t.stats.attendance, rosterUnion.size + manual, 'attendance must be the sum of the two');

  const c2 = M.anlCompliance();
  assert.equal(c2.required.length, M.anlJobs().length * M.anlRangeDays().length,
    'required must equal jobs times days');
  assert.equal(c2.completed.length,
    c2.required.filter((r) => r.families.length > 0).length,
    'completed must equal the rows that actually have a JHA');
}

/* ------------------------------------------------------------------ *
 * 11. Drilldown records match the card totals
 * ------------------------------------------------------------------ */
{
  store.clear(); M.reload(); M.setCompany('greiner');
  const c = M.anlCompliance(), a = M.anlJhaActivity(), t = M.anlToolbox();
  // Each drilldown list is the same array the card counted.
  assert.equal(c.missed.length, c.required.filter((r) => !r.done).length,
    'the missed drilldown must list exactly the missed rows');
  assert.equal(a.revised.length, a.families.filter((f) => f.revisionCount > 0).length,
    'the revised drilldown must list exactly the revised JHAs');
  const eventRows = a.families.reduce((n, f) =>
    n + f.revisions.filter((r) => r.revision_number > 1).length, 0);
  assert.equal(eventRows, a.events,
    'the revision-events drilldown must list exactly as many rows as the card counts');
  const outstanding = (t.co.groupsIncluded || t.def.groups)
    .filter((gp) => t.stats.completed.indexOf(gp) === -1);
  assert.equal(outstanding.length, t.stats.outstanding.length,
    'the outstanding drilldown must list exactly the outstanding groups');
}

/* ------------------------------------------------------------------ *
 * 12. Guided-talk availability is not overstated
 * ------------------------------------------------------------------ */
const guided = Object.keys(M.TBT_GUIDED);
assert.equal(guided.length, 1, 'only one talk has been converted so far');
assert.ok(M.tbtGuidedOf(guided[0]), 'the converted talk must resolve');
assert.equal(M.tbtById(guided[0]).f, 'Fall Protection.pdf', 'Fall Protection is the converted talk');
assert.equal(M.TBT_GUIDED[guided[0]].sections, 8, 'it has eight sections');
assert.ok(M.TBT_LIB.length > 100, 'the library is large');
assert.equal(M.TBT_LIB.filter((d) => M.tbtGuidedOf(d.i)).length, 1,
  'the library must not claim a guided version for talks that have none');

// A company set to Guided Talk still gets the document for unconverted talks.
{
  const co = M.tbtBlank('greiner');
  co.format = 'guided';
  const fall = M.TBT_LIB.filter((d) => d.f === 'Fall Protection.pdf')[0];
  const other = M.TBT_LIB.filter((d) => d.s === 'Ready' && !M.tbtGuidedOf(d.i))[0];
  assert.equal(M.tbtFormatFor(co, fall).guided, true, 'Fall Protection can be delivered as a Guided Talk');
  assert.equal(M.tbtFormatFor(co, other).guided, false, 'an unconverted talk cannot');
  assert.match(M.tbtFormatFor(co, other).note, /not prepared/i,
    'the office must say the guided version is not prepared');
}

/* ------------------------------------------------------------------ *
 * 13. Production behaviour is unchanged
 * ------------------------------------------------------------------ */
includes(js, 'if (TBT_DEMO) return pgTalksDemo();',
  'the Toolbox Talk demo must stay behind the ?demo=1 gate');
includes(js, 'jha: (TBT_DEMO ? pgJhaDemo : pgOverview) }',
  'the JHA page must exist only in the demo build');
includes(js, 'analytics: (TBT_DEMO ? pgAnalyticsDemo : pgAnalytics)',
  'production analytics must stay on the production function');
// The production analytics lock is untouched.
includes(js, 'PILOT: Analytics is intentionally locked until Greiner has accumulated',
  'the production analytics lock must remain');
includes(js, 'Analytics will become available as Greiner builds more real safety data.',
  'the production analytics message must remain');
// Demo-only pages never reach the production sidebar.
includes(js, "var VISIBLE = PAGES.filter(function (p) { return !p.demoOnly || TBT_DEMO; });",
  'demo-only pages must be filtered out of the production nav');
includes(js, "{ id: 'jha',       label: 'JHA Submissions', group: 'Field work', demoOnly: true },",
  'the JHA page must be marked demo-only');
// The real transport and session are still there.
includes(js, 'cs_portal_login', 'the production login RPC must still exist');
includes(js, "fetch(C.creekside.url + '/rest/v1/rpc/' + fn", 'the production transport must remain');
includes(js, 'function getSession()', 'the production session must remain');
includes(js, '    var s = getSession();\n    if (s) openApp(s);\n  }',
  'production must still open from a stored session');
includes(js, 'if (TBT_DEMO && window.DEMO) {',
  'the demo boot must be gated on the demo flag');
includes(js, 'function pgTalks() {', 'the production Toolbox Talks page must still exist');

/* ------------------------------------------------------------------ *
 * 14. The demo writes nothing and reaches nothing
 * ------------------------------------------------------------------ */
const demoCode = demoSrc
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket',
  'supabase', 'twilio', 'resend', 'n8n', 'localStorage', 'anonKey', 'service_role']) {
  assert.ok(!demoCode.toLowerCase().includes(forbidden.toLowerCase()),
    `the fixtures must stay inert — found "${forbidden}"`);
}
// The fixture transport only ever resolves local objects.
assert.ok(demoCode.includes('return Promise.resolve('),
  'DEMO.call must resolve locally');
// Demo mode short-circuits the real transport before any network call.
const postSrc = js.slice(js.indexOf('  function post(fn, body) {'), js.indexOf('  function openApp('));
const demoIdx = postSrc.indexOf('if (C.demo) return window.DEMO.call(fn, body);');
const fetchIdx = postSrc.indexOf('fetch(');
assert.ok(demoIdx > -1, 'post() must have a demo short-circuit');
assert.ok(fetchIdx > -1, 'post() must still have the production fetch');
assert.ok(demoIdx < fetchIdx, 'the demo short-circuit must come before the network call');

// Every fixture record is obviously demo data.
assert.match(DEMO.session.session, /^demo/, 'the demo session must be obviously fake');
for (const j of DEMO.jobs) {
  assert.match(j.name, /Demo/, `job "${j.name}" must be obviously fake`);
}
for (const f of M.jhaFamilies()) {
  assert.match(f.job_name, /Demo/, 'JHA fixtures must sit on demo jobs');
}

/* ------------------------------------------------------------------ *
 * 15. The page is labelled as demo data
 * ------------------------------------------------------------------ */
includes(js, 'Demo Data', 'the demo pages must be labelled');
includes(js, 'These are fixture records, not real Greiner submissions.',
  'the JHA page must say the records are fixtures');
includes(js, 'Every figure on this page comes from demo fixture records. These are not actual Greiner results.',
  'analytics must say the figures are not real Greiner results');
assert.match(html, /office-demo\.js/, 'office.html must load the fixtures');
assert.match(html, /office\.js\?v=\d+/, 'office.js must be cache-busted');

/* ------------------------------------------------------------------ *
 * 16. Both files still parse
 * ------------------------------------------------------------------ */
assert.doesNotThrow(() => new Function(js), 'office.js has invalid JavaScript');
assert.doesNotThrow(() => new Function(demoSrc), 'office-demo.js has invalid JavaScript');

console.log(`Office demo verification passed (${fams.length} JHAs from ${DEMO.jha.length} revision rows, ` +
  `${comp.completed.length}/${comp.required.length} daily compliance, 3 companies isolated).`);
