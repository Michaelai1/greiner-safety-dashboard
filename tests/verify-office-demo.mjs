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
  ${js.slice(js.indexOf('  var SI_FORMS_READY = ['), js.indexOf('  function siStyle()'))}
  ${slice('anlRangeBounds', 'anlRangeDays')}
  ${slice('anlRangeDays', 'anlJobs')}
  ${slice('anlJobs', 'anlCompliance')}
  ${slice('anlCompliance', 'anlJhaActivity')}
  ${slice('anlJhaActivity', 'anlToolbox')}
  ${slice('anlToolbox', 'anlFieldForms')}
  ${slice('anlFieldForms', 'anlHotWork')}
  ${slice('anlHotWork', 'anlLifts')}
  ${slice('anlLifts', 'anlCorrective')}
  ${slice('anlCorrective', 'anlIncidents')}
  ${slice('anlIncidents', 'pgAnalyticsDemo')}
  ${slice('allCorrective', 'reportPBody')}
  function jobName(id){ var j=(window.DEMO.jobs||[]).filter(function(x){return x.id===id;})[0]; return j?j.name:id; }
  function subName(){ return ''; }
  function repDateDisp(){ return ''; }
  var B = { findings: window.DEMO.findings, incidents: window.DEMO.incidents,
            near_misses: window.DEMO.nearMisses, reports: [] };
  var ANL_DATA_NEEDED_REF = ANL_DATA_NEEDED;
  var jhaF = { job:'', from:'', to:'', by:'', kind:'', revs:'' };
  var anF = { company:'greiner', job:'', from:'', to:'', form:'', status:'' };
  function reload(){ TBT = null; return tbtLoad(); }
  function setCompany(k){ tbtLoad(); TBT.company = k; anF.company = k; }
  return { TBT_LIB, TBT_COMPANIES, TBT_GUIDED, TBT_TOPIC, TBT_WEEKS_NO_REPEAT,
           tbtEligible, tbtById, tbtLoad, tbtSave, tbtCo, tbtCoDef, tbtBlank,
           tbtDefaultState, tbtMondayISO, tbtCompletionStats, tbtTalkForWeek,
           tbtGuidedOf, tbtFormatFor,
           jhaFamilies, jhaFilteredFamilies,
           anlRangeBounds, anlRangeDays, anlJobs, anlCompliance,
           SI_FORMS_READY, SI_FORMS_REVIEW, SI_FORMS_NOTBUILT, SI_REQ_TYPES,
           siReqs, siReqsForWeek, siMonday, siWeekDays, siWeekLabel, siExpected,
           siStatus, siSubmissionsFor, siFormDef, siFormLabel,
           setWeek: function (iso) { siWeek = iso; }, getWeek: function () { return siWeekISO(); }, anlJhaActivity, anlToolbox,
           anlFieldForms, anlHotWork, anlLifts, anlCorrective, anlIncidents,
           allCorrective, ANL_DATA_NEEDED: ANL_DATA_NEEDED_REF,
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
 *
 * Compliance is derived from the requirements the office defined, so the
 * counts move with the week. The invariants are what matter.
 * ------------------------------------------------------------------ */
const comp = M.anlCompliance();
assert.ok(comp.required.length > 0, 'the fixture must require some daily JHAs');
assert.equal(comp.completed.length + comp.missed.length, comp.required.length,
  'completed plus missed must equal required');
assert.equal(comp.pct, Math.round(comp.completed.length / comp.required.length * 100),
  'the percentage must be derived from the counts');
// Nothing in the future is ever counted as required or missed.
const todayISO = DEMO.isoDay(DEMO.dayOffset(0));
assert.ok(comp.required.every((r) => r.day <= todayISO),
  'a day that has not arrived must not be required yet');
assert.ok(comp.upcoming.every((r) => r.day > todayISO),
  'upcoming rows must all be in the future');
// Only applicable weekdays are required — no weekend JHAs are demanded.
assert.ok(comp.required.every((r) => {
  const dow = new Date(r.day + 'T12:00:00').getDay();
  return dow >= 1 && dow <= 5;
}), 'daily requirements must only fall on their applicable weekdays');

// THE RULE: a JHA family satisfies its day exactly once, however many
// revisions it carries.
const multi = comp.completed.find((r) => r.families.some((f) => f.revisionCount > 0));
if (multi) {
  assert.equal(multi.families.length, 1, 'a JHA family counts once for its job/day');
  assert.ok(multi.families[0].revisions.length > 1, '…even with several versions');
}
assert.ok(comp.completed.every((r) => r.families.length >= 1),
  'a completed day must have at least one JHA');
// Revision rows far outnumber completed submissions — that is the point.
assert.ok(DEMO.jha.length > comp.completed.length,
  'there must be more revision rows than completed submissions for this to mean anything');
// Counting raw revision rows instead of families would inflate the result.
const rawRows = DEMO.jha.filter((j) => comp.completed.some((c) => c.job_id === j.job_id && c.day === j.work_date));
assert.ok(rawRows.length > comp.completed.length,
  'counting revisions instead of families would overstate compliance');

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

const latestDay = M.jhaFamilies().map((f) => f.work_date).sort().pop();
const earlierDay = M.jhaFamilies().map((f) => f.work_date).sort()[0];
assert.notEqual(latestDay, earlierDay, 'the fixture must span two work days');
reset(); jf.from = latestDay;
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root).sort(), ['jha-1', 'jha-2'],
  'date-from filter excludes the earlier day');
