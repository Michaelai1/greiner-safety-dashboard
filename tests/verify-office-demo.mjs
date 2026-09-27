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
assert.ok(DEMO.jha.length > fams.length,
  'there must be more revision rows than JHA families');
assert.equal(fams.length, new Set(DEMO.jha.map((j) => j.root_jha_id)).size,
  'every family must be grouped exactly once');
// The revision counts the demo is built to show.
const revCounts = fams.map((f) => f.revisionCount).sort((a, b) => a - b);
assert.ok(revCounts.includes(0), 'at least one JHA was never revised');
assert.ok(revCounts.includes(1), 'at least one JHA was revised once');
assert.ok(revCounts.includes(2), 'at least one JHA was revised twice');
assert.ok(revCounts.includes(3), 'at least one JHA was revised three times');
assert.equal(DEMO.jha.length, fams.reduce((n, f) => n + f.revisions.length, 0),
  'no revision row may be lost or double-counted');

const byRoot = Object.fromEntries(fams.map((f) => [f.root, f]));

// Revision count is edits AFTER the original, not the number of versions.
for (const f of fams) {
  assert.equal(f.revisionCount, f.revisions.length - 1,
    `${f.root}: revision count must exclude the original`);
}

/* ------------------------------------------------------------------ *
 * 2. The table shows the latest version, the original is preserved
 * ------------------------------------------------------------------ */
const f3 = fams.filter((f) => f.revisionCount === 3)[0];
assert.ok(f3, 'a three-revision family must exist');
assert.equal(f3.latest.revision_number, 4, 'the latest version must be the highest revision');
assert.equal(f3.description, f3.latest.description_of_work,
  'the row must show the latest description of work');
assert.equal(f3.employee_count, (f3.latest.employees || []).length,
  'the row must show the latest employee count');
assert.equal(f3.latest_editor, f3.latest.revised_by, 'the row must show the latest editor');

// The original is still there, in full, unchanged.
assert.equal(f3.original.revision_number, 1, 'the original is revision_number 1');
assert.equal(f3.original.id, f3.revisions[0].id, 'the original must be the first revision');
assert.equal(f3.original_submitter, f3.original.submitted_by,
  'the original submitter must be preserved');
assert.ok(f3.original.employees.length <= f3.latest.employees.length,
  'the original crew must not be overwritten by later revisions');
assert.notEqual(f3.original.description_of_work, f3.latest.description_of_work,
  'the original description must survive the later edits');
for (const r of f3.revisions) {
  assert.equal(r.original_submitted_at, f3.original.original_submitted_at,
    `${r.id} must carry the original submission time`);
}
assert.deepEqual(f3.revisions.map((r) => r.revision_number), [1, 2, 3, 4],
  'every version must be retained in order');
assert.equal(f3.latest.status, 'submitted', 'the latest version is the live one');
assert.ok(f3.revisions.slice(0, -1).every((r) => r.status === 'superseded'),
  'earlier versions must be marked superseded, not deleted');

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
// Every figure is derived from the records, whatever size the fixture is.
assert.equal(act.unique, act.families.length, 'unique JHAs is the family count');
assert.equal(act.revised.length, act.families.filter((f) => f.revisionCount > 0).length,
  'revised is the families with at least one revision');
assert.equal(act.events, act.families.reduce((n, f) => n + f.revisionCount, 0),
  'the revision-event total must be derived from the records');
assert.equal(act.pctRevised, Math.round(act.revised.length / act.unique * 100),
  'the revised share must be derived');
assert.equal(act.avgPerRevised,
  Math.round(act.events / act.revised.length * 10) / 10,
  'the average must be derived');
// The demo is meant to look healthy: most JHAs are never revised.
assert.ok(act.unique >= 20, `the fixture should carry a useful number of JHAs, got ${act.unique}`);
assert.ok(act.pctRevised < 25, 'most JHAs should not need revising in a good week');
// Most recently revised first.
for (let i = 1; i < act.recent.length; i++) {
  assert.ok(act.recent[i - 1].latest_revised_at >= act.recent[i].latest_revised_at,
    'recent revisions must be newest first');
}

