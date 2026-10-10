/* The Analytics interface, calculations, filters and empty states must work on
 * REAL Greiner data — with no fixture, no demo company and no estimate.
 *
 * This runs the analytics calculators in live mode (TBT_DEMO false, window.DEMO
 * absent) against three real-data-shaped bundles: empty, partial and populated,
 * then renders the live Analytics route itself (both views) and proves it shows
 * only the sections real records can fill, with no demo or fixture wording.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const js = fs.readFileSync(new URL('office.js', root), 'utf8');
const demoSrc = fs.readFileSync(new URL('office-demo.js', root), 'utf8');
const html = fs.readFileSync(new URL('office.html', root), 'utf8');
const includes = (text, msg) => assert.ok(js.includes(text), msg);

const slice = (name, endName) => {
  const i = js.indexOf(`function ${name}(`);
  assert.ok(i > -1, `${name} is missing`);
  const j = js.indexOf(`\n  function ${endName}(`, i);
  return js.slice(i, j > -1 ? j : undefined);
};

/* Build the calculators with TBT_DEMO false and no window.DEMO at all — the
   exact conditions of the production dashboard. */
function live(bundle, fieldraw) {
  return new Function('B', 'FIELDRAW', 'window', `
    var TBT_DEMO = false;
    function esc(s){ return String(s == null ? '' : s); }
    function jobName(id){ var j=(B.jobs||[]).filter(function(x){return x.id===id;})[0]; return j?j.name:id; }
    function subName(){ return ''; }
    function post(){ return Promise.resolve([]); }
    ${js.slice(js.indexOf('  var TZ = '), js.indexOf('  function fmtDate('))}
    var CAFINDS = [];
    ${slice('deriveFindings', 'shrinkPhoto')}
    ${js.slice(js.indexOf('  var SI_FORMS_READY = ['), js.indexOf('  function siStyle()'))}
    ${slice('anlRangeBounds', 'anlRangeDays')}
    ${slice('anlRangeDays', 'anlJobs')}
    ${slice('anSrc', 'anIsoDay')}
    ${slice('anIsoDay', 'anDayOffset')}
    ${slice('anDayOffset', 'anlFieldForms')}
    ${slice('anlFieldForms', 'anlHotWork')}
    ${slice('anlHotWork', 'anlLifts')}
    ${slice('anlLifts', 'anlCorrective')}
    ${slice('anlCorrective', 'anlIncidents')}
    ${slice('anlIncidents', 'pgAnalytics')}
    ${slice('anlJobs', 'anlCompliance')}
    ${slice('anlCompliance', 'anlJhaActivity')}
    ${slice('anlJhaActivity', 'anlToolbox')}
    ${slice('jhaFamilies', 'jhaBadge')}
    ${slice('allCorrective', 'reportPBody')}
    var anF = { company:'greiner', job:'', from:'', to:'', form:'', status:'', range:'week' };
    var SI_ASSIGN = {};
    (B.jobs||[]).forEach(function(j){ SI_ASSIGN[j.id] = ['jha']; });
    return { anSrc, anlCompliance, anlJhaActivity, anlFieldForms, anlHotWork,
             anlLifts, anlCorrective, anlIncidents, jhaFamilies, anlJobs,
             anF: anF, setRange: function(r,f,t){ anF.range=r; anF.from=f; anF.to=t; } };
  `)(bundle, fieldraw, {});   // window with NO .DEMO
}

/* The whole Analytics page, built the same way, with paint() captured. This is
   the code the live route runs: go('analytics') calls pgAnalytics(). */