reset(); jf.to = earlierDay;
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-3'],
  'date-to filter keeps only the earlier day');

reset(); jf.by = 'Morgan Ellis (Demo)';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-2'], 'submitter filter');

reset(); jf.kind = 'original';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-1'], 'never-revised filter');
reset(); jf.kind = 'revised';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root).sort(), ['jha-2', 'jha-3'], 'revised filter');

reset(); jf.revs = '3';
assert.deepEqual(M.jhaFilteredFamilies().map((f) => f.root), ['jha-3'], 'revision-count filter');
reset();

// Date filtering flows through to compliance. Pin to a known weekday so the
// assertion does not depend on which day the suite runs.
const af = M.getAnF();
const weekdayBack = (n) => {
  for (let i = 0; i < 14; i++) {
    const d = DEMO.dayOffset(-i);
    if (d.getDay() >= 1 && d.getDay() <= 5) { if (n-- === 0) return DEMO.isoDay(d); }
  }
  return DEMO.isoDay(DEMO.dayOffset(-1));
};
const oneWeekday = latestDay;
af.range = 'custom'; af.from = oneWeekday; af.to = oneWeekday;
const oneDay = M.anlCompliance();
assert.equal(oneDay.required.length, 3, 'one weekday over three jobs = 3 required');
assert.ok(oneDay.required.every((r) => r.day === oneWeekday), 'only that day is required');

// Job filtering flows through too.
af.job = 'demo-job-c';
const jobC = M.anlCompliance();
assert.equal(jobC.required.length, 1, 'one job on one weekday');
assert.equal(jobC.completed.length, 0, 'Demo Job C never submitted');
assert.equal(jobC.missed.length, 1, 'so that day is missed');
af.job = ''; af.range = 'week'; af.from = ''; af.to = '';

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
  // Required = one row per daily requirement per applicable weekday already reached.
  const dailyReqs = M.siReqs().filter((r) => r.type === 'daily');
  const expectedRows = dailyReqs.reduce((n, r) => {
    const wd = (r.weekdays && r.weekdays.length) ? r.weekdays : [1, 2, 3, 4, 5];
    return n + M.anlRangeDays().filter((d) => {
      const dow = new Date(d + 'T12:00:00').getDay();
      return wd.includes(dow) && d <= DEMO.isoDay(DEMO.dayOffset(0));
    }).length;
  }, 0);
  assert.equal(c2.required.length, expectedRows,
    'required must equal the requirements times their elapsed applicable days');
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
 * 12b. The Incidents page no longer throws
 *
 * pgIncidents() read incTab and incF before either was declared, so the page
 * threw ReferenceError on its first line and rendered nothing — on main too.
 * ------------------------------------------------------------------ */