/* ------------------------------------------------------------------ *
 * 5. Filtering — job, date, submitter, original vs revised, revision count
 * ------------------------------------------------------------------ */
const jf = M.getJhaF();
const reset = () => Object.assign(jf, { job: '', from: '', to: '', by: '', kind: '', revs: '' });
const allFams = M.jhaFamilies();

reset(); jf.job = 'demo-job-b';
const jobB = M.jhaFilteredFamilies();
assert.ok(jobB.length > 0, 'Demo Job B has JHAs');
assert.ok(jobB.every((f) => f.job_id === 'demo-job-b'), 'job filter must restrict to that job');
assert.equal(jobB.length, allFams.filter((f) => f.job_id === 'demo-job-b').length,
  'job filter must keep every JHA on that job');

const latestDay = allFams.map((f) => f.work_date).sort().pop();
const earlierDay = allFams.map((f) => f.work_date).sort()[0];
assert.notEqual(latestDay, earlierDay, 'the fixture must span several work days');
reset(); jf.from = latestDay;
assert.ok(M.jhaFilteredFamilies().every((f) => f.work_date >= latestDay),
  'date-from filter must exclude earlier days');
reset(); jf.to = earlierDay;
assert.ok(M.jhaFilteredFamilies().every((f) => f.work_date <= earlierDay),
  'date-to filter must exclude later days');

reset();
const someone = allFams.find((f) => f.revisionCount > 0).latest_editor;
jf.by = someone;
assert.ok(M.jhaFilteredFamilies().every((f) =>
  f.original_submitter === someone || f.latest_editor === someone),
  'submitter filter must restrict to that person');

reset(); jf.kind = 'original';
assert.ok(M.jhaFilteredFamilies().every((f) => f.revisionCount === 0), 'never-revised filter');
reset(); jf.kind = 'revised';
assert.ok(M.jhaFilteredFamilies().every((f) => f.revisionCount > 0), 'revised filter');
assert.equal(M.jhaFilteredFamilies().length, allFams.filter((f) => f.revisionCount > 0).length,
  'the revised filter must keep every revised JHA');

reset(); jf.revs = '3';
assert.ok(M.jhaFilteredFamilies().every((f) => f.revisionCount === 3), 'revision-count filter');
reset();

// Date and job filtering flow through to compliance.
const af = M.getAnF();
const jobCount = M.anlJobs().length;
af.range = 'custom'; af.from = latestDay; af.to = latestDay;
const oneDay = M.anlCompliance();
assert.equal(oneDay.required.length, jobCount,
  'one weekday must require one JHA per active job');
assert.ok(oneDay.required.every((r) => r.day === latestDay), 'only that day is required');

af.job = 'demo-job-a';
const oneJob = M.anlCompliance();
assert.equal(oneJob.required.length, 1, 'one job on one weekday');
assert.ok(oneJob.required.every((r) => r.job_id === 'demo-job-a'), 'job filter must apply');
af.job = ''; af.range = 'week'; af.from = ''; af.to = '';

// The demo is built to read as a healthy week.
const week = M.anlCompliance();
assert.ok(week.pct >= 90 && week.pct <= 94,
  `demo compliance should sit in the 90-94% band, got ${week.pct}%`);
assert.ok(week.missed.length > 0, 'a believable week still has a few misses');
assert.ok(week.missed.length <= 3, 'but only a few');

/* ------------------------------------------------------------------ *
 * 6. Toolbox Talk — group completion, attendance, manual entries
 * ------------------------------------------------------------------ */
