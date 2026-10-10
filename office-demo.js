/* ============================================================================
   OFFICE DASHBOARD — DEMO FIXTURES AND TRANSPORT
   Loaded by office.html, but only does anything when the page is opened with
   ?demo=1. It lets the dashboard be reviewed locally with no sign-in and no
   network at all: window.DEMO.call() answers the same RPC names the real
   transport uses, from the fixtures below.

   Nothing here touches Supabase, n8n, storage or authentication. Every record
   is obviously fake and every total shown in the UI is computed from these
   records — no total is written down twice.

   Without ?demo=1 this file defines window.DEMO and stops. Production keeps
   its real session, its real RPCs and its locked analytics page.
   ========================================================================== */
(function () {
  'use strict';

  var ON = (function () {
    try { return new URLSearchParams(location.search).get('demo') === '1'; }
    catch (e) { return false; }
  })();

  /* ---------- dates: everything is relative to "today" ------------------- */
  function isoDay(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayOffset(n) {
    var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d;
  }
  function at(dayN, h, m) {
    var d = dayOffset(dayN); d.setHours(h, m || 0, 0, 0); return d.toISOString();
  }
  /* The n-th most recent weekday (0 = the latest weekday on or before today).
     Field records are anchored to weekdays so the demo reads the same whichever
     day it is opened — crews do not file daily JHAs at the weekend, and the
     requirements only ask for them Monday to Friday. */
  function weekday(n) {
    var d = new Date(); d.setHours(12, 0, 0, 0);
    var left = n;
    for (var i = 0; i < 21; i++) {
      var dow = d.getDay();
      if (dow >= 1 && dow <= 5) { if (left === 0) return d; left--; }
      d.setDate(d.getDate() - 1);
    }
    return d;
  }
  function wdISO(n) { return isoDay(weekday(n)); }
  function wdAt(n, h, m) {
    var d = weekday(n); d.setHours(h, m || 0, 0, 0); return d.toISOString();
  }
  function mondayISO(weeksOut) {
    var d = new Date(); d.setHours(12, 0, 0, 0);
    var dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow) + (weeksOut || 0) * 7);
    return isoDay(d);
  }

  /* ---------- jobs ------------------------------------------------------- */
  /* ---------- jobs -------------------------------------------------------
     Six active demo jobsites. Everything else is generated against these, so
     the totals on every page come from the records rather than a constant. */
  var JOBS = [
    { id: 'demo-job-a', name: 'Demo Job A — Level 2 Fit-out', job_number: 'DEMO-A', status: 'active', company: 'greiner' },
    { id: 'demo-job-b', name: 'Demo Job B — Central Plant',   job_number: 'DEMO-B', status: 'active', company: 'greiner' },
    { id: 'demo-job-c', name: 'Demo Job C — Service',         job_number: 'DEMO-C', status: 'active', company: 'greiner' },
    { id: 'demo-job-d', name: 'Demo Job D — Clinic Addition', job_number: 'DEMO-D', status: 'active', company: 'greiner' },
    { id: 'demo-job-e', name: 'Demo Job E — Warehouse Reroof', job_number: 'DEMO-E', status: 'active', company: 'greiner' },
    { id: 'demo-job-f', name: 'Demo Job F — Pump Station',    job_number: 'DEMO-F', status: 'active', company: 'greiner' }
  ];

  var CREW = {
    'demo-job-a': ['Demo Foreman', 'Alex Rivera (Demo)', 'Jordan Blake (Demo)', 'Sam Whitfield (Demo)'],
    'demo-job-b': ['Casey Nolan (Demo)', 'Taylor Reed (Demo)', 'Morgan Ellis (Demo)'],
    'demo-job-c': ['Riley Shaw (Demo)', 'Quinn Harper (Demo)', 'Drew Baxter (Demo)'],
    'demo-job-d': ['Jamie Fontaine (Demo)', 'Reese Okafor (Demo)', 'Parker Lindqvist (Demo)'],
    'demo-job-e': ['Sky Vandermolen (Demo)', 'Devin Castellanos (Demo)'],
    'demo-job-f': ['Rowan Achterberg (Demo)', 'Emery Delacroix (Demo)', 'Sasha Whitmore (Demo)']
  };

  /* ---------- JHA fixtures ------------------------------------------------
     One JHA family per job per workday, except the two deliberate gaps below.
     A family is ONE daily JHA however many revisions it carries, which is the
     rule the dashboard applies to these records.

     Three families carry revisions so the revision views have something real:
     one revised once, one revised three times, one revised twice.            */
  var JHA_GAPS = [                      // job/day pairs with no JHA at all
    { job: 'demo-job-e', day: 2 },
    { job: 'demo-job-c', day: 4 }
  ];
  var JHA_REVISED = {                   // family key -> how many revisions
    'demo-job-b|0': 1,
    'demo-job-a|1': 3,
    'demo-job-d|3': 2
  };
  var WORK = [
    ['Overhead duct hangers, Level 2 east corridor.', ['Overhead drilling', 'Material handling'],
     ['Falling Objects', 'Elevated Load or Work'], ['Hard hats and exclusion zone', 'Tag and inspect rigging']],
    ['Chilled water pump replacement, mechanical room 1.', ['Pump removal', 'Rigging'],
     ['Elevated Load or Work', 'Potential Release of Energy Kinetic/Gravity'],
     ['Lockout/tagout before break', 'Rigging plan reviewed']],
    ['Ceiling grid and light rough-in, Level 2 west.', ['Ceiling grid', 'Light fixture rough-in'],
     ['Falling Objects'], ['Hard hats', 'Ladder inspected before use']],
    ['Underground sanitary tie-in, north lot.', ['Excavation', 'Pipe setting'],
     ['Confined Spaces', 'Difficult Access'], ['Trench box in place', 'Atmospheric testing']],
    ['Roof curb demolition and patching.', ['Demolition', 'Material handling'],
     ['Falling Objects', 'Environmental Extremes'], ['Warning line and spotter', 'Hydration breaks']],
    ['Pump skid alignment and grouting.', ['Alignment', 'Grouting'],
     ['Potential Release of Energy Kinetic/Gravity'], ['Lockout/tagout before break']]
  ];

  /* Each version's answers in the same field shape the phone stores, so the
     office renders them through the shared JHA model (jha-model.js) exactly
     as the phone review and the PDF do. */
  function jhaData(job, crew, day, desc, tasks, hazards, actions, ladder, ji, legacy, r) {
    var d = { jhaProjectName: job.name, jhaDescriptionOfWork: desc, jhaDate: wdISO(day),
      jhaStartTime: '07:00', jhaCompleteTime: '15:30', jhaLocation: job.name + ' (' + job.job_number + ')',
      jhaAnalysisBy: crew[0], jhaPmSupervisor: 'Demo Project Manager', jhaSubcontractors: 'N/A',
      jhaJobsiteSafety: 'Hard hat, safety glasses, gloves. Housekeeping at every break.' };
    tasks.forEach(function (t, i) {
      d['jhaTask' + (i + 1)] = t;
      d['jhaHazard' + (i + 1)] = hazards[i] || hazards[0];
      d['jhaAction' + (i + 1)] = actions[i] || actions[0];
    });
    d.jhaLadderUse = ladder;
    if (ladder === 'yes') {
      // Tony, Oct 9: who will inspect the ladders prior to use, picked from the
      // crew list, and when that pick was made.
      d.jhaLadderInspectors = crew.slice(1, 2).length ? crew.slice(1, 2) : crew.slice(0, 1);
      d.jhaLadderInspectorsAt = wdAt(day, 6, 50);
      // Job-assigned ladders, each with its own check (selected, never typed).
      var check = function (id, desc, today) {
        return { ladder_id: id, description: desc, last_inspected_at: wdAt(day + 1, 7, 5),
          last_inspected_by: 'Alex Rivera (Demo)', status: 'no-open-defects', status_label: 'No open defects reported',
          open_defect: null, todays_check: today ? { record_id: 'lad-insp-' + job.id + '-' + day + '-' + r + '-' + id,
            result: 'safe', at: wdAt(day, 7, 20), by: crew[0], by_user_id: 'demo-user-' + job.id,
            attestation_version: 'ladder-safe-use-v1' } : null };
      };
      d.jhaLadderIds = ['LAD-101'];
      d.jhaLadderChecks = [check('LAD-101', '8 ft fiberglass step ladder', true)];
      d.jhaLadderDefects = [];
      if (r === 4) {
        // A ladder found damaged this morning: reported, tagged Do Not Use,
        // and swapped for another assigned ladder.
        d.jhaLadderIds = ['LAD-101', 'LAD-204'];
        d.jhaLadderChecks.push(check('LAD-204', '24 ft fiberglass extension ladder', true));
        d.jhaLadderDefects = [{ record_id: 'lad-def-' + job.id + '-' + day, ladder_id: 'LAD-317',
          description: 'Cracked right side rail below the third step', reported_at: wdAt(day, 7, 12),
          reported_by: crew[0], reported_by_user_id: 'demo-user-' + job.id, has_photo: true,
          acknowledgment_version: 'ladder-do-not-use-v1' }];
      }
    }
    d.jhaAerialUse = ji % 2 === 0 ? 'yes' : 'no';
    if (d.jhaAerialUse === 'yes') d.jhaAerialInspectors = crew.slice(0, 2);
    if (legacy) {
      // Stored before Tony's Oct 1 change retired these questions. The office
      // keeps showing them for this record exactly as they were answered.
      d.jhaNewRevised = 'new';
      d.jhaLadderUse = 'yes';
      d.jhaLadderSafe = 'yes';
      d.jhaLadderWhyNotLift = 'Corridor too narrow for a scissor lift at this location.';
      d.jhaLadderObstacle1 = 'Sprinkler main';
      d.jhaLadderObstacle2 = 'Cable tray';
      delete d.jhaLadderIds; delete d.jhaLadderChecks; delete d.jhaLadderDefects;
      delete d.jhaLadderInspectors; delete d.jhaLadderInspectorsAt;   // never asked back then
    }
    return d;
  }

  var JHA = [];
  (function buildJha() {
    JOBS.forEach(function (job, ji) {
      for (var day = 0; day < 5; day++) {
        var skipped = JHA_GAPS.some(function (g) { return g.job === job.id && g.day === day; });
        if (skipped) continue;
        var root = 'jha-' + job.job_number.toLowerCase().replace('demo-', '') + '-' + day;
        var revs = JHA_REVISED[job.id + '|' + day] || 0;
        var w = WORK[ji % WORK.length];
        var crew = CREW[job.id];
        var openedAt = wdAt(day, 6, 30 + ji * 5);
        for (var r = 1; r <= revs + 1; r++) {
          var last = r === revs + 1;
          var tasksR = w[1].slice(0, r === 1 ? 1 : w[1].length);
          var hazR = w[2].slice(0, r === 1 ? 1 : w[2].length);
          var actR = w[3].slice(0, r === 1 ? 1 : w[3].length);
          var ladderR = r > 1 && r % 2 === 0 ? 'yes' : 'no';
          JHA.push({
            id: root + '-r' + r, root_jha_id: root,
            previous_revision_id: r === 1 ? null : root + '-r' + (r - 1),
            revision_number: r,
            job_id: job.id, job_name: job.name, work_date: wdISO(day),
            original_submitted_at: openedAt,
            revised_at: r === 1 ? openedAt : wdAt(day, 9 + r, 10 * r),
            submitted_by: crew[0], revised_by: r === 1 ? crew[0] : crew[Math.min(r - 1, crew.length - 1)],
            status: last ? 'submitted' : 'superseded',
            description_of_work: w[0] + (r > 1 ? ' Revision ' + (r - 1) + ' added scope.' : ''),
            employees: crew.slice(0, Math.min(2 + r, crew.length)),
            tasks: w[1].slice(0, r === 1 ? 1 : w[1].length),
            hazards: w[2].slice(0, r === 1 ? 1 : w[2].length),
            actions: w[3].slice(0, r === 1 ? 1 : w[3].length),
            ladder_use: ladderR,
            photos: r > 1 ? ['site-' + r + '.jpg'] : [],
            revision_note: r === 3 ? 'Crew moved to the west corridor after lunch.' : null,
            revision_diff: null,   // computed below from the shared JHA model
            data: jhaData(job, crew, day, w[0] + (r > 1 ? ' Revision ' + (r - 1) + ' added scope.' : ''),
                          tasksR, hazR, actR, ladderR, ji, job.id === 'demo-job-a' && day === 4, r),
            changes: r === 1 ? null : {
              tasks_added: w[1].slice(1, 2), tasks_removed: [],
              hazards_added: w[2].slice(1, 2), hazards_removed: [],
              actions_added: w[3].slice(1, 2), actions_removed: [],
              employees_added: crew.slice(Math.min(1 + r, crew.length - 1), Math.min(2 + r, crew.length)),
              employees_removed: [], ladder_changed: r % 2 === 0, photos_added: 1
            }
          });
        }
      }
    });
  })();

  /* Each revision's field-level difference from the version before it, the
     same calculation the phone stores on submit. */
  (function diffRevisions() {
    var M = (typeof window !== 'undefined' && window.JhaModel) || null;
    JHA.forEach(function (r) {
      if (r.revision_number === 1) return;
      var prev = JHA.filter(function (x) { return x.id === r.previous_revision_id; })[0];
      r.revision_diff = (M && prev) ? M.diffJhaData(prev.data, r.data,
        { employees: prev.employees, groups: [] }, { employees: r.employees, groups: [] }) : [];
    });
  })();

  /* ---------- Toolbox Talk rollout (Oct 2 meeting) -----------------------
     One talk assigned to one job; the lead's presentation record and each
     participant's own acknowledgment are separate records. Fictional names
     stand in for the real people. Nothing is sent. */
  var ROLLOUT = {
    assignment: { id: 'tbt-asg-purdue-fall-protection', job: 'Purdue Academic Building', talk: 'Fall Protection',
      lead: 'Demo Lead Foreman', observer: 'Demo Safety Manager',
      participants: ['Second Lead Foreman (Demo)', 'Alex Rivera (Demo)', 'Jordan Blake (Demo)'],
      assigned_by: 'Office (rollout configuration)' },
    lead_presentation: { kind: 'lead_presentation', at: wdAt(0, 6, 52), lead: 'Demo Lead Foreman',
      present: ['Second Lead Foreman (Demo)', 'Alex Rivera (Demo)', 'Jordan Blake (Demo)'], manual: [],
      presented: true, engagement_seconds: 14 * 60 + 10 },
    acknowledgments: [
      { kind: 'participant_ack', employee: 'Second Lead Foreman (Demo)', at: wdAt(0, 6, 55), format: 'guided',
        engagement_seconds: 12 * 60 + 40 },
      { kind: 'participant_ack', employee: 'Alex Rivera (Demo)', at: wdAt(0, 6, 56), format: 'doc',
        engagement_seconds: 47 }
    ]
  };

  /* ---------- other field submissions ------------------------------------ */
  var OTHER_SUBS = [];
  (function buildOther() {
    function add(id, type, title, job, who, day, h, m, defects, asset) {
      var j = JOBS.filter(function (x) { return x.id === job; })[0];
      OTHER_SUBS.push({ id: id, form_type: type, form_title: title,
        job_id: job, job_name: j.name, inspector_name: who,
        submitted_at: wdAt(day, h, m), has_defects: !!defects,
        defect_count: defects || 0, asset_id: asset || null });
    }
    // Hot work: activity-based, so only on the days it actually happened.
    add('hw-1', 'hotwork', 'Hot Work Permit', 'demo-job-b', 'Morgan Ellis (Demo)', 0, 11, 30, 0);
    add('hw-2', 'hotwork', 'Hot Work Permit', 'demo-job-a', 'Demo Foreman', 1, 8, 5, 1);
    add('hw-3', 'hotwork', 'Hot Work Permit', 'demo-job-b', 'Casey Nolan (Demo)', 1, 13, 10, 0);
    add('hw-4', 'hotwork', 'Hot Work Permit', 'demo-job-f', 'Rowan Achterberg (Demo)', 2, 9, 40, 0);
    add('hw-5', 'hotwork', 'Hot Work Permit', 'demo-job-e', 'Sky Vandermolen (Demo)', 3, 10, 15, 0);
    add('hw-6', 'hotwork', 'Hot Work Permit', 'demo-job-b', 'Morgan Ellis (Demo)', 4, 7, 55, 0);
    // Aerial lifts: per unit, on days used.
    add('al-1', 'aerial', 'Aerial Lift Inspection', 'demo-job-a', 'Alex Rivera (Demo)', 0, 6, 50, 0, 'DEMO-SL-1930-01');
    add('al-2', 'aerial', 'Aerial Lift Inspection', 'demo-job-a', 'Jordan Blake (Demo)', 1, 6, 45, 2, 'DEMO-SL-1930-02');
    add('al-3', 'aerial', 'Aerial Lift Inspection', 'demo-job-a', 'Alex Rivera (Demo)', 2, 6, 48, 0, 'DEMO-SL-1930-01');
    add('al-4', 'aerial', 'Aerial Lift Inspection', 'demo-job-a', 'Jordan Blake (Demo)', 3, 6, 52, 0, 'DEMO-SL-1930-02');
    add('al-5', 'aerial', 'Aerial Lift Inspection', 'demo-job-a', 'Alex Rivera (Demo)', 4, 6, 47, 0, 'DEMO-SL-1930-01');
    add('al-6', 'aerial', 'Aerial Lift Inspection', 'demo-job-d', 'Reese Okafor (Demo)', 1, 7, 10, 0, 'DEMO-BL-45-01');
    add('al-7', 'aerial', 'Aerial Lift Inspection', 'demo-job-d', 'Reese Okafor (Demo)', 3, 7, 12, 0, 'DEMO-BL-45-01');
    add('al-8', 'aerial', 'Aerial Lift Inspection', 'demo-job-e', 'Devin Castellanos (Demo)', 4, 7, 20, 0, 'DEMO-SL-1930-03');
    // Forklifts.
    add('fl-1', 'forklift', 'Forklift Inspection', 'demo-job-b', 'Taylor Reed (Demo)', 0, 7, 5, 0, 'DEMO-FL-05');
    add('fl-2', 'forklift', 'Forklift Inspection', 'demo-job-b', 'Taylor Reed (Demo)', 1, 7, 0, 0, 'DEMO-FL-05');
    add('fl-3', 'forklift', 'Forklift Inspection', 'demo-job-b', 'Taylor Reed (Demo)', 2, 7, 3, 0, 'DEMO-FL-05');
    add('fl-4', 'forklift', 'Forklift Inspection', 'demo-job-b', 'Taylor Reed (Demo)', 4, 7, 6, 0, 'DEMO-FL-05');
    add('fl-5', 'forklift', 'Forklift Inspection', 'demo-job-f', 'Sasha Whitmore (Demo)', 2, 7, 30, 1, 'DEMO-FL-11');
    add('fl-6', 'forklift', 'Forklift Inspection', 'demo-job-f', 'Sasha Whitmore (Demo)', 4, 7, 28, 0, 'DEMO-FL-11');
    // Job site analysis checklist: once a week per job that uses it.
    add('jsa-1', 'jobsiteanalysis', 'Job Site Analysis Checklist', 'demo-job-d', 'Jamie Fontaine (Demo)', 0, 8, 0, 0);
    add('jsa-2', 'jobsiteanalysis', 'Job Site Analysis Checklist', 'demo-job-e', 'Sky Vandermolen (Demo)', 0, 8, 20, 0);
    add('jsa-3', 'jobsiteanalysis', 'Job Site Analysis Checklist', 'demo-job-f', 'Rowan Achterberg (Demo)', 1, 8, 10, 0);
  })();

  /* ---------- corrective actions -----------------------------------------
     From inspection findings, the one corrective-action source that carries
     real records today. Three open (one of them overdue) and three closed.  */
  var FINDINGS = [
    { id: 'find-1', job_id: 'demo-job-a', sub_id: null,
      description: 'Aerial lift 1930-02 failed pre-use: horn inoperative and one guardrail pin missing.',
      corrective: 'Tag out of service, replace pin and repair horn before next use.',
      due: isoDay(dayOffset(-2)), status: 'open', imported: false,
      source: 'Aerial Lift Inspection', photos_list: [] },
    { id: 'find-2', job_id: 'demo-job-a', sub_id: null,
      description: 'Hot work on Level 2 east: fire watch left the area before the 30-minute watch ended.',
      corrective: 'Re-brief crew on fire watch duration; foreman to confirm at next hot work permit.',
      due: isoDay(dayOffset(4)), status: 'open', imported: false,
      source: 'Hot Work Permit', photos_list: [] },
    { id: 'find-3', job_id: 'demo-job-f', sub_id: null,
      description: 'Forklift FL-11: seatbelt retractor sticking.',
      corrective: 'Retractor replaced; unit returned to service after re-inspection.',
      due: isoDay(dayOffset(3)), status: 'open', imported: false,
      source: 'Forklift Inspection', photos_list: [] },
    { id: 'find-4', job_id: 'demo-job-b', sub_id: null,
      description: 'Housekeeping: offcuts and banding left in the mechanical room walkway.',
      corrective: 'Area cleared and daily clean-up assigned to the plant crew.',
      due: isoDay(dayOffset(-6)), status: 'closed', imported: false,
      source: 'Safety Inspection', photos_list: [], closed: isoDay(dayOffset(-5)) },
    { id: 'find-5', job_id: 'demo-job-d', sub_id: null,
      description: 'Excavation spoil pile stored closer than two feet from the trench edge.',
      corrective: 'Spoil relocated and crew re-briefed on setback before work resumed.',
      due: isoDay(dayOffset(-4)), status: 'closed', imported: false,
      source: 'Job Site Analysis Checklist', photos_list: [], closed: isoDay(dayOffset(-4)) },
    { id: 'find-6', job_id: 'demo-job-e', sub_id: null,
      description: 'Roof warning line set short of the required six-foot offset at the north edge.',
      corrective: 'Line repositioned and re-measured by the foreman the same morning.',
      due: isoDay(dayOffset(-3)), status: 'closed', imported: false,
      source: 'Safety Inspection', photos_list: [], closed: isoDay(dayOffset(-3)) }
  ];

  /* ---------- equipment on the demo jobs ---------------------------------
     Same shape as cs_portal_equipment_inventory returns. Ladders are ordinary
     units whose type is a ladder; one unit is archived. History lives in
     EQUIPMENT_EVENTS, append-only, exactly as cs_equipment_events. */
  function unit(id, num, type, job, extra) {
    return Object.assign({ id: id, unit_number: num, equipment_type: type, description: null, make: null,
      model: null, serial: null, year: null, source: 'Demo', job_id: job, active: true, archived_at: null,
      qr_slug: null }, extra || {});
  }
  var EQUIPMENT = [
    unit('demo-eq-1', 'DEMO-SL-1930-01', 'Scissor lift', 'demo-job-a', { description: '19 ft electric scissor lift', make: 'Genie', model: 'GS-1930' }),
    unit('demo-eq-2', 'DEMO-SL-1930-02', 'Scissor lift', 'demo-job-a', { description: '19 ft electric scissor lift', make: 'Genie', model: 'GS-1930' }),
    unit('demo-eq-3', 'DEMO-BL-45-01', 'Boom lift', 'demo-job-d', { description: '45 ft articulating boom' }),
    unit('demo-eq-4', 'DEMO-SL-1930-03', 'Scissor lift', 'demo-job-e', { description: '19 ft electric scissor lift' }),
    unit('demo-eq-5', 'DEMO-FL-05', 'Forklift', 'demo-job-b', { description: 'Warehouse forklift' }),
    unit('demo-eq-6', 'DEMO-FL-11', 'Forklift', 'demo-job-f', { description: 'Rough terrain forklift' }),
    unit('demo-eq-7', 'DEMO-LAD-101', 'Ladder', 'demo-job-a', { description: '8 ft fiberglass step ladder' }),
    unit('demo-eq-8', 'DEMO-LAD-204', 'Ladder', 'demo-job-a', { description: '24 ft fiberglass extension ladder' }),
    unit('demo-eq-9', 'DEMO-LAD-317', 'Ladder', 'demo-job-b', { description: '10 ft fiberglass step ladder' }),
    unit('demo-eq-10', 'DEMO-LAD-120', 'Ladder', null, { description: '6 ft platform ladder' }),
    unit('demo-eq-11', 'DEMO-SL-1930-04', 'Scissor lift', null, { description: 'Returned rental', source: 'Demo rental',
      active: false, archived_at: wdAt(1, 15, 0) })
  ];
  var EQUIPMENT_EVENTS = [];
  function eqEvent(id, kind, extra) {
    var ev = Object.assign({ id: 'demo-ev-' + (EQUIPMENT_EVENTS.length + 1), equipment_id: id, kind: kind,
      from_job_id: null, to_job_id: null, by: 'Demo Office', data: {}, at: new Date().toISOString() }, extra || {});
    EQUIPMENT_EVENTS.push(ev);
    return ev;
  }
  EQUIPMENT.forEach(function (e) {
    eqEvent(e.id, 'created', { at: wdAt(5, 7, 0), data: { unit_number: e.unit_number, equipment_type: e.equipment_type } });
    if (e.job_id) eqEvent(e.id, 'assigned', { at: wdAt(5, 7, 1), to_job_id: e.job_id });
  });
  eqEvent('demo-eq-11', 'archived', { at: wdAt(1, 15, 0), from_job_id: 'demo-job-c' });
  eqEvent('demo-eq-7', 'inspection_safe', { at: wdAt(0, 7, 5), by: 'Alex Rivera (Demo)', to_job_id: 'demo-job-a',
    data: { attestation_version: 'ladder-safe-use-v1' } });
  eqEvent('demo-eq-9', 'defect_reported', { at: wdAt(0, 6, 50), by: 'Taylor Reed (Demo)', to_job_id: 'demo-job-b',
    data: { description: 'Cracked right side rail below the third step', tagged_do_not_use: true,
      acknowledgment_version: 'ladder-do-not-use-v1', resolved_at: null } });

  /* ---------- field users and their per-job form access --------------------
     This is the assignment system the Jobs tab already owns: which field-login
     user may open which form on which job (cs_portal_job_field_users /
     cs_portal_user_forms_set). The dashboard derives "what is required" from
     these records — there is no second list of requirements anywhere.

     form_keys null = every default form; [] = none; [..] = that subset.      */
  var FIELD_USERS = [
    { id: 'fu-1', name: 'Demo Foreman', title: 'Foreman', job_id: 'demo-job-a',
      form_keys: ['jha', 'hotwork', 'aerial'] },
    { id: 'fu-2', name: 'Alex Rivera (Demo)', title: 'Lead', job_id: 'demo-job-a',
      form_keys: ['jha', 'aerial'] },
    { id: 'fu-3', name: 'Casey Nolan (Demo)', title: 'Foreman', job_id: 'demo-job-b',
      form_keys: ['jha', 'hotwork', 'forklift'] },
    { id: 'fu-4', name: 'Taylor Reed (Demo)', title: 'Operator', job_id: 'demo-job-b',
      form_keys: ['jha', 'forklift'] },
    { id: 'fu-5', name: 'Riley Shaw (Demo)', title: 'Foreman', job_id: 'demo-job-c',
      form_keys: ['jha'] },
    { id: 'fu-6', name: 'Jamie Fontaine (Demo)', title: 'Foreman', job_id: 'demo-job-d',
      form_keys: ['jha', 'aerial', 'jobsiteanalysis'] },
    { id: 'fu-7', name: 'Sky Vandermolen (Demo)', title: 'Foreman', job_id: 'demo-job-e',
      form_keys: ['jha', 'hotwork', 'jobsiteanalysis'] },
    { id: 'fu-8', name: 'Rowan Achterberg (Demo)', title: 'Foreman', job_id: 'demo-job-f',
      form_keys: ['jha', 'hotwork', 'forklift', 'jobsiteanalysis'] }
  ];

  /* ---------- incidents and near misses -----------------------------------
     Deliberately empty. Greiner has an incident workflow — schema, intake
     form, witnesses, documents and corrective actions all exist — but there
     have been no submissions, so there are no records. Nothing is invented;
     the dashboard renders a zero-data state instead.                        */
  var INCIDENTS = [];
  var NEAR_MISSES = [];
  var INCIDENT_BASELINE = {
    last_recordable: null, last_lost_time: null, recordkeeping_start: null
  };

  /* ---------- Toolbox Talk completions ------------------------------------
     Week keys are this week's Monday, so the demo always looks current.

     Choice keeps the single Monday morning meeting it actually runs — a second
     Choice group is not invented here. The completed-and-outstanding pair the
     completion view needs comes from Greiner, whose jobs are all demo data.

     Peine is individual: four completed, eight outstanding. One Peine record
     is deliberately duplicated to prove the same employee is not counted twice.
     ---------------------------------------------------------------------- */
  var WEEK = mondayISO(0);
  var TALK_ID = null;   // filled in by the office page from its own library

  /* Greiner: 11 of its 12 crews submitted this week. Shop & Yard has not,
     which is the single outstanding group. Two crews recorded a manual
     attendee who is not on the assigned roster.

     Choice ran its single confirmed Monday meeting. Peine is individual:
     11 of 12 employees completed, and one record is deliberately duplicated
     to prove the same person is never counted twice. */
  var GREINER_CREWS = [
    ['Demo Job A \u2014 Level 2 Fit-out \u00b7 Crew 1', 'Demo Foreman',
      ['Demo Foreman', 'Alex Rivera (Demo)', 'Jordan Blake (Demo)', 'Sam Whitfield (Demo)'],
      ['Temp Helper (Labor Ready)']],
    ['Demo Job A \u2014 Level 2 Fit-out \u00b7 Crew 2', 'Nico Vasquez (Demo)',
      ['Nico Vasquez (Demo)', 'Priya Raman (Demo)', 'Tomas Berg (Demo)'], []],
    ['Demo Job B \u2014 Central Plant \u00b7 Mechanical', 'Casey Nolan (Demo)',
      ['Casey Nolan (Demo)', 'Taylor Reed (Demo)', 'Morgan Ellis (Demo)'], []],
    ['Demo Job B \u2014 Central Plant \u00b7 Controls', 'Hana Okamoto (Demo)',
      ['Hana Okamoto (Demo)', 'Luis Ferreira (Demo)'], []],
    ['Demo Job C \u2014 Service \u00b7 North', 'Riley Shaw (Demo)',
      ['Riley Shaw (Demo)', 'Quinn Harper (Demo)'], []],
    ['Demo Job C \u2014 Service \u00b7 South', 'Drew Baxter (Demo)',
      ['Drew Baxter (Demo)', 'Marta Kowalski (Demo)'], []],
    ['Demo Job D \u2014 Clinic Addition \u00b7 Crew 1', 'Jamie Fontaine (Demo)',
      ['Jamie Fontaine (Demo)', 'Reese Okafor (Demo)', 'Parker Lindqvist (Demo)'], []],
    ['Demo Job D \u2014 Clinic Addition \u00b7 Underground', 'Obi Adeyemi (Demo)',
      ['Obi Adeyemi (Demo)', 'Lena Brandt (Demo)'], ['Visiting Engineer (Demo)']],
    ['Demo Job E \u2014 Warehouse Reroof \u00b7 Roofing', 'Sky Vandermolen (Demo)',
      ['Sky Vandermolen (Demo)', 'Devin Castellanos (Demo)', 'Ari Solberg (Demo)'], []],
    ['Demo Job F \u2014 Pump Station \u00b7 Process', 'Rowan Achterberg (Demo)',
      ['Rowan Achterberg (Demo)', 'Emery Delacroix (Demo)'], []],
    ['Demo Job F \u2014 Pump Station \u00b7 Electrical', 'Sasha Whitmore (Demo)',
      ['Sasha Whitmore (Demo)', 'Kai Nakamura (Demo)'], []]
    // 'Shop & Yard' intentionally absent: the one outstanding crew.
  ];

  /* These must match Peine's roster in office.js exactly, or a completion
     would belong to nobody. Lennox Ayers is deliberately absent: the single
     outstanding individual. */
  var PEINE_NAMES = ['Avery Nolan (Demo)', 'Bailey Cruz (Demo)', 'Cameron Diaz-Lee (Demo)',
    'Devon Marsh (Demo)', 'Emerson Pike (Demo)', 'Finley Ward (Demo)', 'Gray Hollis (Demo)',
    'Harper Vance (Demo)', 'Indigo Reese (Demo)', 'Jules Barrett (Demo)', 'Kai Lindstrom (Demo)'];

  var COMPLETIONS = {
    greiner: GREINER_CREWS.map(function (c, i) {
      return { week: WEEK, kind: 'group', company: 'greiner', group: c[0], presenter: c[1],
               roster: c[2].slice(), manual: c[3].slice(), at: wdAt(0, 6, 10 + i * 3) };
    }),
    choice: [
      { week: WEEK, kind: 'group', company: 'choice', group: 'Monday Group Meeting',
        presenter: 'Ainsley Frost (Demo)', at: wdAt(0, 7, 5),
        roster: ['Ainsley Frost (Demo)', 'Adrian Gable (Demo)', 'Zane Fairlie (Demo)', 'Bailey Dunmore (Demo)', 'Callum Merrick (Demo)',
                 'Corey "T" Hale (Demo)', 'Dorian Whitfield (Demo)', 'Jesse Marlow (Demo)', 'Jonah Welles (Demo)',
                 'Jordan Rowe (Demo)', 'Kelsey Pratt (Demo)'],
        manual: ['Temp Helper (Labor Ready)'] }
    ],
    peine: PEINE_NAMES.map(function (n, i) {
      return { week: WEEK, kind: 'individual', company: 'peine', employee: n, at: wdAt(0, 6, 40 + i * 4) };
    }).concat([
      // Same employee again, same week: must NOT be counted twice.
      { week: WEEK, kind: 'individual', company: 'peine', employee: 'Avery Nolan (Demo)', at: wdAt(0, 9, 30) }
    ])
  };

  /* ---------- the transport ---------------------------------------------- */
  var BUNDLE = {
    company: { name: 'Greiner Brothers (Demo Data)' },
    jobs: JOBS,
    workers: [],
    reports: [], certs: [], stats: [], docs: [], subs: [], permits: [],
    permit_types: [], permit_checklists: [],
    near_misses: NEAR_MISSES, incidents: INCIDENTS,
    talks: [], templates: [], people: [], invites: [], talk_sends: [],
    permit_sends: [], doc_folders: [], hazcats: [], reg_visits: [], schedules: [],
    send_log: [], equipment: EQUIPMENT, talk_templates: [], job_orientations: [],
    orientation_sends: [], worker_pdfs: [], internal_crew: [], findings: FINDINGS,
    cjsc: null, scorecard: [], gc_templates: []
  };

  // Field submissions in the shape cs_portal_field_inspections returns. JHAs
  // are included so the Inspections page still lists them; the office JHA view
  // reads the richer DEMO.jha records for revision detail.
  var FIELD = JHA.map(function (j) {
    return { id: j.id, form_type: 'jha', form_title: 'Job Hazard Analysis',
             job_id: j.job_id, job_name: j.job_name, inspector_name: j.revised_by,
             submitted_at: j.revised_at, has_defects: false, defect_count: 0,
             root_jha_id: j.root_jha_id, revision_number: j.revision_number };
  }).concat(OTHER_SUBS);

  var ANSWERS = {
    cs_portal_login: function () {
      return { session: 'demo-session', role: 'full',
               expires_at: new Date(Date.now() + 86400000).toISOString() };
    },
    cs_portal_bundle: function () { return BUNDLE; },
    cs_portal_field_inspections: function () { return FIELD; },
    cs_portal_findings: function () { return FINDINGS; },
    /* The Jobs tab's own assignment RPCs, answered from FIELD_USERS so the
       shortcut and the Jobs tab read and write exactly the same records. */
    cs_portal_job_field_users: function (body) {
      return FIELD_USERS.filter(function (u) { return u.job_id === (body || {}).p_job_id; })
        .map(function (u) { return JSON.parse(JSON.stringify(u)); });
    },
    cs_portal_user_forms_set: function (body) {
      var b = body || {};
      var u = FIELD_USERS.filter(function (x) { return x.id === b.p_user_id; })[0];
      if (!u) return { ok: false, error: 'unknown user' };
      if (u.job_id !== b.p_job_id) return { ok: false, error: 'user is not on that job' };
      // Only forms the field app actually supports may be stored.
      // The older checklist JHA is no longer offered for new assignments.
      var allowed = ['hotwork', 'aerial', 'forklift', 'jha'];
      var keys = (b.p_form_keys || []).filter(function (k) { return allowed.indexOf(k) !== -1; });
      u.form_keys = keys.slice();
      return { ok: true, form_keys: u.form_keys.slice() };
    },
    cs_portal_incidents: function () { return INCIDENTS; },
    /* Equipment: the same rules as sql/2026-10-05-equipment-management.sql.
       Errors come back as { ok: false, error } exactly like the server. */
    cs_portal_equipment_inventory: function () {
      return EQUIPMENT.slice().sort(function (a, b) { return a.unit_number < b.unit_number ? -1 : 1; }).map(function (e) {
        var mine = EQUIPMENT_EVENTS.filter(function (v) { return v.equipment_id === e.id; }).reverse();
        var insp = mine.filter(function (v) { return v.kind === 'inspection_safe' || v.kind === 'defect_reported'; })[0];
        var open = mine.filter(function (v) { return v.kind === 'defect_reported' && !v.data.resolved_at; })[0];
        return Object.assign({}, e, { is_ladder: /\bladder/i.test(e.equipment_type || ''),
          last_inspection: insp ? { at: insp.at, by: insp.by, kind: insp.kind } : null,
          open_defect: open ? { at: open.at, by: open.by, description: open.data.description } : null });
      });
    },
    cs_portal_equipment_history: function (b) {
      return EQUIPMENT_EVENTS.filter(function (v) { return v.equipment_id === (b || {}).p_equipment_id; }).slice().reverse();
    },
    cs_portal_equipment_add: function (b) {
      b = b || {};
      var num = String(b.p_unit_number || '').trim().toUpperCase(), type = String(b.p_equipment_type || '').trim();
      if (!num) return { ok: false, error: 'unit_required' };
      if (!type) return { ok: false, error: 'type_required' };
      if (EQUIPMENT.some(function (e) { return e.unit_number.trim().toUpperCase() === num; })) return { ok: false, error: 'duplicate_unit' };
      if (b.p_job_id && !JOBS.some(function (j) { return j.id === b.p_job_id; })) return { ok: false, error: 'bad_job' };
      var e = unit('demo-eq-new-' + (EQUIPMENT.length + 1), num, type, b.p_job_id || null,
        { description: b.p_description || null, make: b.p_make || null, model: b.p_model || null,
          serial: b.p_serial || null, year: b.p_year || null, source: b.p_source || null });
      EQUIPMENT.push(e);
      eqEvent(e.id, 'created', { data: { unit_number: num, equipment_type: type } });
      if (e.job_id) eqEvent(e.id, 'assigned', { to_job_id: e.job_id });
      return { ok: true, id: e.id, unit_number: num };
    },
    cs_portal_equipment_update: function (b) {
      b = b || {};
      var e = EQUIPMENT.filter(function (x) { return x.id === b.p_equipment_id; })[0];
      if (!e) return { ok: false, error: 'not_found' };
      var num = b.p_unit_number == null ? e.unit_number : String(b.p_unit_number).trim().toUpperCase();
      if (!num) return { ok: false, error: 'unit_required' };
      if (EQUIPMENT.some(function (x) { return x.id !== e.id && x.unit_number.trim().toUpperCase() === num; })) return { ok: false, error: 'duplicate_unit' };
      if (b.p_equipment_type != null && !String(b.p_equipment_type).trim()) return { ok: false, error: 'type_required' };
      var changed = {};
      e.unit_number = num;
      ['equipment_type', 'description', 'make', 'model', 'serial', 'year', 'source'].forEach(function (k) {
        var v = b['p_' + k]; if (v == null) return;
        v = String(v).trim(); changed[k] = v;
        e[k] = v || (k === 'equipment_type' ? e[k] : null);
      });
      eqEvent(e.id, 'updated', { data: changed });
      return { ok: true, id: e.id, unit_number: num };
    },
    cs_portal_equipment_set_job: function (b) {
      b = b || {};
      var to = b.p_job_id || null;
      if (to && !JOBS.some(function (j) { return j.id === to; })) return { ok: false, error: 'bad_job' };
      var e = EQUIPMENT.filter(function (x) { return x.id === b.p_equipment_id; })[0];
      if (!e) return { ok: false, error: 'not_found' };
      if (e.archived_at) return { ok: false, error: 'archived' };
      if ((e.job_id || null) === to) return { ok: true, id: e.id, job_id: to, unchanged: true };
      var from = e.job_id || null; e.job_id = to;
      eqEvent(e.id, !to ? 'unassigned' : !from ? 'assigned' : 'reassigned', { from_job_id: from, to_job_id: to });
      return { ok: true, id: e.id, job_id: to };
    },
    cs_portal_equipment_archive: function (b) {
      b = b || {};
      var e = EQUIPMENT.filter(function (x) { return x.id === b.p_equipment_id; })[0];
      if (!e) return { ok: false, error: 'not_found' };
      var archive = b.p_archived !== false;
      if (archive === !!e.archived_at) return { ok: true, unchanged: true };
      if (archive) {
        eqEvent(e.id, 'archived', { from_job_id: e.job_id || null });
        e.archived_at = new Date().toISOString(); e.active = false; e.job_id = null;
      } else {
        e.archived_at = null; e.active = true;
        eqEvent(e.id, 'restored');
      }
      return { ok: true, id: e.id, archived: archive };
    },
    /* The office drawer's lazy "full record" fetch. Same document shape the
       phone stores in fields.doc. */
    cs_portal_field_doc: function (body) { return { doc: fieldDoc((body || {}).p_id) }; }
  };

  function docItem(label, response, flagged) {
    return { label: label, response: response, type: 'text', notes: '', flagged: !!flagged, photos: [] };
  }
  function fieldDoc(id) {
    var jha = JHA.filter(function (j) { return j.id === id; })[0];
    if (jha) {
      if (!window.JhaModel) return null;
      return { title: 'Job Hazard Analysis', subtype: 'jha',
        sections: window.JhaModel.jhaSections(jha.data, { crew: { employees: jha.employees, groups: [] } })
          .map(function (sec) {
            return { title: sec.title, items: sec.items.map(function (it) { return docItem(it.label, it.value, it.flagged); }) };
          }) };
    }
    var sub = OTHER_SUBS.filter(function (x) { return x.id === id; })[0];
    if (!sub) return null;
    if (sub.form_type === 'hotwork') {
      return { title: 'Hot Work Permit', subtype: 'hot_work_permit', sections: [
        { title: 'Details', items: [
          docItem('Date', isoDay(new Date(sub.submitted_at))), docItem('Job No.', sub.job_name),
          docItem('Building / General Location', 'Mechanical room 1'), docItem('Specific Area / Room', 'Pump bay'),
          docItem('Type of Hot Work Being Performed', 'Welding'),
          docItem('Description of Work Being Performed', 'Weld pipe supports for the replacement pump header.'),
          docItem('Name of Person Doing Hot Work', sub.inspector_name)] },
        { title: 'Fire watch / hot work area monitoring', items: [
          docItem('Fire watch provided during and for 60 minutes after work including breaks', 'Checked'),
          docItem('Fire watch supplied with extinguisher and/or water pump can', 'Checked')] }
      ] };
    }
    if (sub.form_type === 'forklift') {
      var bad = sub.has_defects;
      return { title: 'Forklift Inspection', subtype: 'forklift', sections: [
        { title: 'Inspection Checklist', items: [
          docItem('Horn', 'safe'), docItem('Service Brakes (Report Immediately)', 'safe'),
          docItem('Hydraulic Leaks', bad ? 'defect' : 'safe', bad),
          docItem('Overhead Guard', 'safe'),
          docItem("Manufacturer Operator's Manual Present and Readable", 'Yes')] }
      ] };
    }
    return null;
  }

  window.DEMO = {
    on: ON,
    week: WEEK,
    jobs: JOBS,
    jha: JHA,
    other: OTHER_SUBS,
    findings: FINDINGS,
    equipment: EQUIPMENT,
    equipmentEvents: EQUIPMENT_EVENTS,
    fieldUsers: FIELD_USERS,
    incidents: INCIDENTS,
    nearMisses: NEAR_MISSES,
    baseline: INCIDENT_BASELINE,
    completions: COMPLETIONS,
    rollout: ROLLOUT,
    field: FIELD,
    isoDay: isoDay,
    dayOffset: dayOffset,
    mondayISO: mondayISO,
    session: { session: 'demo-session', role: 'full',
               expires_at: new Date(Date.now() + 86400000).toISOString() },
    /* Every RPC the dashboard makes is answered from the fixtures above.
       Nothing leaves the browser. An unknown RPC resolves empty rather than
       throwing, so a page that asks for something the demo has not modelled
       renders empty instead of breaking the review. */
    call: function (fn, body) {
      var f = ANSWERS[fn];
      var out = f ? f(body) : [];
      return Promise.resolve(JSON.parse(JSON.stringify(out)));
    },
    /* Which talk the completions belong to. The office page owns the library,
       so it stamps the current talk id in once it knows it. */
    setTalkId: function (id) {
      if (TALK_ID === id) return;
      TALK_ID = id;
      Object.keys(COMPLETIONS).forEach(function (co) {
        COMPLETIONS[co].forEach(function (c) { c.talkId = id; });
      });
    },
    talkId: function () { return TALK_ID; }
  };
})();