function livePage(bundle, fieldraw, assign) {
  return new Function('B', 'FIELDRAW', 'window', 'ASSIGN', `
    var TBT_DEMO = false, page = 'analytics', painted = '';
    function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function jobName(id){ var j=(B.jobs||[]).filter(function(x){return x.id===id;})[0]; return j?j.name:id; }
    function subName(){ return ''; }
    function post(){ return Promise.resolve([]); }
    function paint(h){ painted = h; }
    function anlWire(){}
    function eqInService(){ return true; }
    function eqCategory(){ return 'other'; }
    ${js.slice(js.indexOf('  var TZ = '), js.indexOf('  function fmtDate('))}
    ${js.slice(js.indexOf('  function fmtDate('), js.indexOf('  function fmtTime('))}
    ${js.slice(js.indexOf('  function pill('), js.indexOf('\n', js.indexOf('  function pill(')))}
    ${slice('tableWrap', 'pgOverview')}
    ${slice('subtabs', 'wireSubtabs')}
    ${js.slice(js.indexOf('  var SI_FORMS_READY = ['), js.indexOf('  function siStyle()'))}
    ${js.slice(js.indexOf('  var anF = {'), js.indexOf('  function anlWire()'))}
    ${slice('jhaFamilies', 'jhaBadge')}
    ${slice('allCorrective', 'reportPBody')}
    var CAFINDS = [];
    ${slice('deriveFindings', 'shrinkPhoto')}
    SI_ASSIGN = ASSIGN;
    return {
      render: function (tab) { anTab = tab || 'visual'; pgAnalytics(); return painted; },
      pending: function () { SI_ASSIGN = null; anAssignPending = false; anTab = 'visual';
        // the per-job assignment load never answers here, so the page must say it is loading
        siLoadAssignments = function () {}; pgAnalytics(); return painted; },
      anlCorrective: function () { return anlCorrective(); }
    };
  `)(bundle, fieldraw, {}, assign);
}

