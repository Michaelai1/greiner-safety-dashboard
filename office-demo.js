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
  function mondayISO(weeksOut) {
    var d = new Date(); d.setHours(12, 0, 0, 0);
    var dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow) + (weeksOut || 0) * 7);
    return isoDay(d);
  }

  /* ---------- jobs ------------------------------------------------------- */
  var JOBS = [
    { id: 'demo-job-a', name: 'Demo Job A — Level 2 Fit-out', job_number: 'DEMO-A',
      status: 'active', company: 'greiner' },
    { id: 'demo-job-b', name: 'Demo Job B — Central Plant', job_number: 'DEMO-B',
      status: 'active', company: 'greiner' },
    { id: 'demo-job-c', name: 'Demo Job C — Service', job_number: 'DEMO-C',
      status: 'active', company: 'greiner' }
  ];

  /* ---------- JHA fixtures ------------------------------------------------
     Three JHA families, each an original plus its revisions. A family is ONE
     daily JHA no matter how many revisions it carries — that rule is applied
     in the dashboard, and these records are what it is applied to.

       jha-1  original only            (Demo Job A, today)
       jha-2  original + 1 revision    (Demo Job B, today)
       jha-3  original + 3 revisions   (Demo Job A, yesterday)

     changes[] records what actually differed between one revision and the one
     before it. Where the demo cannot support a real field comparison the entry
     is omitted and the office labels it unavailable rather than inventing one.
     ---------------------------------------------------------------------- */
  var JHA = [
    /* ---- family 1: never revised ---- */
    { id: 'jha-1-r1', root_jha_id: 'jha-1', previous_revision_id: null, revision_number: 1,
      job_id: 'demo-job-a', job_name: 'Demo Job A — Level 2 Fit-out', work_date: isoDay(dayOffset(0)),
      original_submitted_at: at(0, 6, 40), revised_at: at(0, 6, 40),
      submitted_by: 'Demo Foreman', revised_by: 'Demo Foreman', status: 'submitted',
      description_of_work: 'Overhead duct hangers, Level 2 east corridor.',
      employees: ['Demo Foreman', 'Alex Rivera (Demo)', 'Jordan Blake (Demo)'],
      tasks: ['Overhead drilling', 'Material handling'],
      hazards: ['Falling Objects', 'Elevated Load or Work'],
      actions: ['Hard hats and exclusion zone', 'Tag and inspect rigging'],
      ladder_use: 'yes', photos: ['duct-hanger-layout.jpg'], changes: null },

    /* ---- family 2: revised once ---- */
    { id: 'jha-2-r1', root_jha_id: 'jha-2', previous_revision_id: null, revision_number: 1,
      job_id: 'demo-job-b', job_name: 'Demo Job B — Central Plant', work_date: isoDay(dayOffset(0)),
      original_submitted_at: at(0, 6, 55), revised_at: at(0, 6, 55),
      submitted_by: 'Casey Nolan (Demo)', revised_by: 'Casey Nolan (Demo)', status: 'superseded',
      description_of_work: 'Chilled water pump replacement, mechanical room 1.',
      employees: ['Casey Nolan (Demo)', 'Taylor Reed (Demo)'],
      tasks: ['Pump removal', 'Rigging'],
      hazards: ['Elevated Load or Work', 'Potential Release of Energy Kinetic/Gravity'],
      actions: ['Lockout/tagout before break', 'Rigging plan reviewed'],
      ladder_use: 'no', photos: [], changes: null },
    { id: 'jha-2-r2', root_jha_id: 'jha-2', previous_revision_id: 'jha-2-r1', revision_number: 2,
      job_id: 'demo-job-b', job_name: 'Demo Job B — Central Plant', work_date: isoDay(dayOffset(0)),
      original_submitted_at: at(0, 6, 55), revised_at: at(0, 11, 20),
      submitted_by: 'Casey Nolan (Demo)', revised_by: 'Morgan Ellis (Demo)', status: 'submitted',
      description_of_work: 'Chilled water pump replacement, mechanical room 1. Added hot work for bracket removal.',
      employees: ['Casey Nolan (Demo)', 'Taylor Reed (Demo)', 'Morgan Ellis (Demo)'],
      tasks: ['Pump removal', 'Rigging', 'Cutting / grinding'],
      hazards: ['Elevated Load or Work', 'Potential Release of Energy Kinetic/Gravity', 'Fire / Hot Work'],
      actions: ['Lockout/tagout before break', 'Rigging plan reviewed', 'Fire watch and extinguisher on site'],
      ladder_use: 'no', photos: ['bracket-cut-location.jpg'],
      changes: { tasks_added: ['Cutting / grinding'], tasks_removed: [],
                 hazards_added: ['Fire / Hot Work'], hazards_removed: [],
                 actions_added: ['Fire watch and extinguisher on site'], actions_removed: [],
                 employees_added: ['Morgan Ellis (Demo)'], employees_removed: [],
                 ladder_changed: false, photos_added: 1 } },

    /* ---- family 3: revised three times ---- */
    { id: 'jha-3-r1', root_jha_id: 'jha-3', previous_revision_id: null, revision_number: 1,
      job_id: 'demo-job-a', job_name: 'Demo Job A — Level 2 Fit-out', work_date: isoDay(dayOffset(-1)),
      original_submitted_at: at(-1, 6, 30), revised_at: at(-1, 6, 30),
      submitted_by: 'Demo Foreman', revised_by: 'Demo Foreman', status: 'superseded',
      description_of_work: 'Ceiling grid and light rough-in, Level 2 west.',
      employees: ['Demo Foreman', 'Sam Whitfield (Demo)'],
      tasks: ['Ceiling grid'], hazards: ['Falling Objects'],
      actions: ['Hard hats'], ladder_use: 'no', photos: [], changes: null },
    { id: 'jha-3-r2', root_jha_id: 'jha-3', previous_revision_id: 'jha-3-r1', revision_number: 2,
      job_id: 'demo-job-a', job_name: 'Demo Job A — Level 2 Fit-out', work_date: isoDay(dayOffset(-1)),
      original_submitted_at: at(-1, 6, 30), revised_at: at(-1, 9, 15),
      submitted_by: 'Demo Foreman', revised_by: 'Demo Foreman', status: 'superseded',
      description_of_work: 'Ceiling grid and light rough-in, Level 2 west. Ladder work added.',
      employees: ['Demo Foreman', 'Sam Whitfield (Demo)'],
      tasks: ['Ceiling grid', 'Light fixture rough-in'],
      hazards: ['Falling Objects', 'Elevated Load or Work'],
      actions: ['Hard hats', 'Ladder inspected before use'],
      ladder_use: 'yes', photos: ['grid-layout.jpg'],
      changes: { tasks_added: ['Light fixture rough-in'], tasks_removed: [],
                 hazards_added: ['Elevated Load or Work'], hazards_removed: [],
                 actions_added: ['Ladder inspected before use'], actions_removed: [],
                 employees_added: [], employees_removed: [],
                 ladder_changed: true, photos_added: 1 } },
    { id: 'jha-3-r3', root_jha_id: 'jha-3', previous_revision_id: 'jha-3-r2', revision_number: 3,
      job_id: 'demo-job-a', job_name: 'Demo Job A — Level 2 Fit-out', work_date: isoDay(dayOffset(-1)),
      original_submitted_at: at(-1, 6, 30), revised_at: at(-1, 12, 5),
      submitted_by: 'Demo Foreman', revised_by: 'Alex Rivera (Demo)', status: 'superseded',
      description_of_work: 'Ceiling grid and light rough-in, Level 2 west. Ladder work added. Second crew joined.',
      employees: ['Demo Foreman', 'Sam Whitfield (Demo)', 'Jordan Blake (Demo)', 'Alex Rivera (Demo)'],
      tasks: ['Ceiling grid', 'Light fixture rough-in'],
      hazards: ['Falling Objects', 'Elevated Load or Work'],
      actions: ['Hard hats', 'Ladder inspected before use'],
      ladder_use: 'yes', photos: ['grid-layout.jpg'],
      changes: { tasks_added: [], tasks_removed: [],
                 hazards_added: [], hazards_removed: [],
                 actions_added: [], actions_removed: [],
                 employees_added: ['Jordan Blake (Demo)', 'Alex Rivera (Demo)'], employees_removed: [],
                 ladder_changed: false, photos_added: 0 } },
    { id: 'jha-3-r4', root_jha_id: 'jha-3', previous_revision_id: 'jha-3-r3', revision_number: 4,
      job_id: 'demo-job-a', job_name: 'Demo Job A — Level 2 Fit-out', work_date: isoDay(dayOffset(-1)),
      original_submitted_at: at(-1, 6, 30), revised_at: at(-1, 14, 40),
      submitted_by: 'Demo Foreman', revised_by: 'Alex Rivera (Demo)', status: 'submitted',
      description_of_work: 'Ceiling grid and light rough-in, Level 2 west. Ladder work added. Second crew joined. Scissor lift swapped in for ladder.',
      employees: ['Demo Foreman', 'Sam Whitfield (Demo)', 'Jordan Blake (Demo)', 'Alex Rivera (Demo)'],
      tasks: ['Ceiling grid', 'Light fixture rough-in'],
      hazards: ['Falling Objects', 'Elevated Load or Work'],
      actions: ['Hard hats', 'Scissor lift with harness'],
      ladder_use: 'no', photos: ['grid-layout.jpg', 'lift-setup.jpg'],
      changes: { tasks_added: [], tasks_removed: [],
                 hazards_added: [], hazards_removed: [],
                 actions_added: ['Scissor lift with harness'], actions_removed: ['Ladder inspected before use'],
                 employees_added: [], employees_removed: [],
                 ladder_changed: true, photos_added: 1 } }
  ];

  /* ---------- other field submissions ------------------------------------
     Enough non-JHA submissions that the daily compliance table has something
     other than JHAs in it. Hot Work on Job B today; Job C submitted nothing,
     which is what makes it show as missed.                                 */
  var OTHER_SUBS = [
    { id: 'hw-1', form_type: 'hotwork', form_title: 'Hot Work Permit',
      job_id: 'demo-job-b', job_name: 'Demo Job B — Central Plant',
      inspector_name: 'Morgan Ellis (Demo)', submitted_at: at(0, 11, 30),
      has_defects: false, defect_count: 0 },
    { id: 'hw-2', form_type: 'hotwork', form_title: 'Hot Work Permit',
      job_id: 'demo-job-a', job_name: 'Demo Job A — Level 2 Fit-out',
      inspector_name: 'Demo Foreman', submitted_at: at(-1, 8, 5),
      has_defects: true, defect_count: 1 }
  ];

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

  var COMPLETIONS = {
    greiner: [
      // Job A completed, with two manual attendees who are not on the roster.
      { week: WEEK, kind: 'group', company: 'greiner', group: 'Demo Job A — Level 2 Fit-out',
        presenter: 'Demo Foreman', at: at(0, 6, 15),
        roster: ['Demo Foreman', 'Alex Rivera (Demo)', 'Jordan Blake (Demo)', 'Sam Whitfield (Demo)'],
        manual: ['Temp Helper (Labor Ready)', 'Visiting Engineer (Demo)'] },
      // Job B completed, roster only.
      { week: WEEK, kind: 'group', company: 'greiner', group: 'Demo Job B — Central Plant',
        presenter: 'Casey Nolan (Demo)', at: at(0, 6, 25),
        roster: ['Casey Nolan (Demo)', 'Taylor Reed (Demo)', 'Morgan Ellis (Demo)'], manual: [] }
      // Job C submitted nothing: it is the outstanding group.
    ],
    choice: [
      { week: WEEK, kind: 'group', company: 'choice', group: 'Monday Group Meeting',
        presenter: 'Alex Fyffe', at: at(0, 7, 5),
        roster: ['Alex Fyffe', 'Angel Garcia', 'Zach France', 'Bobby Douthit', 'Cian McGarr',
                 'Cenon "T" Heim', 'Darvelle White', 'Joe Mikalouski', 'Jon Wennen',
                 'Justin Rice', 'Kyle Palmer'],
        manual: ['Temp Helper (Labor Ready)'] }
    ],
    peine: [
      { week: WEEK, kind: 'individual', company: 'peine', employee: 'Avery Nolan (Demo)', at: at(0, 6, 50) },
      { week: WEEK, kind: 'individual', company: 'peine', employee: 'Bailey Cruz (Demo)', at: at(0, 7, 2) },
      { week: WEEK, kind: 'individual', company: 'peine', employee: 'Cameron Diaz-Lee (Demo)', at: at(0, 7, 18) },
      { week: WEEK, kind: 'individual', company: 'peine', employee: 'Devon Marsh (Demo)', at: at(0, 8, 1) },
      // Same employee again, same week: must NOT be counted twice.
      { week: WEEK, kind: 'individual', company: 'peine', employee: 'Avery Nolan (Demo)', at: at(0, 9, 30) }
    ]
  };

  /* ---------- the transport ---------------------------------------------- */
  var BUNDLE = {
    company: { name: 'Greiner Brothers (Demo Data)' },
    jobs: JOBS,
    workers: [],
    reports: [], certs: [], stats: [], docs: [], subs: [], permits: [],
    permit_types: [], permit_checklists: [], near_misses: [], incidents: [],
    talks: [], templates: [], people: [], invites: [], talk_sends: [],
    permit_sends: [], doc_folders: [], hazcats: [], reg_visits: [], schedules: [],
    send_log: [], equipment: [], talk_templates: [], job_orientations: [],
    orientation_sends: [], worker_pdfs: [], internal_crew: [], findings: [],
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
    cs_portal_findings: function () { return []; },
    cs_portal_incidents: function () { return []; }
  };

  window.DEMO = {
    on: ON,
    week: WEEK,
    jobs: JOBS,
    jha: JHA,
    other: OTHER_SUBS,
    completions: COMPLETIONS,
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
    call: function (fn) {
      var f = ANSWERS[fn];
      var out = f ? f() : [];
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