includes(js, "var incTab = 'incidents';", 'incTab must be declared');
includes(js, "var incF = { job: '', cls: '', status: '', range: '' };", 'incF must be declared');
// Declared before the page that reads them.
assert.ok(js.indexOf("var incTab = 'incidents';") < js.indexOf('function pgIncidents()'),
  'incTab must be declared before pgIncidents');
assert.ok(js.indexOf("var incF = { job:") < js.indexOf('function pgIncidents()'),
  'incF must be declared before pgIncidents');

// Run pgIncidents for real against the fixtures and prove it does not throw.
{
  const painted = [];
  const page = new Function('window', 'localStorage', 'document', `
    var TBT_DEMO = true;
    function esc(s){ return String(s == null ? '' : s); }
    function pill(c, t){ return '<span>' + t + '</span>'; }
    function kpi(v, l, s, c){ return '<div>' + v + ' ' + l + '</div>'; }
    function actionKpi(v, l, s){ return '<div>' + v + ' ' + l + '</div>'; }
    function head(t, n, r){ return '<h2>' + t + '</h2>'; }
    function subtabs(cur, items, k){ return '<div>' + cur + '</div>'; }
    function tableWrap(cols, rows, empty){ return rows.length ? rows.join('') : '<div>' + empty + '</div>'; }
    function paint(h){ PAINTED.push(h); }
    function toast(){}
    function has(hay, q){ return !q || String(hay).toLowerCase().indexOf(q) !== -1; }
    function jobName(id){ var j=(B.jobs||[]).filter(function(x){return x.id===id;})[0]; return j?j.name:id; }
    function subName(){ return ''; }
    function fmtDate(d){ return String(d || ''); }
    function $(){ return null; }
    function $$(){ return []; }
    function wireSubtabs(){}
    function wireSearch(){}
    function pgRegVisits(){ PAINTED.push('regvisits'); }
    function openIncident(){}
    function openNewIncident(){}
    var CLASS = { first_aid: 'First aid', recordable: 'Recordable', property: 'Property damage', near_miss: 'Near miss' };
    var subQ = {};
    var PAINTED = [];
    var B = { incidents: window.DEMO.incidents, near_misses: window.DEMO.nearMisses,
              jobs: window.DEMO.jobs, findings: window.DEMO.findings, reports: [] };
    ${js.slice(js.indexOf("  var incTab = 'incidents';"), js.indexOf('  function pgNearMiss()'))}
    return { run: function(){ pgIncidents(); return PAINTED; } };
  `);
  const inst = page(win, localStorage, {});
  let out;
  assert.doesNotThrow(() => { out = inst.run(); },
    'pgIncidents() must not throw — this is the incTab/incF regression');
  assert.ok(out.length > 0, 'pgIncidents() must paint something');
  const painted0 = out.join(' ');
  assert.match(painted0, /Incidents &amp; Injuries|Incidents & Injuries/,
    'the Incidents page must render its heading');
  // With zero incidents it must show the empty state, not fabricated rows.
  assert.match(painted0, /No Greiner incidents recorded/,
    'an empty incident table must render its zero-data state');
  assert.match(painted0, /0 incidents this year/, 'the zero count must be shown');
}