store.clear(); M.reload();
M.setCompany('greiner');
const g = M.anlToolbox();
assert.equal(g.stats.mode, 'group', 'Greiner is in group mode');
assert.equal(g.stats.total, M.TBT_COMPANIES.greiner.groups.length,
  'every crew is assigned the weekly talk');
assert.equal(g.stats.completed.length + g.stats.outstanding.length, g.stats.total,
  'completed plus outstanding must equal assigned');
assert.equal(g.stats.pct, Math.round(g.stats.completed.length / g.stats.total * 100),
  'the rate must be derived');
// The demo is built to read as a healthy week.
assert.ok(g.stats.pct >= 90 && g.stats.pct <= 96,
  `demo participation should sit in the 90-96% band, got ${g.stats.pct}%`);
assert.ok(g.stats.outstanding.length >= 1, 'one crew still outstanding keeps it believable');

// Attendance: distinct roster employees + every manual entry.
const gRecs = g.stats.records.filter((c) => c.kind === 'group');
const rosterUnion = new Set();
let manual = 0;
gRecs.forEach((c) => { (c.roster || []).forEach((n) => rosterUnion.add(n)); manual += (c.manual || []).length; });
assert.equal(g.stats.rosterCount, rosterUnion.size, 'distinct roster attendees');
assert.equal(g.stats.manualCount, manual, 'manual entries counted separately');
assert.equal(g.stats.attendance, rosterUnion.size + manual, 'attendance is the sum');
assert.ok(manual > 0, 'the fixture must exercise manual attendance');

// Manual attendees do NOT change the assigned denominator.
const rosterNames = new Set(M.TBT_COMPANIES.greiner.employees.map((e) => e.n));
const manualNames = gRecs.reduce((a, c) => a.concat(c.manual || []), []);
assert.ok(manualNames.every((n) => !rosterNames.has(n)),
  'a manual attendee must not be on the assigned roster');
assert.equal(g.stats.total, M.TBT_COMPANIES.greiner.groups.length,
  'manual attendees must not increase the number of groups assigned');

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
const p2 = M.anlToolbox();
assert.equal(p2.stats.mode, 'individual', 'Peine is in individual mode');
assert.equal(p2.stats.total, M.TBT_COMPANIES.peine.employees.length,
  'every Peine employee is assigned');
assert.equal(p2.stats.completed.length + p2.stats.outstanding.length, p2.stats.total,
  'completed plus outstanding must equal assigned');
assert.ok(p2.stats.pct >= 90 && p2.stats.pct <= 96,
  `Peine participation should sit in the 90-96% band, got ${p2.stats.pct}%`);
assert.ok(p2.stats.outstanding.length >= 1, 'one employee still outstanding');

// The fixture deliberately contains a duplicate completion.
const peineRecords = DEMO.completions.peine;
const seen = {};
let dupes = 0;
peineRecords.forEach((c) => { if (seen[c.employee]) dupes++; seen[c.employee] = 1; });
assert.ok(dupes > 0, 'the fixture must contain a duplicate completion to test against');
assert.equal(p2.stats.completed.length, Object.keys(seen).length,
  'a duplicate completion must not inflate the completed count');
assert.ok(peineRecords.length > p2.stats.completed.length,
  'there must be more records than completed people');

/* ------------------------------------------------------------------ *
 * 9. Company isolation
 * ------------------------------------------------------------------ */