const isoDay = (d) => d.toISOString().slice(0, 10);
const dayAt = (n, h) => { const d = new Date(); d.setHours(h || 8, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const weekdayBack = (n) => {
  let left = n;
  for (let i = 0; i < 20; i++) {
    const d = dayAt(-i, 8);
    if (d.getDay() >= 1 && d.getDay() <= 5) { if (left === 0) return d; left--; }
  }
  return dayAt(-1, 8);
};

/* ------------------------------------------------------------------ *
 * 1. EMPTY — a real dashboard with no data yet
 * ------------------------------------------------------------------ */
{
  const M = live({ jobs: [], findings: [], incidents: [], near_misses: [], equipment: [] }, []);
  const src = M.anSrc();
  assert.equal(src.live, true, 'with no window.DEMO the source must report live');
  assert.equal(src.toolbox, false, 'the weekly Toolbox system is not live');
  assert.deepEqual(src.field, [], 'no submissions');

  const c = M.anlCompliance();
  assert.equal(c.required.length, 0, 'nothing required with no jobs');
  assert.equal(c.pct, 0, 'no denominator means no rate, not a fabricated one');
  assert.equal(M.anlJhaActivity().unique, 0, 'no JHAs');
  assert.equal(M.anlFieldForms().total, 0, 'no submissions');
  assert.equal(M.anlCorrective().all.length, 0, 'no corrective actions');

  const ic = M.anlIncidents();
  assert.equal(ic.incidents.length, 0, 'no incidents');
  assert.equal(ic.daysSinceRecordable, null,
    'with no baseline the live build must report null, never 0');
  assert.equal(ic.baseline.last_recordable, null, 'live carries no baseline yet');
  assert.equal(ic.recordkeepingStart, null, 'live carries no recordkeeping start yet');
}

/* ------------------------------------------------------------------ *
 * 2. PARTIAL — some jobs, a few submissions, one finding
 * ------------------------------------------------------------------ */
{
  const jobs = [{ id: 'j1', name: 'Taylorsville Elementary' }, { id: 'j2', name: 'Blind School' }];
  const d0 = weekdayBack(0);
  const field = [
    { id: 's1', form_type: 'jha', form_title: 'Job Hazard Analysis', job_id: 'j1',
      job_name: 'Taylorsville Elementary', inspector_name: 'K. Reed',
      submitted_at: d0.toISOString(), has_defects: false, defect_count: 0 },
    { id: 's2', form_type: 'hotwork', form_title: 'Hot Work Permit', job_id: 'j1',
      job_name: 'Taylorsville Elementary', inspector_name: 'K. Reed',
      submitted_at: d0.toISOString(), has_defects: true, defect_count: 1 },
  ];
  // Production has no findings feed in the bundle. Corrective actions are the
  // live Corrective actions tab's list: flagged field forms and failed Safety
  // 101 items, with saved closeouts (cs_finding_actions) applied.
  const tenDaysAgo = dayAt(-10, 10);
  field.push({ id: 's3', form_type: 'forklift', form_title: 'Forklift Inspection', job_id: 'j1',
    job_name: 'Taylorsville Elementary', inspector_name: 'K. Reed',
    submitted_at: tenDaysAgo.toISOString(), has_defects: true, defect_count: 2, asset_id: 'FL-9' });
  const reports = [{ id: 'r1', job_id: 'j2', imported: true, defect_count: 2, report_date: isoDay(dayAt(-3)),
    inspector_name: 'Safety', s101: [{ title: 'Ladders', items: [
      { q: 'Ladder in good condition', result: 'FAIL' }, { q: 'Tied off', result: 'PASS' },
      { q: 'Three points of contact', result: 'FAIL' }] }] }];
  const finding_actions = { 'rf|r1|s101|0-2': { status: 'closed', action: 'Replaced', closed_by: 'Tony' } };
  const M = live({ jobs, reports, finding_actions, findings: [], incidents: [], near_misses: [], equipment: [] }, field);

  const ff = M.anlFieldForms();
  assert.equal(ff.total, 2, 'both real submissions this week are counted');
  assert.equal(ff.withDefects.length, 1, 'the flagged one is counted');
  assert.equal(M.anlHotWork().count, 1, 'the hot work permit is counted');
  assert.equal(M.anlLifts().count, 0, 'no lift inspections');

  // Real JHAs carry no revision chain — the figures must read zero, not guess.
  const jha = M.anlJhaActivity();
  assert.equal(jha.unique, 1, 'one real JHA');
  assert.equal(jha.revised.length, 0, 'no revisions exist in production yet');
  assert.equal(jha.events, 0, 'no revision events');
  assert.equal(jha.pctRevised, 0, 'zero percent revised, derived not estimated');

  const c = M.anlCompliance();
  assert.ok(c.required.length > 0, 'requirements come from the job assignments');
  assert.equal(c.completed.length + c.missed.length, c.required.length,
    'completed plus missed must equal required');
  assert.ok(c.pct >= 0 && c.pct <= 100, 'the rate must be a real percentage');

  const ca = M.anlCorrective();
  // s2 (hot work, flagged today), s3 (forklift, flagged 10 days ago), and two
  // failed Safety 101 items, one of them closed out.
  assert.equal(ca.all.length, 4, 'every flagged form and failed item is a corrective action');
  assert.equal(ca.closed.length, 1, 'the saved closeout is applied');
  assert.equal(ca.open.length, 3, 'the rest stay open');
  assert.equal(ca.overdue.length, 1, 'only the form flagged 10 days ago is past its 7-day due date');
  assert.deepEqual([...new Set(ca.all.map((c) => c.src))].sort(),
    ['Field form flagged', 'Safety 101 inspection'], 'plain source labels');
  assert.equal(M.anSrc().findings.length, 0, 'there is no separate findings feed in production');
}

/* ------------------------------------------------------------------ *
 * 2b. Stored form names: hot work and aerial lifts count
 * ------------------------------------------------------------------ */
{
  // The phone stores hot work as hot_work_permit and aerial lifts as
  // aerial_platform. Before the mapping these read zero on real data.
  const jobs = [{ id: 'j1', name: 'IU Health Plaza G Med. Gas' }];
  const at = weekdayBack(0).toISOString();
  const field = [
    { id: 'h1', form_type: 'hot_work_permit', form_title: 'Hot Work Permit', job_id: 'j1', submitted_at: at },
    { id: 'h2', form_type: 'hot_work_permit', form_title: 'Hot Work Permit', job_id: 'j1', submitted_at: at, has_defects: true, defect_count: 1 },
    { id: 'a1', form_type: 'aerial_platform', form_title: 'Aerial Platform Inspection', job_id: 'j1', submitted_at: at, asset_id: 'SL-1' },
    { id: 'f1', form_type: 'forklift', form_title: 'Forklift Inspection', job_id: 'j1', submitted_at: at, asset_id: 'FL-1' },
    { id: 'k1', form_type: 'job_site_analysis', form_title: 'Job Hazard Analysis (Checklist)', job_id: 'j1', submitted_at: at },
  ];
  const M = live({ jobs, findings: [], incidents: [], near_misses: [], equipment: [] }, field);
  assert.equal(M.anlHotWork().count, 2, 'hot_work_permit rows are hot work permits');
  assert.equal(M.anlHotWork().flagged.length, 1, 'and the flagged one is counted');
  assert.equal(M.anlLifts().aerial.length, 1, 'aerial_platform rows are aerial lift inspections');
  assert.equal(M.anlLifts().forklift.length, 1, 'forklift rows stay forklift');
  assert.equal(M.anlFieldForms().total, 5, 'every real submission is counted once');
  assert.equal(M.anlJhaActivity().unique, 0, 'the old JHA checklist is its own form, not a guided JHA');
}

/* ------------------------------------------------------------------ *
 * 3. POPULATED — enough real data to exercise every section
 * ------------------------------------------------------------------ */
{
  const jobs = [{ id: 'j1', name: 'Job One' }, { id: 'j2', name: 'Job Two' }, { id: 'j3', name: 'Job Three' }];
  const field = [];
  for (let d = 0; d < 4; d++) {
    for (const j of jobs) {
      if (d === 2 && j.id === 'j3') continue;          // one real gap
      field.push({ id: `jha-${j.id}-${d}`, form_type: 'jha', form_title: 'Job Hazard Analysis',
        job_id: j.id, job_name: j.name, inspector_name: 'Foreman',
        submitted_at: weekdayBack(d).toISOString(), has_defects: false, defect_count: 0 });
    }
  }
  field.push({ id: 'al1', form_type: 'aerial', form_title: 'Aerial Lift Inspection', job_id: 'j1',
    job_name: 'Job One', inspector_name: 'Op', submitted_at: weekdayBack(0).toISOString(),
    has_defects: true, defect_count: 2, asset_id: 'SL-01' });
  field.push({ id: 'fl1', form_type: 'forklift', form_title: 'Forklift Inspection', job_id: 'j2',
    job_name: 'Job Two', inspector_name: 'Op', submitted_at: weekdayBack(1).toISOString(),
    has_defects: false, defect_count: 0, asset_id: 'FL-01' });

  const M = live({ jobs, findings: [], incidents: [], near_misses: [], equipment: [] }, field);
  const ff = M.anlFieldForms();
  assert.equal(ff.total, field.length, 'every real submission counted once');
  assert.ok(ff.types.length >= 3, 'several form types present');
  assert.equal(M.anlLifts().count, 2, 'both lift inspections');
  assert.equal(M.anlLifts().flagged.length, 1, 'one failed');
  assert.equal(M.anlLifts().units.length, 2, 'two distinct units');

  const c = M.anlCompliance();
  assert.ok(c.missed.length >= 1, 'the real gap shows as missed');
  assert.equal(c.pct, Math.round(c.completed.length / c.required.length * 100),
    'the rate is derived from the records');

  // Incidents stay honestly empty even with a busy dashboard.
  const ic = M.anlIncidents();
  assert.equal(ic.incidents.length, 0, 'no incidents in the real bundle');
  assert.equal(ic.daysSinceRecordable, null, 'still no baseline, still not zero');
}

/* ------------------------------------------------------------------ *
 * 4. No fixture can reach a live screen
 * ------------------------------------------------------------------ */
{
  // The fixture file is the only place demo records live, and it is a separate
  // script that production does not have to ship.
  assert.ok(/var (JOBS|JHA|FINDINGS|COMPLETIONS|FIELD_USERS) = /.test(demoSrc),
    'the fixtures live in office-demo.js');
  const analytics = js.slice(js.indexOf('function anSrc()'), js.indexOf('function anStyle()'));
  // Every fixture read in the analytics code is behind the demo gate.
  const demoReads = [...analytics.matchAll(/window\.DEMO\.\w+/g)].map((m) => m[0]);
  for (const r of demoReads) {
    const at = analytics.indexOf(r);
    const before = analytics.slice(Math.max(0, at - 400), at);
    assert.ok(before.includes('TBT_DEMO'),
      `every fixture read must sit behind the demo gate: ${r}`);
  }
  // anSrc is the single switch.
  includes('function anSrc() {', 'there must be one data-source accessor');
  includes('if (TBT_DEMO && window.DEMO) {', 'the demo branch must be gated on TBT_DEMO');
  includes('return {\n      live: true,', 'the live branch must be the default');

  // No demo company names, jobs or people are referenced outside the fixtures.
  for (const leak of ['Demo Job A', 'Demo Foreman', 'DEMO-SL-', 'Ainsley Frost']) {
    const inAnalytics = analytics.includes(leak);
    assert.ok(!inAnalytics, `"${leak}" must not appear in the analytics code`);
  }
  // Production runs the approved page on real data: one route, no lock, no
  // leftover duplicate that could win by hoisting.
  includes('analytics: pgAnalytics,', 'the analytics route must be the one live page');
  assert.ok(!js.includes('PILOT: Analytics is intentionally locked'), 'the production lock is gone');
  assert.ok(!js.includes('SDAnalytics'), 'the analytics.js bridge (never shipped) is gone');
  assert.equal((js.match(/\n  function pgAnalytics\(/g) || []).length, 1,
    'exactly one pgAnalytics, so nothing can shadow it');
  assert.ok(!js.includes('pgAnalyticsDemo'), 'no separate demo-only analytics function remains');
  includes("fetch(C.creekside.url + '/rest/v1/rpc/' + fn", 'the real transport must remain');
  includes('function getSession()', 'authentication must remain');
  // Incident intake stays held.
  includes("$('#in-save').onclick = pilotHold('Incident records');",
    'incident intake must stay held');
  includes("sv.onclick = function () { toast('Incident details saved.'); openIncident(id); };",
    'the unfinished investigation save must be left exactly as it was');
  // The fixture script is loaded, but production can drop it.
  assert.match(html, /office-demo\.js/, 'the demo page loads the fixtures');
}

/* ------------------------------------------------------------------ *
 * 5. The live route renders the real-data page, with no demo text
 * ------------------------------------------------------------------ */
{
  const jobs = [{ id: 'j1', name: 'IU Health Plaza G Med. Gas', status: 'active' },
                { id: 'j2', name: 'Purdue Academic Bldg.', status: 'active' }];
  const at = weekdayBack(0).toISOString();
  const field = [
    { id: 'x1', form_type: 'jha', form_title: 'JHA (Task / Hazard / Control)', job_id: 'j1', job_name: 'IU Health Plaza G Med. Gas', inspector_name: 'Foreman A', submitted_at: at },
    { id: 'x2', form_type: 'hot_work_permit', form_title: 'Hot Work Permit', job_id: 'j1', job_name: 'IU Health Plaza G Med. Gas', inspector_name: 'Foreman A', submitted_at: at },
    { id: 'x3', form_type: 'aerial_platform', form_title: 'Aerial Platform Inspection', job_id: 'j2', job_name: 'Purdue Academic Bldg.', inspector_name: 'Op', submitted_at: at, asset_id: 'SL-7', has_defects: true, defect_count: 1 },
  ];
  const assign = { j1: ['jha', 'hotwork', 'aerial', 'forklift'], j2: ['hotwork', 'aerial'] };
  const P = livePage({ jobs, reports: [], finding_actions: {}, findings: [], incidents: [], near_misses: [], equipment: [] }, field, assign);
  const text = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // Wording a live user must never see. Checked against everything rendered,
  // including the hover/info text carried in attributes.
  const banned = /demo|fixture|sample|not yet live|baseline|toolbox|incident|near miss|revision|finish analytics setup|data readiness/i;

  const visual = P.render('visual');
  const vt = text(visual);
  for (const card of ['Daily Safety Compliance', 'JHA Activity', 'Open Corrective Actions',
    'Field Form Activity', 'Hot Work Activity', 'Lift Inspection Activity']) {
    assert.ok(vt.includes(card), `live Visual Dashboard shows ${card}`);
  }
  const visualAll = visual.replace(/<style>[\s\S]*?<\/style>/g, ' ');
  assert.ok(!banned.test(visualAll), `live Visual Dashboard must not show: ${(visualAll.match(banned) || [])[0]}`);
  assert.ok(!visualAll.includes('an-pill'), 'no Demo Data pill on the live page');
  assert.ok(!visual.includes('id="an-company"'), 'no demo company picker on the live page');
  assert.ok(!visual.includes('id="an-form"') && !visual.includes('id="an-status"'),
    'no filters that do not change any number');
  assert.ok(visual.includes('an-grid an-g3'), 'six live cards sit in one grid of three');
  assert.equal((visual.match(/class="an-c[ "]/g) || []).length, 6, 'exactly six cards');
  // The numbers come from the records.
  assert.match(vt, /1 JHA submitted/, 'one JHA this week');
  assert.match(vt, /Hot Work 1/, 'the hot work permit shows in field form activity');
  assert.match(vt, /Failed: SL-7/, 'the failed aerial unit is named');
  assert.match(vt, /3 Submissions/, 'three submissions in total');

  const all = P.render('all');
  const at2 = text(all);
  for (const grp of ['Daily Compliance', 'JHA Activity', 'Field Submissions', 'Hot Work',
    'Lift Inspections', 'Corrective Actions']) {
    assert.ok(all.includes('<h3>' + grp + '</h3>'), `live All Metrics shows ${grp}`);
  }
  for (const grp of ['Toolbox Talks', 'Incidents', 'Near Misses', 'Data Readiness']) {
    assert.ok(!all.includes('<h3>' + grp + '</h3>'), `live All Metrics leaves out ${grp}`);
  }
  const allNoStyle = all.replace(/<style>[\s\S]*?<\/style>/g, ' ');
  assert.ok(!banned.test(allNoStyle), `live All Metrics must not show: ${(allNoStyle.match(banned) || [])[0]}`);
  assert.match(at2, /Unique JHAs 1 /, 'the JHA count is in All Metrics');

  // A job with no daily JHA due shows no rate, not 0%.
  const Q = livePage({ jobs, reports: [], finding_actions: {}, findings: [], incidents: [], near_misses: [], equipment: [] }, [], { j1: ['hotwork'], j2: [] });
  const q = text(Q.render('visual'));
  assert.match(q, /No daily JHA was due in this date range/, 'nothing due reads as nothing due');
  assert.ok(!/\b0%/.test(q), 'never a 0% rate computed from nothing');
  assert.match(text(Q.render('all')), /Compliance rate — /, 'All Metrics shows no rate either');

  // While the job assignments load, compliance says so instead of 0%.
  const R = livePage({ jobs, reports: [], finding_actions: {}, findings: [], incidents: [], near_misses: [], equipment: [] }, field, assign);
  const r = text(R.pending());
  assert.match(r, /Loading job assignments/, 'compliance waits for its denominator');
}

console.log('Live analytics verification passed (empty, partial and populated real-data bundles; live route renders real data only).');