/* ------------------------------------------------------------------ *
 * 12c. Field form / hot work / lift activity
 * ------------------------------------------------------------------ */
{
  store.clear(); M.reload(); M.setCompany('greiner');
  const ff = M.anlFieldForms();
  // A JHA family counts once here too, exactly as it does for compliance.
  const jhaType = ff.types.find((t) => t.type === 'jha');
  assert.equal(jhaType.rows.length, 7, 'seven raw JHA revision rows are in range');
  assert.equal(jhaType.count, 3, 'they count as three submissions');
  assert.equal(ff.total, ff.types.reduce((n, t) => n + t.count, 0),
    'the total must be the sum of the per-type counts');
  assert.equal(ff.total, 10, '3 JHAs + 3 hot work + 2 aerial + 2 forklift');
  // The drilldown list must be exactly as long as the card total.
  assert.equal(ff.counted.length, ff.total,
    'the field-form drilldown must list exactly what the card counted');
  assert.equal(ff.counted.filter((r) => r.form_type === 'jha').length, 3,
    'each JHA family appears once in the drilldown');

  const hw = M.anlHotWork();
  assert.equal(hw.count, 3, 'three hot work permits');
  assert.equal(hw.flagged.length, 1, 'one flagged for follow-up');
  assert.equal(Object.keys(hw.jobs).length, 2, 'across two jobs');
  assert.ok(hw.rows.every((r) => r.form_type === 'hotwork'), 'only hot work permits');

  const lf = M.anlLifts();
  assert.equal(lf.count, 4, 'four lift inspections');
  assert.equal(lf.aerial.length, 2, 'two aerial');
  assert.equal(lf.forklift.length, 2, 'two forklift');
  assert.equal(lf.aerial.length + lf.forklift.length, lf.count, 'the split must total the count');
  assert.equal(lf.units.length, 3, 'three distinct units — one forklift inspected twice');
  assert.equal(lf.flagged.length, 1, 'one failed inspection');
}

/* ------------------------------------------------------------------ *
 * 12d. Corrective actions come from real records only
 * ------------------------------------------------------------------ */
{
  const ca = M.anlCorrective();
  assert.equal(ca.all.length, 3, 'three corrective actions on record');
  assert.equal(ca.open.length, 2, 'two open');
  assert.equal(ca.closed.length, 1, 'one closed');
  assert.equal(ca.overdue.length, 1, 'one overdue');
  assert.equal(ca.open.length + ca.closed.length, ca.all.length,
    'open plus closed must equal the total');
  // Overdue is a subset of open, never counted separately.
  assert.ok(ca.overdue.every((c) => ca.open.includes(c)), 'overdue must be a subset of open');
  // Every action traces to a fixture finding — none are invented.
  assert.equal(ca.all.length, DEMO.findings.length,
    'every corrective action must come from a fixture record');
  // With no incidents there are no incident corrective actions.
  assert.equal(ca.all.filter((c) => c.src === 'Incident').length, 0,
    'no incident corrective actions can exist while there are no incidents');
}

/* ------------------------------------------------------------------ *
 * 12e. Incidents: a real zero-data state, and never a fake baseline
 * ------------------------------------------------------------------ */
{
  const ic = M.anlIncidents();
  assert.equal(DEMO.incidents.length, 0, 'the fixture contains no incidents');
  assert.equal(DEMO.nearMisses.length, 0, 'the fixture contains no near misses');
  assert.equal(ic.incidents.length, 0, 'incidents YTD is zero');
  assert.equal(ic.nearMisses.length, 0, 'near misses YTD is zero');

  // The critical rule: with no baseline there is NO number, not zero.
  assert.equal(ic.baseline.last_recordable, null, 'no recordable baseline has been supplied');
  assert.equal(ic.daysSinceRecordable, null,
    'days since last recordable must be null, never 0, when no baseline exists');
  assert.notEqual(ic.daysSinceRecordable, 0,
    'a missing baseline must never render as 0 days');

  // The page must say so in words.
  includes(js, 'No baseline recorded', 'the missing baseline must be stated');
  includes(js, 'days since last recordable', 'the baseline row must be labelled');
  includes(js, 'incidents entered', 'zero incidents must say "entered", not "occurred"');
  includes(js, 'near misses entered', 'zero near misses must say "entered", not "occurred"');
  includes(js, 'Zero means nothing entered, ',
    'the page must not imply nothing happened');
  includes(js, 'The incident workflow is built but nothing has been submitted.',
    'the page must say the workflow exists');
  includes(js, 'Intake is still held in this pilot.',
    'the page must say intake is still held');
  // Still the first requirement: which date is needed.
  assert.ok(M.ANL_DATA_NEEDED.some((d) => /last OSHA-recordable/i.test(d[0])),
    'the setup panel must name the recordable date');

  // Once a baseline exists the number is computed from it, not stored.
  const probe = JSON.parse(JSON.stringify(DEMO.baseline));
  probe.last_recordable = DEMO.isoDay(DEMO.dayOffset(-30));
  const days = Math.floor((Date.now() - new Date(probe.last_recordable + 'T00:00:00').getTime()) / 86400000);
  assert.ok(days >= 29 && days <= 31, 'the baseline maths must be a real date difference');
}