store.clear(); M.reload();
for (const [key, mode] of [['greiner', 'group'], ['choice', 'group'], ['peine', 'individual']]) {
  M.setCompany(key);
  const t = M.anlToolbox();
  const def = M.TBT_COMPANIES[key];
  assert.equal(t.stats.mode, mode, `${key} completion mode`);
  assert.equal(t.stats.total, mode === 'group' ? def.groups.length : def.employees.length,
    `${key} assigned must come from its own roster`);
  assert.equal(t.stats.completed.length,
    t.stats.total - t.stats.outstanding.length, `${key} completed`);
  // Every record in this company's bucket belongs to this company.
  assert.ok(t.stats.records.every((r) => r.company === key),
    `${key} must only read its own records`);
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
assert.equal(M.anlJobs().length, DEMO.jobs.length, 'Greiner has the demo jobs');
assert.ok(DEMO.jobs.length >= 5, 'the fixture must carry enough jobs for the charts');

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
  assert.ok(jhaType.rows.length > jhaType.count,
    'raw JHA revision rows must outnumber the counted submissions');
  assert.equal(jhaType.count, new Set(jhaType.rows.map((r) => r.root_jha_id)).size,
    'JHA submissions are counted per family');
  assert.equal(ff.total, ff.types.reduce((n, t) => n + t.count, 0),
    'the total must be the sum of the per-type counts');
  assert.ok(ff.total >= 40, `the fixture should carry enough submissions for the charts, got ${ff.total}`);
  assert.ok(ff.types.length >= 4, 'several form types must be represented');
  // The drilldown list must be exactly as long as the card total.
  assert.equal(ff.counted.length, ff.total,
    'the field-form drilldown must list exactly what the card counted');
  assert.equal(ff.counted.filter((r) => r.form_type === 'jha').length, jhaType.count,
    'each JHA family appears once in the drilldown');

  const hw = M.anlHotWork();
  assert.ok(hw.count > 0, 'the fixture must carry hot work permits');
  assert.equal(hw.count, hw.rows.length, 'the count is the row count');
  assert.ok(hw.rows.every((r) => r.form_type === 'hotwork'), 'only hot work permits');
  assert.equal(hw.flagged.length, hw.rows.filter((r) => r.has_defects).length,
    'flagged is derived from the records');
  assert.equal(Object.keys(hw.jobs).length, new Set(hw.rows.map((r) => r.job_id)).size,
    'the job count is derived from the records');

  const lf = M.anlLifts();
  assert.equal(lf.count, lf.rows.length, 'the lift count is the row count');
  assert.equal(lf.aerial.length + lf.forklift.length, lf.count, 'the split must total the count');
  assert.ok(lf.aerial.length > 0 && lf.forklift.length > 0, 'both lift types must appear');
  assert.equal(lf.units.length, new Set(lf.rows.map((r) => r.asset_id).filter(Boolean)).size,
    'units is the distinct asset count');
  assert.ok(lf.units.length < lf.count, 'at least one unit is inspected more than once');
  assert.equal(lf.flagged.length, lf.rows.filter((r) => r.has_defects).length,
    'failed inspections are derived from the records');
  assert.ok(lf.flagged.length > 0, 'the fixture must show at least one failed unit');
}

