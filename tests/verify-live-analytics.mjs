/* The Analytics interface, calculations, filters and empty states must work on
 * REAL Greiner data — with no fixture, no demo company and no estimate.
 *
 * This runs the analytics calculators in live mode (TBT_DEMO false, window.DEMO
 * absent) against three real-data-shaped bundles: empty, partial and populated.
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
    function repDateDisp(){ return ''; }
    function post(){ return Promise.resolve([]); }
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
    ${slice('anlIncidents', 'pgAnalyticsDemo')}
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
  const findings = [{ id: 'f1', job_id: 'j1', description: 'Guardrail gap',
    corrective: 'Close the gap', due: isoDay(dayAt(-1)), status: 'open',
    imported: false, photos_list: [] }];
  const M = live({ jobs, findings, incidents: [], near_misses: [], equipment: [] }, field);

  const ff = M.anlFieldForms();
  assert.equal(ff.total, 2, 'both real submissions are counted');
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
  assert.equal(ca.all.length, 1, 'the real finding produces one corrective action');
  assert.equal(ca.overdue.length, 1, 'and it is overdue');
  assert.equal(ca.all[0].src, 'Safety inspection finding', 'using the clearer source label');
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
  for (const leak of ['Demo Job A', 'Demo Foreman', 'DEMO-SL-', 'Alex Fyffe']) {
    const inAnalytics = analytics.includes(leak);
    assert.ok(!inAnalytics, `"${leak}" must not appear in the analytics code`);
  }
  // Production keeps its locked analytics page and its real transport.
  includes('PILOT: Analytics is intentionally locked', 'the production lock must remain');
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

console.log('Live analytics verification passed (empty, partial and populated real-data bundles).');