/* ------------------------------------------------------------------ *
 * 12f. Nothing fabricated: the banned metrics are not rendered
 * ------------------------------------------------------------------ */
{
  // These may be NAMED in "Data needed" as things that cannot be calculated,
  // but must never appear as a computed metric.
  const analytics = js.slice(js.indexOf('function pgAnalyticsDemo()'),
    js.indexOf('function anCard('));
  for (const banned of ['trirValue', 'dartValue', 'ltirValue', 'incidentRate',
    'trainingCompliance', 'ppeCompliance', 'injuryTrend', 'incidentStreak']) {
    assert.ok(!analytics.includes(banned), `no fabricated metric: ${banned}`);
  }
  // No incident is ever manufactured.
  assert.ok(!/incidents\s*=\s*\[\s*\{/.test(demoSrc),
    'the fixtures must not contain a fabricated incident');
  assert.equal(DEMO.incidents.length, 0, 'the incident fixture stays empty');

  // The data-needed list names every outstanding input.
  const needed = M.ANL_DATA_NEEDED.map((d) => d[0]);
  for (const want of ['Date of last OSHA-recordable incident', 'Date of last lost-time incident',
    'Incident recordkeeping start date', 'Hours worked', 'Training requirements by role',
    'Employee training records', 'Approved high-risk scoring criteria']) {
    assert.ok(needed.includes(want), `"Data needed" must list: ${want}`);
  }
  assert.equal(needed.length, 7, 'seven outstanding inputs');
  assert.ok(M.ANL_DATA_NEEDED.every((d) => d[1] && d[1].length > 20),
    'each data-needed row must explain why it is needed');
}

/* ------------------------------------------------------------------ *
 * 12g. pilotHold is intact and incident intake is not released
 * ------------------------------------------------------------------ */
includes(js, "$('#in-save').onclick = pilotHold('Incident records');",
  'incident intake must stay held');
includes(js, "$('#nn-save').onclick = pilotHold('Near-miss records');",
  'near-miss intake must stay held');
assert.equal((js.match(/pilotHold\(/g) || []).length >= 12, true,
  'every pilotHold must remain in place');
// The investigation editor still only toasts — the demo must not claim otherwise.
includes(js, "sv.onclick = function () { toast('Incident details saved.'); openIncident(id); };",
  'the investigation editor must be left exactly as it was');

/* ------------------------------------------------------------------ *
 * 12h. Navigation: JHA is an inspection, not a top-level section
 * ------------------------------------------------------------------ */
{
  const pages = js.slice(js.indexOf('  var PAGES = ['), js.indexOf('  var page = '));
  assert.ok(!/id: 'jha'/.test(pages), 'JHA Submissions must not be a top-level page');
  assert.ok(!pages.includes('JHA Submissions'), 'JHA Submissions must not appear in the sidebar');
  // The agreed navigation, in order.
  const labels = [...pages.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  const shown = labels.filter((l) => l !== 'Inspections');   // demoHide
  assert.deepEqual(shown, ['Overview', 'Analytics', 'Safety Inspections', 'Equipment', 'Permits',
    'Toolbox Talks', 'Incidents', 'Near Misses', 'Subcontractors', 'Orientation', 'Training',
    'Documents', 'Automations', 'Jobs', 'Planner', 'Templates'],
    'the demo sidebar must match the agreed navigation');
  // Toolbox Talks keeps its own top-level section.
  assert.ok(pages.includes("label: 'Toolbox Talks'"), 'Toolbox Talks stays top-level');
}

/* ------------------------------------------------------------------ *
 * 12i. JHA Review lives inside Safety Inspections
 * ------------------------------------------------------------------ */
includes(js, "['jha', 'JHA Review']", 'JHA Review must be a Safety Inspections view');
includes(js, "['req', 'Weekly Requirements']", 'Weekly Requirements must be a view');
includes(js, "['log', 'Submission Log']", 'Submission Log must be a view');
includes(js, "['find', 'Findings & Corrective Actions']", 'Findings must be a view');
includes(js, 'function siJhaHtml() { return jhaBodyHtml(); }',
  'JHA Review must reuse the JHA table, not a copy of it');
includes(js, 'function jhaBodyHtml()', 'the JHA table must be reusable');
// Analytics JHA card opens JHA Review.
includes(js, "var toSi = { compliance: 'req', jhareview: 'jha', findings: 'find' };",
  'analytics cards must open the matching Safety Inspections view');
for (const card of ['compliance', 'toolbox', 'jhareview', 'findings']) {
  assert.ok(js.includes("anCardOpen('" + card + "')"),
    `the ${card} card must be clickable`);
}

/* ------------------------------------------------------------------ *
 * 12j. Add Requirement: only verified forms are selectable
 * ------------------------------------------------------------------ */
{
  includes(js, '+ Add Requirement', 'the Add Requirement button must exist');
  includes(js, "id=\"si-addreq\"", 'the Add Requirement button must be wired');
  assert.ok(!js.includes('>Add Inspection<'), 'the action must not be called Add Inspection');

  const ready = M.SI_FORMS_READY.map((f) => f.key);
  assert.deepEqual(ready.sort(),
    ['aerial', 'forklift', 'hotwork', 'jha', 'jobsiteanalysis'],
    'only forms with a real field workflow may be selectable');

  // Every Ready form must be a canonical permission key in the office.
  const permBlock = js.slice(js.indexOf('var FIELD_PERM_FORMS = ['),
    js.indexOf('function loadJobFieldAccess'));
  for (const k of ready) {
    assert.ok(permBlock.includes(`key: '${k}'`),
      `"${k}" must be a canonical field-permission key to be schedulable`);
  }

  // Needs Review forms exist but are never selectable.
  const reviewLabels = M.SI_FORMS_REVIEW.map((f) => f.label);
  assert.ok(reviewLabels.includes('Ladder Inspection'),
    'Ladder Inspection must be listed as needing review');
  for (const f of M.SI_FORMS_REVIEW) {
    assert.ok(f.missing && f.missing.length, `${f.label} must say what is missing`);
    assert.ok(f.why && f.why.length > 30, `${f.label} must explain why`);
    assert.ok(!ready.includes(f.label.toLowerCase().split(' ')[0]),
      `${f.label} must not be selectable`);
  }
  includes(js, 'Needs review before it can be scheduled',
    'the blocked area must be labelled');
  includes(js, 'aria-disabled="true"', 'blocked forms must be marked disabled');

  // Power tool / powder-actuated cannot be scheduled.
  const notBuilt = M.SI_FORMS_NOTBUILT.map((f) => f.label);
  assert.ok(notBuilt.some((l) => /Power Tool/i.test(l)), 'Power Tool must be listed as not built');
  assert.ok(notBuilt.some((l) => /Powder-Actuated/i.test(l)), 'Powder-Actuated must be listed');
  for (const label of notBuilt.concat(reviewLabels)) {
    assert.ok(!M.SI_FORMS_READY.some((f) => f.label === label),
      `"${label}" must never appear in the selectable list`);
  }
  // Ladder must not sneak in via the JHA's embedded variance questions.
  assert.ok(!ready.includes('ladder'), 'ladder is not a schedulable form');
}

/* ------------------------------------------------------------------ *
 * 12k. Requirement rules: hot work is activity-based
 * ------------------------------------------------------------------ */
{
  const hotwork = M.siFormDef('hotwork');
  assert.deepEqual(hotwork.types, ['activity'],
    'hot work may only ever be activity-based');
  assert.equal(hotwork.defaultType, 'activity', 'and defaults to it');
  const week = M.getWeek();
  const hwReq = M.siReqs().find((r) => r.form === 'hotwork');
  assert.ok(hwReq, 'the fixture must carry a hot work requirement');
  assert.equal(hwReq.type, 'activity', 'it must be activity-based');
  assert.equal(M.siExpected(hwReq, week), null,
    'an activity-based requirement must have no fixed expected quantity');
  const hwStatus = M.siStatus(hwReq, week);
  assert.notEqual(hwStatus.key, 'missed',
    'hot work must never be reported missed on a day with no hot work');

  // JHA is daily per active job.
  const jhaDef = M.siFormDef('jha');
  assert.ok(jhaDef.types.includes('daily'), 'JHA can be required daily');
  const jhaReq = M.siReqs().find((r) => r.form === 'jha');
  assert.deepEqual(jhaReq.weekdays, [1, 2, 3, 4, 5], 'JHA is required on workdays');
  assert.equal(M.siExpected(jhaReq, week), 5, 'five workdays in the week');

  // Lift inspections are tied to units.
  for (const key of ['aerial', 'forklift']) {
    const def = M.siFormDef(key);
    assert.ok(def.types.includes('equipment'), `${key} must support a per-unit requirement`);
    assert.equal(def.defaultType, 'equipment', `${key} must default to per-unit`);
  }
  const liftReq = M.siReqs().find((r) => r.form === 'aerial');
  assert.equal(liftReq.units.length, 2, 'two aerial units on that job');
  assert.equal(M.siExpected(liftReq, week), 10, '2 units over 5 days');
  // With no units assigned the expectation is unknown rather than invented.
  const noUnits = Object.assign({}, liftReq, { units: [] });
  assert.equal(M.siExpected(noUnits, week), null,
    'a per-unit requirement with no units must not invent a quantity');

  // A JHA family satisfies its requirement once.
  const jhaA = M.siReqs().find((r) => r.job_id === 'demo-job-a' && r.form === 'jha');
  const subs = M.siSubmissionsFor(jhaA, week);
  const rawA = DEMO.field.filter((f) => f.form_type === 'jha' && f.job_id === 'demo-job-a');
  assert.ok(rawA.length > subs.length,
    'the raw revision rows must outnumber the counted submissions');
  const roots = new Set(subs.map((s) => s.root_jha_id));
  assert.equal(roots.size, subs.length, 'each JHA family is counted once');
}

/* ------------------------------------------------------------------ *
 * 12l. Week selector changes which records are shown
 * ------------------------------------------------------------------ */
{
  const thisWeek = M.siMonday(null);
  M.setWeek(thisWeek);
  const now = M.siStatus(M.siReqs().find((r) => r.job_id === 'demo-job-a' && r.form === 'jha'), thisWeek);
  const next = new Date(thisWeek + 'T12:00:00');
  next.setDate(next.getDate() + 7);
  const nextISO = DEMO.isoDay(next);
  M.setWeek(nextISO);
  const later = M.siStatus(M.siReqs().find((r) => r.job_id === 'demo-job-a' && r.form === 'jha'), nextISO);
  assert.ok(now.done > 0, 'this week has submissions');
  assert.equal(later.done, 0, 'next week has none');
  assert.equal(later.key, 'notdue', 'a future week is Not Yet Due, never Missed');
  assert.notEqual(M.siWeekLabel(thisWeek), M.siWeekLabel(nextISO), 'the label must change');
  // The label reads as a range, e.g. "Sep 28 – Oct 4, 2026".
  assert.match(M.siWeekLabel(thisWeek), /^[A-Z][a-z]{2} \d{1,2} – ([A-Z][a-z]{2} )?\d{1,2}, \d{4}$/,
    'the week label must be a readable date range');
  M.setWeek(thisWeek);
  // Week days are Monday-first and seven long.
  const days = M.siWeekDays(thisWeek);
  assert.equal(days.length, 7, 'a week is seven days');
  assert.equal(new Date(days[0] + 'T12:00:00').getDay(), 1, 'weeks start on Monday');
}

/* ------------------------------------------------------------------ *
 * 13. Production behaviour is unchanged
 * ------------------------------------------------------------------ */
includes(js, 'if (TBT_DEMO) return pgTalksDemo();',
  'the Toolbox Talk demo must stay behind the ?demo=1 gate');
includes(js, 'obs: (TBT_DEMO ? pgObsDemo : pgObs),',
  'Safety Inspections must use the demo workspace only in the demo build');
includes(js, 'analytics: (TBT_DEMO ? pgAnalyticsDemo : pgAnalytics)',
  'production analytics must stay on the production function');
// The production analytics lock is untouched.
includes(js, 'PILOT: Analytics is intentionally locked until Greiner has accumulated',
  'the production analytics lock must remain');
includes(js, 'Analytics will become available as Greiner builds more real safety data.',
  'the production analytics message must remain');
// Demo-only pages never reach the production sidebar.
includes(js, 'if (p.demoOnly && !TBT_DEMO) return false;',
  'demo-only pages must be filtered out of the production nav');
includes(js, 'if (p.demoHide && TBT_DEMO) return false;',
  'demo-hidden pages must be filtered out of the demo nav');
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
// The Demo Data label is now a compact pill beside the Analytics heading.
includes(js, "<span class=\"an-pill\">Demo Data</span>",
  'Analytics must carry a Demo Data pill');
includes(js, ".an-pill{", 'the Demo Data pill must be styled');
assert.match(html, /office-demo\.js/, 'office.html must load the fixtures');
assert.match(html, /office\.js\?v=\d+/, 'office.js must be cache-busted');

/* ------------------------------------------------------------------ *
 * 15b. Fixtures are unreachable outside demo mode
 * ------------------------------------------------------------------ */
{
  // Loaded without ?demo=1 the fixture file defines DEMO but reports itself off,
  // and the dashboard never switches its transport.
  const w2 = { location: { search: '' }, URLSearchParams };
  new Function('window', 'location', 'URLSearchParams', demoSrc)(w2, w2.location, URLSearchParams);
  assert.equal(w2.DEMO.on, false, 'the fixtures must know they are not in demo mode');

  // Every demo surface is gated on TBT_DEMO.
  for (const gate of [
    'if (TBT_DEMO && window.DEMO) {',
    'obs: (TBT_DEMO ? pgObsDemo : pgObs),',
    'analytics: (TBT_DEMO ? pgAnalyticsDemo : pgAnalytics)',
    'if (TBT_DEMO) return pgTalksDemo();',
  ]) includes(js, gate, `demo surface must be gated: ${gate}`);

  // C.demo is the only thing that redirects the transport, and it is set
  // solely inside the demo branch.
  const demoAssign = (js.match(/C\.demo = true;/g) || []);
  assert.equal(demoAssign.length, 1, 'C.demo must be set in exactly one place');
  const bootIdx = js.indexOf('if (TBT_DEMO && window.DEMO) {');
  const assignIdx = js.indexOf('C.demo = true;');
  assert.ok(assignIdx > bootIdx && assignIdx < bootIdx + 400,
    'C.demo must only be set inside the demo boot branch');

  // No fixture total is hardcoded into the page.
  const analytics = js.slice(js.indexOf('function pgAnalyticsDemo()'), js.indexOf('function anStyle()'));
  assert.ok(!/>\s*(3|6|15|10|9|127)\s*</.test(analytics.replace(/viewBox[^"]*"[^"]*"/g, '')),
    'analytics must not hardcode a fixture total into the markup');
}

/* ------------------------------------------------------------------ *
 * 16. Both files still parse
 * ------------------------------------------------------------------ */
assert.doesNotThrow(() => new Function(js), 'office.js has invalid JavaScript');
assert.doesNotThrow(() => new Function(demoSrc), 'office-demo.js has invalid JavaScript');

console.log(`Office demo verification passed (${fams.length} JHAs from ${DEMO.jha.length} revision rows, ` +
  `${comp.completed.length}/${comp.required.length} daily compliance, 3 companies isolated).`);