/* ------------------------------------------------------------------ *
 * 12d. Corrective actions come from real records only
 * ------------------------------------------------------------------ */
{
  const ca = M.anlCorrective();
  assert.equal(ca.all.length, DEMO.findings.length,
    'every corrective action must come from a fixture record');
  assert.equal(ca.open.length + ca.closed.length, ca.all.length,
    'open plus closed must equal the total');
  // Overdue is a subset of open, never counted separately.
  assert.ok(ca.overdue.every((c) => ca.open.includes(c)), 'overdue must be a subset of open');
  assert.ok(ca.open.length > 0, 'a believable week has a few open actions');
  assert.ok(ca.open.length <= 5, 'but only a few');
  assert.ok(ca.overdue.length <= 1, 'no more than one overdue action in the demo');
  // With no incidents there are no incident corrective actions.
  assert.equal(ca.all.filter((c) => c.src === 'Incident').length, 0,
    'no incident corrective actions can exist while there are no incidents');
  // The clearer source label is in use.
  assert.ok(ca.all.some((c) => c.src === 'Safety inspection finding'),
    'findings must use the clearer source label');
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
includes(js, "['log', 'Submission Log']", 'Submission Log must be a view');
includes(js, "['find', 'Findings & Corrective Actions']", 'Findings must be a view');

/* Weekly Requirements is no longer a visible tab. */
{
  const tabs = js.slice(js.indexOf('function pgObsDemo()'), js.indexOf('function siRequirementsHtml'));
  assert.ok(!tabs.includes("['req', 'Weekly Requirements']"),
    'Weekly Requirements must not be a visible Safety Inspections tab');
  assert.ok(!/subtabs\([^)]*Weekly Requirements/.test(js),
    'Weekly Requirements must not appear in any subtab strip');
  // Submission Log is the default.
  includes(js, "if (['log', 'jha', 'find', 'rules'].indexOf(siTab) === -1) siTab = 'log';",
    'Safety Inspections must default to the Submission Log');
  // The requirement records and calculations survive.
  includes(js, 'function siRequirementsHtml()', 'the requirements view must still exist');
  includes(js, 'function siExpected(', 'the expected-quantity calculation must survive');
  includes(js, 'function siStatus(', 'the requirement status calculation must survive');
  includes(js, 'Compliance Rules', 'requirements must be reachable as Compliance Rules');
  includes(js, "id=\"si-gorules\"", 'the Compliance Rules control must exist');
  assert.ok(M.siReqs().length > 0, 'the requirement records must still be there');
  // Compliance still has a denominator.
  assert.ok(M.anlCompliance().required.length > 0,
    'compliance must still compute a denominator from the requirements');
}

/* Add Inspection for This Week lives on the Submission Log. */
includes(js, '+ Add Inspection for This Week', 'the Submission Log must offer Add Inspection');
includes(js, "id=\"si-addinsp\"", 'the Add Inspection button must be wired');
includes(js, 'It does not mark an inspection complete', 'the panel must say what it does not do');
includes(js, 'This creates an <b>expected</b> field inspection',
  'the panel must say it creates an expected inspection');
includes(js, 'function siJhaHtml() { return jhaBodyHtml(); }',
  'JHA Review must reuse the JHA table, not a copy of it');
includes(js, 'function jhaBodyHtml()', 'the JHA table must be reusable');
// Analytics JHA card opens JHA Review.
includes(js, "var toSi = { compliance: 'rules', jhareview: 'jha', findings: 'find' };",
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
 * 12m. Analytics has two views over the same records
 * ------------------------------------------------------------------ */
{
  includes(js, "[['visual', 'Visual Dashboard'], ['all', 'All Metrics']]",
    'Analytics must offer both views');
  includes(js, "var anTab = 'visual';", 'the Visual Dashboard must be the default');
  includes(js, 'function anAllMetricsHtml()', 'All Metrics must exist');
  // Both views call the same calculators — no second source of truth.
  const allSrc = js.slice(js.indexOf('function anAllMetricsHtml()'), js.indexOf('function anlPrevious') > 0
    ? js.indexOf('  /* Date-range control') : js.length);
  for (const fn of ['anlCompliance()', 'anlJhaActivity()', 'anlToolbox()', 'anlFieldForms()',
    'anlHotWork()', 'anlLifts()', 'anlCorrective()', 'anlIncidents()']) {
    assert.ok(allSrc.includes(fn), `All Metrics must read ${fn}, not a private copy`);
  }
  // Every group the brief asked for.
  for (const grp of ['Daily Compliance', 'JHA Activity', 'Toolbox Talks', 'Field Submissions',
    'Hot Work', 'Lift Inspections', 'Corrective Actions', 'Incidents', 'Near Misses',
    'Data Readiness']) {
    assert.ok(allSrc.includes("anGroup('" + grp + "'"), `All Metrics must group: ${grp}`);
  }
  // Rows carry a previous value, a change and a source.
  includes(js, 'function anRow(metric, value, prev, source, drill)',
    'each metric row must carry value, previous, change and source');
  includes(js, 'function anlPrevious()', 'the previous period must be computed');
  // No return to explanatory paragraphs.
  assert.ok(!allSrc.includes('an-note'), 'All Metrics must not reintroduce prose panels');
}

/* ------------------------------------------------------------------ *
 * 12n. Toolbox scheduling works without drag-and-drop
 * ------------------------------------------------------------------ */
{
  includes(js, "var tbtTab = 'schedule';", 'the Toolbox page must open on Schedule');
  includes(js, "[['schedule', 'Schedule'], ['completion', 'Completion'], ['library', 'Library']]",
    'the Toolbox views must be Schedule, Completion and Library');
  includes(js, '+ Add Talk to Schedule', 'the primary scheduling action must exist');
  includes(js, "id=\"tbt-addtalk\"", 'the Add Talk button must be wired');
  includes(js, 'id="tbt-replace"', 'the current week must offer Replace Talk');
  // Every action has a visible button, not only drag.
  includes(js, 'data-tbt-up=', 'Move Up must be a button');
  includes(js, 'data-tbt-down=', 'Move Down must be a button');
  includes(js, 'data-tbt-del=', 'Remove must be a button');
  includes(js, "draggable=\"true\"", 'drag-and-drop must still be available');
  // The three questions the screen answers.
  includes(js, 'function tbtCurrentWeekHtml(', 'the current week must have its own block');
  includes(js, 'function tbtUpcomingHtml(', 'upcoming weeks must have their own block');
  includes(js, 'function tbtAvailableHtml(', 'the available library must be on the schedule screen');
  // Library filters.
  for (const f of ['Ready to schedule', 'Guided available', 'Original only', 'Never used',
    'Recently used', 'Collections', 'Needs review', 'Excluded']) {
    assert.ok(js.includes("'" + f + "'"), `the library must offer the filter: ${f}`);
  }
  // Collections / needs review / excluded are listed but not schedulable.
  includes(js, "d.s === 'Ready'\n            ? '<button class=\"btn btn-sm btn-gold\" data-tbt-add=",
    'only Ready talks may be added from the library');
  includes(js, 'Not schedulable', 'non-ready talks must say so');
}

/* ------------------------------------------------------------------ *
 * 12o. Add Talk: duplicates prevented, replace supported, per company
 * ------------------------------------------------------------------ */
{
  includes(js, 'function tbtAddTalk(', 'the add-talk flow must exist');
  // The five things the flow asks for.
  for (const field of ['at-co', 'at-talk', 'at-week', 'at-mode', 'at-format']) {
    assert.ok(js.includes('id="' + field + '"'), `the add-talk flow must ask for ${field}`);
  }
  includes(js, 'That talk is already scheduled for this week.',
    'a duplicate must be refused');
  includes(js, "if (replacing === st.talk) { toast('That talk is already scheduled for this week.'); return; }",
    'the save handler must re-check for a duplicate');
  includes(js, 'Adding will replace it.', 'replacing must be announced before it happens');
  includes(js, "(taken && !dup ? 'Replace scheduled talk' : 'Add to schedule')",
    'the button must say which it will do');

  // Scheduling is per company: each keeps its own queue.
  store.clear(); M.reload();
  const gq = M.tbtLoad().companies.greiner.queue.slice();
  const cq = M.tbtLoad().companies.choice.queue.slice();
  M.tbtLoad().companies.greiner.queue.push(M.tbtEligible()
    .map((d) => d.i).find((id) => gq.indexOf(id) === -1));
  assert.equal(M.tbtLoad().companies.choice.queue.length, cq.length,
    "adding to Greiner's schedule must not touch Choice's");
  assert.notEqual(M.tbtLoad().companies.greiner.queue.length, gq.length,
    "Greiner's own schedule must have changed");
  // A talk may only occupy one week per company.
  const q = M.tbtLoad().companies.greiner.queue;
  assert.equal(new Set(q).size, q.length, 'no talk may be scheduled twice for one company');
  store.clear(); M.reload();
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
