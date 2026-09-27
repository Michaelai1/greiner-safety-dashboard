/* ============================================================================
   PEINE PHASE 1 — DEMO DATA AND RULES
   Every person, token, timestamp and document here is fictional. Nothing in
   this file reads or writes anything: no Supabase, no n8n, no network at all.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- time helpers ------------------------------------------------ */
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }
  function mondayOf(ref) {
    var d = new Date(ref || Date.now()); d.setHours(12, 0, 0, 0);
    var dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return d;
  }
  function at(baseDate, hhmm, plusDays) {
    var p = String(hhmm).split(':');
    var d = new Date(baseDate.getTime());
    d.setDate(d.getDate() + (plusDays || 0));
    d.setHours(+p[0], +p[1] || 0, 0, 0);
    return d;
  }
  function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-US',
      { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function mins(ms) {
    if (ms == null) return '—';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  }

  /* ---------- settings the office can change ------------------------------ */
  var SETTINGS = {
    sendDay: 'Monday',
    sendTime: '08:00',          // configurable initial send
    firstReminderHours: 48,     // first nudge if still incomplete
    repeatReminderHours: 24,    // then every 24h while incomplete
    digestDay: 'Monday',
    digestTime: '07:00'         // admin digest of everything still unsigned
  };

  /* ---------- people ------------------------------------------------------
     Exactly 26 fictional field employees and three fictional administrators.
     No real Peine, Greiner or Choice person appears anywhere.               */
  var FIELD = [
    'Adrian Vance', 'Bea Lindqvist', 'Cyrus Ondaatje', 'Delphine Marr',
    'Elias Thorne', 'Fiona Braddock', 'Gideon Alvarez', 'Harriet Nkemdi',
    'Isolde Farrow', 'Jonas Petrakis', 'Kenji Waverly', 'Lucia Bramante',
    'Marcus Eddington', 'Nadia Solheim', 'Oskar Vinge', 'Priya Ellsworth',
    'Quentin Rask', 'Rosalind Chu', 'Soren Halvard', 'Tamsin Okoro',
    'Ulises Cardenas', 'Vera Lindholm', 'Wendell Pryce', 'Ximena Duarte',
    'Yusuf Radcliffe', 'Zora Ivanenko'
  ].map(function (n, i) {
    return {
      id: 'fe-' + String(i + 1).padStart(2, '0'),
      name: n,
      role: 'Field employee',
      crew: ['North Crew', 'South Crew', 'Service Crew'][i % 3],
      // Fictional, local-only assignment token. Deterministic so the demo is
      // stable, but shaped like the real thing: opaque, mixed alphanumeric,
      // tied to one person and one assignment, and carrying neither a phone
      // number nor an employee id.
      token: 'demo-' + (function (seed) {
        var A = 'abcdefghjkmnpqrstuvwxyz23456789', out = '', x = seed * 2654435761 % 2147483647;
        for (var k = 0; k < 16; k++) { x = (x * 1103515245 + 12345) % 2147483647; out += A[x % A.length]; }
        return out;
      })(i + 1)
    };
  });

  var ADMINS = [
    { id: 'ad-1', name: 'Rhoda Quintrell', role: 'Safety administrator' },
    { id: 'ad-2', name: 'Bertrand Oyelaran', role: 'Operations manager' },
    { id: 'ad-3', name: 'Imelda Fanshawe', role: 'Office coordinator' }
  ];

  /* ---------- toolbox talks ----------------------------------------------
     The same documents already in the safe demo bundle. Guided sections are
     only prepared for Fall Protection.                                     */
  var TALKS = [
    { id: 'fall', title: 'Fall Protection', file: 'Fall Protection.pdf', pages: 2,
      guided: true, sections: 8,
      images: ['../assets/toolbox-talks/fall/page-01.jpg', '../assets/toolbox-talks/fall/page-02.png'] },
    { id: 'ladders', title: 'Ladders 1', file: 'Ladders 1.pdf', pages: 2, guided: false,
      images: ['../assets/toolbox-talks/ladders/page-01.jpg', '../assets/toolbox-talks/ladders/page-02.png'] },
    { id: 'exc', title: 'Excavation Safety', file: 'Excavation Safety.pdf', pages: 3, guided: false,
      images: ['../assets/toolbox-talks/exc/page-01.jpg', '../assets/toolbox-talks/exc/page-02.png',
               '../assets/toolbox-talks/exc/page-03.png'] }
  ];

  /* Scheduled weeks, most recent first when rendered. format: doc | guided | both */
  var SCHEDULE = [
    { week: 0, talkId: 'fall', format: 'both' },
    { week: 1, talkId: 'ladders', format: 'doc' },
    { week: 2, talkId: 'exc', format: 'doc' }
  ];

  /* ---------- notification + engagement fixtures --------------------------
     Timestamps are derived from this week's Monday and the settings above, so
     the demo reads correctly whenever it is opened.                          */
  var MON = mondayOf();
  var SEND = at(MON, SETTINGS.sendTime);
  var DIGEST = at(MON, SETTINGS.digestTime);

  /* Per-employee state. 20 completed, 4 outstanding, 2 overdue by design.
     "overdue" = still incomplete after the first reminder window elapsed. */
  var PATTERN = [
    // [hoursToOpen, activeMs, hoursToSubmit]  null = never
    [0.4, 214000, 0.6], [1.2, 265000, 1.6], [0.2, 188000, 0.4], [3.1, 402000, 3.5],
    [0.8, 241000, 1.1], [5.4, 173000, 5.9], [0.3, 356000, 0.9], [2.2, 198000, 2.6],
    [1.7, 287000, 2.1], [0.6, 233000, 0.8], [4.8, 311000, 5.2], [0.9, 176000, 1.2],
    [2.9, 254000, 3.3], [0.5, 199000, 0.7], [6.2, 288000, 6.8], [1.4, 221000, 1.8],
    [0.7, 342000, 1.3], [3.6, 207000, 4.0], [1.1, 263000, 1.5], [0.35, 231000, 0.55],
    [7.5, 96000, null],            // opened, read a while, never submitted
    [26.0, 41000, null],           // opened late, barely engaged
    [null, 0, null],               // never opened
    [null, 0, null],               // never opened
    [50.0, 58000, null],           // opened only after the first reminder
    [null, 0, null]                // never opened
  ];

  var ASSIGNMENTS = FIELD.map(function (p, i) {
    var pat = PATTERN[i] || [null, 0, null];
    var opened = pat[0] == null ? null : new Date(SEND.getTime() + pat[0] * 3600000);
    var submitted = pat[2] == null ? null : new Date(SEND.getTime() + pat[2] * 3600000);
    var active = pat[1] || 0;
    var lastActive = submitted || (opened ? new Date(opened.getTime() + active) : null);
    return {
      employeeId: p.id,
      token: p.token,
      talkId: SCHEDULE[0].talkId,
      week: iso(MON),
      delivered: SEND,
      opened: opened,
      lastActive: lastActive,
      submitted: submitted,
      activeMs: submitted || opened ? active : 0,
      sectionsViewed: submitted ? 8 : (opened ? Math.max(1, Math.round(active / 40000)) : 0),
      sectionsTotal: 8
    };
  });

  /* Reminders are derived from the rules, never stored as a separate list. */
  function remindersFor(a, now) {
    var out = [];
    if (a.submitted) {
      // a reminder only fires while still incomplete
      var firstDue = new Date(a.delivered.getTime() + SETTINGS.firstReminderHours * 3600000);
      if (a.submitted > firstDue) out.push(firstDue);
      return out;
    }
    var t = new Date(a.delivered.getTime() + SETTINGS.firstReminderHours * 3600000);
    var guard = 0;
    while (t <= (now || new Date()) && guard++ < 30) {
      out.push(new Date(t.getTime()));
      t = new Date(t.getTime() + SETTINGS.repeatReminderHours * 3600000);
    }
    return out;
  }
  function isOverdue(a, now) {
    if (a.submitted) return false;
    return (now || new Date()) > new Date(a.delivered.getTime() + SETTINGS.firstReminderHours * 3600000);
  }

  /* ---------- training documents -----------------------------------------
     Fictional records only. No requirement-by-role mapping exists, so no
     compliance percentage is calculated anywhere.                           */
  var CERT_TYPES = ['OSHA 10', 'OSHA 30', 'First Aid / CPR', 'Confined Space Entry',
                    'Aerial Lift Operator', 'Forklift Operator', 'Trenching Competent Person'];
  var TRAINING = [];
  FIELD.forEach(function (p, i) {
    var n = 1 + (i % 3);
    for (var k = 0; k < n; k++) {
      var type = CERT_TYPES[(i + k * 3) % CERT_TYPES.length];
      // Issued within the last two years, three-year validity, so most records
      // are comfortably current. A small deliberate slice is expiring or
      // expired so the filters have something to show.
      var issued = new Date(MON.getTime());
      issued.setFullYear(issued.getFullYear() - ((i + k) % 2));
      issued.setDate(issued.getDate() - ((i * 5 + k * 11) % 300));
      var expires = new Date(issued.getTime());
      expires.setFullYear(expires.getFullYear() + 3);
      // A small deliberate slice is expiring or already expired. The issue date
      // is pulled back with the expiry so a certificate never expires before it
      // was issued.
      var bucket = (i * 3 + k * 5) % 17;
      if (bucket === 0) {
        expires = new Date(MON.getTime() - (8 + i) * 86400000);
        issued = new Date(expires.getTime()); issued.setFullYear(issued.getFullYear() - 3);
      } else if (bucket === 1 || bucket === 2) {
        expires = new Date(MON.getTime() + (9 + i) * 86400000);
        issued = new Date(expires.getTime()); issued.setFullYear(issued.getFullYear() - 3);
      }
      TRAINING.push({
        id: 'tr-' + p.id + '-' + k,
        employeeId: p.id,
        name: type,
        issued: iso(issued),
        expires: iso(expires)
      });
    }
  });
  function certStatus(rec, now) {
    var today = now || new Date();
    var exp = new Date(rec.expires + 'T12:00:00');
    var days = Math.round((exp - today) / 86400000);
    if (days < 0) return { key: 'expired', label: 'Expired', days: days };
    if (days <= 60) return { key: 'soon', label: 'Expiring soon', days: days };
    return { key: 'current', label: 'Current', days: days };
  }

  /* ---------- pricing ----------------------------------------------------- */
  /* Company-wide document library. Separate from TRAINING, which is per-employee
     certification records. Every file here is fictional. */
  var DOCS = [
    { id: 'dc1', title: 'Employee Safety Manual',        cat: 'manual',  rev: '2026-01', pages: 64, kb: 1548 },
    { id: 'dc2', title: 'Fall Protection Policy',        cat: 'policy',  rev: '2025-11', pages: 9,  kb: 210 },
    { id: 'dc3', title: 'Hazard Communication Program',  cat: 'policy',  rev: '2025-08', pages: 14, kb: 288 },
    { id: 'dc4', title: 'Personal Protective Equipment', cat: 'policy',  rev: '2026-02', pages: 6,  kb: 154 },
    { id: 'dc5', title: 'Emergency Action Plan',         cat: 'policy',  rev: '2025-06', pages: 11, kb: 246 },
    { id: 'dc6', title: 'Blank Job Hazard Analysis',     cat: 'form',    rev: '2026-03', pages: 2,  kb: 88 },
    { id: 'dc7', title: 'Blank Incident Report',         cat: 'form',    rev: '2025-09', pages: 3,  kb: 102 },
    { id: 'dc8', title: 'Blank Toolbox Talk Sign-In',    cat: 'form',    rev: '2026-01', pages: 1,  kb: 61 },
    { id: 'dc9', title: 'OSHA 1926 Subpart M Extract',   cat: 'ref',     rev: '2024-12', pages: 22, kb: 520 },
    { id: 'dc10', title: 'Ladder Inspection Checklist',  cat: 'ref',     rev: '2026-02', pages: 2,  kb: 79 }
  ];
  var DOC_CATS = [
    ['manual', 'Safety manual'],
    ['policy', 'Policies'],
    ['form',   'Blank forms'],
    ['ref',    'Reference']
  ];

  var PRICING = {
    implementation: 750,
    monthly: 400,
    startsAt: 'launch',
    includes: [
      '26 field employees',
      'Office / admin access',
      'Weekly Toolbox Talk scheduling',
      'Personalized delivery by text link',
      'Automatic reminders while incomplete',
      'Completion tracking',
      'Engagement analytics',
      'Basic training-document management'
    ],
    excludes: [
      'Additional workflows, integrations or substantial modules — separate approval, and the monthly price may change',
      'The reusable PIN portal — not part of Phase 1'
    ]
  };

  window.PEINE = {
    SETTINGS: SETTINGS, FIELD: FIELD, ADMINS: ADMINS, TALKS: TALKS,
    SCHEDULE: SCHEDULE, ASSIGNMENTS: ASSIGNMENTS, TRAINING: TRAINING,
    DOCS: DOCS, DOC_CATS: DOC_CATS,
    PRICING: PRICING, MONDAY: MON, SEND_AT: SEND, DIGEST_AT: DIGEST,
    iso: iso, mondayOf: mondayOf, at: at, fmt: fmt, fmtDate: fmtDate, mins: mins,
    remindersFor: remindersFor, isOverdue: isOverdue, certStatus: certStatus,
    talkById: function (id) {
      return TALKS.filter(function (t) { return t.id === id; })[0] || null;
    },
    employeeById: function (id) {
      return FIELD.filter(function (p) { return p.id === id; })[0] || null;
    },
    assignmentByToken: function (tok) {
      return ASSIGNMENTS.filter(function (a) { return a.token === tok; })[0] || null;
    }
  };
})();
