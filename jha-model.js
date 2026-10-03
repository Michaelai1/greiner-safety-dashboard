/* JHA-MODEL:BEGIN ===========================================================
   Shared JHA model — ONE definition of the JHA fields, the ladder lookup and
   the revision rules. The phone (greiner-QR index.html) embeds this block;
   the office dashboard carries a byte-identical copy in jha-model.js, and a
   test fails if the two drift. Pure functions only: no DOM, no network, no
   storage. Callers pass in the records and the clock.
   ========================================================================== */
(function (root) {
  'use strict';

  var TZ = 'America/Indiana/Indianapolis';

  /* Revision window. Tony (Oct 2): up to three revisions to one JHA within a
     Monday-to-Friday week; the original never changes. Tony has NOT confirmed
     weekend behavior — this demo treats Saturday and Sunday as outside the
     window. Change `workdays` (ISO weekday numbers, Mon=1 ... Sun=7) once he
     decides; nothing else needs to move. */
  var JHA_REVISION_RULES = {
    maxRevisions: 3,
    timeZone: TZ,
    workdays: [1, 2, 3, 4, 5]
  };

  /* Ladder inspection cadence. Tony mentioned weekly ladder inspections but
     has not confirmed the rule, so the last inspection date is shown for
     information only: nothing expires and nothing is blocked because of age.
     To enforce later, change this one object:
       { mode: 'calendar-days', maxAgeDays: 7 }  — within the last 7 days
       { mode: 'workweek' }                       — inside the current workweek */
  var LADDER_INSPECTION_CADENCE = { mode: 'informational', maxAgeDays: null };

  var REVISION_CHANGE_TYPES = [
    'Work scope', 'Hazard or site condition', 'Crew assignment',
    'Equipment or material', 'Control or procedure', 'Correction or other'
  ];

  /* ---------------- time (Indianapolis) ---------------- */
  var _fmt = null;
  function indyParts(instant) {
    var d = instant instanceof Date ? instant : new Date(instant);
    if (!_fmt) {
      _fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric',
        month: '2-digit', day: '2-digit', weekday: 'short' });
    }
    var p = {};
    _fmt.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return { iso: p.year + '-' + p.month + '-' + p.day, dow: dow };
  }
  function isoAddDays(iso, n) {
    var t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  /* Which workweek an instant falls in, and whether that day is a workday. */
  function workweekOf(instant) {
    var p = indyParts(instant);
    return { date: p.iso, dow: p.dow, weekStart: isoAddDays(p.iso, 1 - p.dow),
             isWorkday: JHA_REVISION_RULES.workdays.indexOf(p.dow) !== -1 };
  }
  function fmtIndy(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* ---------------- JHA families and revisions ---------------- */
  // A family is one original JHA plus every revision of it. revision_number is
  // the version: 1 = original, 2 = Revision 1, 3 = Revision 2, 4 = Revision 3.
  function familyVersions(store, rootId) {
    return (store || []).filter(function (r) { return r.root_jha_id === rootId; })
      .sort(function (a, b) { return a.revision_number - b.revision_number; });
  }
  function familyHead(store, rootId) {
    var v = familyVersions(store, rootId);
    return v.length ? v[v.length - 1] : null;
  }
  function revisionsUsed(store, rootId) {
    return Math.max(0, familyVersions(store, rootId).length - 1);
  }
  function revisionLabel(n) { return n <= 1 ? 'Original' : 'Revision ' + (n - 1); }

  /* Can this family take another revision right now?
     code: ok | not-found | other-job | other-company | cap | weekend-now |
           weekend-original | outside-week */
  function reviseEligibility(store, rootId, ctx) {
    var versions = familyVersions(store, rootId);
    if (!versions.length) return { ok: false, code: 'not-found', message: 'This JHA was not found.' };
    var orig = versions[0], head = versions[versions.length - 1];
    var used = versions.length - 1, max = JHA_REVISION_RULES.maxRevisions;
    var base = { used: used, remaining: Math.max(0, max - used),
                 nextNumber: used + 1, head: head, original: orig };
    function no(code, message) { return Object.assign({ ok: false, code: code, message: message }, base); }
    if (ctx.companyId && orig.company_id && orig.company_id !== ctx.companyId) {
      return no('other-company', 'This JHA belongs to another company.');
    }
    if (ctx.jobId && orig.job_id !== ctx.jobId) {
      return no('other-job', 'Only JHAs from this job can be revised here.');
    }
    var now = workweekOf(ctx.now), was = workweekOf(orig.original_submitted_at);
    if (!now.isWorkday) {
      return no('weekend-now', 'JHAs can be revised Monday through Friday. Start a new JHA to document today’s work.');
    }
    if (!was.isWorkday) {
      return no('weekend-original', 'This JHA was submitted on a weekend and can’t be revised. Start a new JHA instead.');
    }
    if (was.weekStart !== now.weekStart) {
      return no('outside-week', 'This JHA is from an earlier workweek and can no longer be revised. You can view its history or start a new JHA.');
    }
    if (used >= max) {
      return no('cap', 'This JHA already has ' + max + ' revisions. Start a new JHA to document additional changes.');
    }
    return Object.assign({ ok: true, code: 'ok', message: '' }, base);
  }

  /* The picker: this job's families from the current workweek, grouped into
     Today and Earlier this workweek, newest activity first. Capped families
     stay listed so the foreman sees why, with a Complete New JHA action. */
  function revisionCandidates(store, ctx) {
    var roots = {};
    (store || []).forEach(function (r) { roots[r.root_jha_id] = 1; });
    var now = workweekOf(ctx.now), today = [], earlier = [], hidden = 0;
    Object.keys(roots).forEach(function (rootId) {
      var e = reviseEligibility(store, rootId, ctx);
      if (e.code === 'not-found' || e.code === 'other-job' || e.code === 'other-company') return;
      if (e.code === 'outside-week' || e.code === 'weekend-original' || e.code === 'weekend-now') { hidden++; return; }
      var card = { rootId: rootId, eligibility: e, original: e.original, head: e.head,
        lastActivity: e.head.revised_at || e.original.original_submitted_at };
      (workweekOf(e.original.original_submitted_at).date === now.date ? today : earlier).push(card);
    });
    var newest = function (a, b) { return String(b.lastActivity).localeCompare(String(a.lastActivity)); };
    return { today: today.sort(newest), earlier: earlier.sort(newest), hiddenCount: hidden,
             windowOpen: now.isWorkday };
  }

  function freezeDeep(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { freezeDeep(o[k]); });
    }
    return o;
  }

  /* Submitted records are frozen: no later code can edit an earlier version.
     `serverNow` is the server's clock (the demo stands it in locally); no
     timestamp is ever taken from a form field or a typed value. */
  function createOriginal(store, req, serverNow) {
    var at = new Date(serverNow).toISOString();
    var rootId = req.rootId || ('jha-' + Date.parse(at).toString(36) + '-' + (store.length + 1));
    var rec = freezeDeep({
      id: rootId + '-v1', root_jha_id: rootId, previous_revision_id: null, revision_number: 1,
      company_id: req.companyId || null, job_id: req.jobId || null,
      work_date: workweekOf(at).date, original_submitted_at: at, revised_at: null,
      submitted_by: req.by || '', revised_by: req.by || '', status: 'submitted',
      revision_change_type: null, revision_note: null,
      data: normalizeJhaData(req.data || {}), crew: req.crew || { employees: [], groups: [] },
      photos: req.photos || []
    });
    store.push(rec);
    return { ok: true, record: rec };
  }

  /* Append the next revision. Refuses (never overwrites) when the JHA moved on
     since the form opened (stale), when the cap is reached, when the window is
     closed, or when no change type was chosen. */
  function submitRevision(store, req, serverNow) {
    var e = reviseEligibility(store, req.rootId, { now: serverNow, jobId: req.jobId, companyId: req.companyId });
    if (!e.ok) return { ok: false, code: e.code, message: e.message };
    if (req.baseVersionId !== e.head.id) {
      return { ok: false, code: 'stale',
        message: 'This JHA was revised after you opened it. Refresh to load the latest version, then make your changes again.' };
    }
    if (REVISION_CHANGE_TYPES.indexOf(req.changeType) === -1) {
      return { ok: false, code: 'reason', message: 'Choose what changed.' };
    }
    var at = new Date(serverNow).toISOString();
    var rec = freezeDeep({
      id: req.rootId + '-v' + (e.head.revision_number + 1), root_jha_id: req.rootId,
      previous_revision_id: e.head.id, revision_number: e.head.revision_number + 1,
      company_id: e.original.company_id || null, job_id: e.original.job_id,
      work_date: e.original.work_date, original_submitted_at: e.original.original_submitted_at,
      revised_at: at, submitted_by: e.original.submitted_by, revised_by: req.by || '',
      status: 'submitted', revision_change_type: req.changeType,
      revision_note: String(req.note || '').trim() || null,
      data: normalizeJhaData(req.data || {}), crew: req.crew || { employees: [], groups: [] },
      photos: req.photos || []
    });
    store.push(rec);
    return { ok: true, record: rec };
  }

  /* Compliance counts JHA families (one original = one daily JHA however many
     revisions follow); analytics counts revision events separately. */
  function dailyJhaCount(store, jobId, isoDate) {
    var roots = {};
    (store || []).forEach(function (r) {
      if (r.revision_number === 1 && r.job_id === jobId && r.work_date === isoDate) roots[r.root_jha_id] = 1;
    });
    return Object.keys(roots).length;
  }
  function revisionEventCount(store, jobId) {
    return (store || []).filter(function (r) {
      return r.revision_number > 1 && (!jobId || r.job_id === jobId);
    }).length;
  }

  /* ---------------- ladders ---------------- */
  // One equipment category: Ladder. IDs match exactly (ignoring surrounding
  // spaces and letter case). There is no fuzzy or partial matching.
  function normalizeLadderId(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  function ladderLookup(registry, inspections, rawId) {
    var id = normalizeLadderId(rawId);
    if (!id) return { state: 'empty', id: '' };
    var matches = (registry || []).filter(function (l) { return normalizeLadderId(l.ladder_id) === id; });
    if (matches.length > 1) {
      return { state: 'duplicate', id: id, count: matches.length,
        message: 'More than one ladder is registered as ' + id + '. Ask the office to correct the ladder list before relying on this ID.' };
    }
    if (!matches.length) {
      return { state: 'unknown', id: id,
        message: 'No inspection history was found for Ladder ' + id + '. Check the ID on the ladder, or record its first inspection.' };
    }
    var hist = (inspections || []).filter(function (i) { return normalizeLadderId(i.ladder_id) === id; })
      .sort(function (a, b) { return String(b.inspected_at).localeCompare(String(a.inspected_at)); });
    var open = hist.filter(function (i) { return i.defect && !i.defect.resolved_at; })[0] || null;
    var last = hist[0] || null;
    var status = open ? 'do-not-use' : (last ? 'no-open-defects' : 'no-inspection');
    return { state: 'found', id: id, ladder: matches[0], last: last, history: hist,
             openDefect: open ? open.defect : null, status: status,
             statusLabel: ladderStatusLabel(status), cadence: ladderCadence(last) };
  }
  function ladderStatusLabel(status) {
    // Deliberately never "approved", "ready" or any OSHA claim.
    return status === 'do-not-use' ? 'Do Not Use — open defect reported'
      : status === 'no-open-defects' ? 'No open defects reported'
      : 'No inspection recorded';
  }
  // Informational unless LADDER_INSPECTION_CADENCE is changed.
  function ladderCadence(last, now) {
    var c = LADDER_INSPECTION_CADENCE;
    if (c.mode === 'informational' || !last) return { enforced: false, due: false };
    var at = new Date(last.inspected_at), t = now ? new Date(now) : new Date();
    if (c.mode === 'calendar-days') return { enforced: true, due: (t - at) > c.maxAgeDays * 86400000 };
    if (c.mode === 'workweek') return { enforced: true, due: workweekOf(at).weekStart !== workweekOf(t).weekStart };
    return { enforced: false, due: false };
  }

  /* Record an inspection. The inspection time comes from serverNow only; any
     inspected_at in the request is ignored, so a field user cannot backdate.
     A defect is optional; when given it needs a description and whether the
     ladder was removed from service. */
  function recordLadderInspection(registry, inspections, req, serverNow) {
    var id = normalizeLadderId(req.ladderId);
    if (!id) return { ok: false, code: 'id', message: 'Enter the Ladder ID.' };
    var look = ladderLookup(registry, inspections, id);
    if (look.state === 'duplicate') return { ok: false, code: 'duplicate', message: look.message };
    var who = String(req.inspector || '').trim();
    if (!who) return { ok: false, code: 'inspector', message: 'Enter who inspected the ladder.' };
    if (req.acknowledged !== true) return { ok: false, code: 'ack', message: 'Confirm that you inspected this ladder before use.' };
    var at = new Date(serverNow).toISOString(), defect = null;
    if (req.defect) {
      var desc = String(req.defect.description || '').trim();
      if (!desc) return { ok: false, code: 'defect-description', message: 'Describe the defect or unsafe condition.' };
      if (req.defect.removedFromService !== 'yes' && req.defect.removedFromService !== 'no') {
        return { ok: false, code: 'defect-removed', message: 'Say whether the ladder was removed from service.' };
      }
      defect = { description: desc, removed_from_service: req.defect.removedFromService,
                 photo: req.defect.photo || null, reported_at: at, resolved_at: null };
    }
    if (look.state === 'unknown') registry.push(freezeDeep({ ladder_id: id, category: 'Ladder', added_at: at }));
    var rec = freezeDeep({ id: 'ladinsp-' + Date.parse(at).toString(36) + '-' + (inspections.length + 1),
      ladder_id: id, inspected_at: at, inspected_by: who, acknowledged: true, defect: defect });
    inspections.push(rec);
    return { ok: true, record: rec, lookup: ladderLookup(registry, inspections, id) };
  }

  /* What a JHA stores about the ladder it planned to use — the information
     that was visible when it was submitted. */
  function ladderSnapshot(look) {
    if (!look || look.state !== 'found') {
      return look && look.state === 'unknown' ? { ladder_id: look.id, status: 'no-history',
        status_label: 'No inspection history found' } : null;
    }
    return { ladder_id: look.id,
      last_inspected_at: look.last ? look.last.inspected_at : null,
      last_inspected_by: look.last ? look.last.inspected_by : null,
      status: look.status, status_label: look.statusLabel,
      open_defect: look.openDefect ? { description: look.openDefect.description,
        removed_from_service: look.openDefect.removed_from_service } : null };
  }

  /* ---------------- the JHA field model ---------------- */
  var HEADER_FIELDS = [
    ['jhaProjectName', 'Project Name'], ['jhaDescriptionOfWork', 'Description of Work'],
    ['jhaDate', 'Date'], ['jhaStartTime', 'Start Time'],
    ['jhaCompleteTime', 'Estimated Time of Completion'], ['jhaLocation', 'Location'],
    ['jhaAnalysisBy', 'Analysis By'], ['jhaPmSupervisor', 'PM / Supervisor'],
    ['jhaSubcontractors', 'Subcontractor(s)'],
    ['jhaJobsiteSafety', 'Jobsite Safety Requirements — PPE, housekeeping, dust walls, spark-proof tools, etc.']
  ];
  var LADDER_USE_LABEL = 'Is any ladder use planned or expected today?';
  var AERIAL_USE_LABEL = 'Will any aerial lift devices be used today?';
  var AERIAL_WHO_LABEL = 'What competent person or persons will conduct the lift inspections?';
  /* Questions retired on Tony's Oct 1 instruction. New JHAs never collect or
     store them; JHAs submitted before the change still show what was asked
     and answered at the time. */
  var LEGACY_FIELDS = [
    ['jhaNewRevised', 'New or Revised'],
    ['jhaLadderSafe', 'Can this work be done safely from a ladder?'],
    ['jhaLadderWhyNotLift', 'Explain why a one-man scissor lift, or being tied off while using a ladder, will not work in this instance'],
    ['jhaLadderObstacle1', 'Above-ceiling hindrances / obstacles 1'],
    ['jhaLadderObstacle2', 'Above-ceiling hindrances / obstacles 2'],
    ['jhaLadderObstacle3', 'Above-ceiling hindrances / obstacles 3'],
    ['jhaLadderObstacle4', 'Above-ceiling hindrances / obstacles 4'],
    ['jhaLadderObstacle5', 'Above-ceiling hindrances / obstacles 5'],
    ['jhaLadderGreaterRisk', 'Explain how the use of fall protection poses a greater risk than not using it']
  ];
  var MAX_ROWS = 6;

  function parseMaybe(v, fallback) {
    if (v == null || v === '') return fallback;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }

  /* The data a NEW or REVISED JHA may store: retired questions dropped, and
     every child of a "No" (or unanswered) parent cleared. */
  function normalizeJhaData(raw) {
    var d = {};
    Object.keys(raw || {}).forEach(function (k) { d[k] = raw[k]; });
    LEGACY_FIELDS.forEach(function (f) { delete d[f[0]]; });
    if (d.jhaLadderUse === 'yes') {
      d.jhaLadderId = normalizeLadderId(d.jhaLadderId);
      d.jhaLadderInspection = parseMaybe(d.jhaLadderInspection, null);
    } else {
      delete d.jhaLadderId; delete d.jhaLadderInspection;
    }
    if (d.jhaAerialUse === 'yes') {
      var who = parseMaybe(d.jhaAerialInspectors, []);
      d.jhaAerialInspectors = (Array.isArray(who) ? who : []).filter(function (n, i, a) {
        return n && a.indexOf(n) === i; });
    } else {
      delete d.jhaAerialInspectors;
    }
    for (var n = 1; n <= MAX_ROWS; n++) {
      ['jhaTask', 'jhaHazard', 'jhaAction'].forEach(function (p) {
        if (String(d[p + n] || '').trim().toLowerCase() !== 'other') delete d[p + n + 'Other'];
      });
    }
    return d;
  }

  function yesNo(v) { return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : (v || ''); }
  function filled(v) { return v != null && String(v).trim() !== ''; }

  /* Every populated answer, in display order. Phone review, office detail and
     the PDF all render from this one list. Historical (pre-change) answers are
     included only when the stored record actually has them. */
  function jhaSections(data, opts) {
    opts = opts || {};
    var d = data || {}, out = [];
    function item(key, label, value, extra) {
      return Object.assign({ key: key, label: label, value: String(value) }, extra || {});
    }
    var head = [];
    HEADER_FIELDS.forEach(function (f) { if (filled(d[f[0]])) head.push(item(f[0], f[1], d[f[0]])); });
    if (filled(d.jhaNewRevised)) head.push(item('jhaNewRevised', 'New or Revised', d.jhaNewRevised, { legacy: true }));
    if (head.length) out.push({ title: 'Job Information', items: head });

    var rows = [];
    for (var n = 1; n <= MAX_ROWS; n++) {
      var t = d['jhaTask' + n], h = d['jhaHazard' + n], a = d['jhaAction' + n];
      if (!filled(t) && !filled(h) && !filled(a)) continue;
      var spec = function (p) {
        var v = d[p + n];
        return String(v || '').trim().toLowerCase() === 'other' && filled(d[p + n + 'Other']) ? 'Other: ' + d[p + n + 'Other'] : (v || '');
      };
      rows.push(item('jhaTask' + n, 'Row ' + n + ' — Task', spec('jhaTask')));
      rows.push(item('jhaHazard' + n, 'Row ' + n + ' — Potential Hazards', spec('jhaHazard'), { photoKey: 'jhaHazard' + n + '_photos' }));
      rows.push(item('jhaAction' + n, 'Row ' + n + ' — Actions to Reduce Hazards', spec('jhaAction')));
    }
    if (rows.length) out.push({ title: 'Tasks, Hazards & Actions', items: rows });

    var crew = opts.crew || parseMaybe(d.jhaCrewData, null);
    if (crew && ((crew.employees || []).length || (crew.groups || []).length)) {
      var ci = [item('crew', 'Employees (' + (crew.employees || []).length + ')', (crew.employees || []).join(', ') || '—')];
      (crew.groups || []).forEach(function (g, i) {
        ci.push(item('crewGroup' + (i + 1), 'Assignment ' + (i + 1) + ' — ' + (g.task || '—'),
          (g.activity || '—') + ' · ' + (((g.members || []).join(', ')) || 'no one assigned')));
      });
      out.push({ title: 'Crew on this JHA', items: ci });
    }

    var lad = [];
    if (filled(d.jhaLadderUse)) lad.push(item('jhaLadderUse', LADDER_USE_LABEL, yesNo(d.jhaLadderUse)));
    if (d.jhaLadderUse === 'yes') {
      if (filled(d.jhaLadderId)) lad.push(item('jhaLadderId', 'Ladder ID', d.jhaLadderId));
      var s = parseMaybe(d.jhaLadderInspection, null);
      if (s) {
        lad.push(item('jhaLadderLastInspected', 'Last inspection date', s.last_inspected_at ? fmtIndy(s.last_inspected_at) : 'None recorded'));
        if (s.last_inspected_by) lad.push(item('jhaLadderInspectedBy', 'Last inspected by', s.last_inspected_by));
        lad.push(item('jhaLadderStatus', 'Inspection status', s.status_label || '',
          { flagged: s.status === 'do-not-use' }));
        if (s.open_defect) {
          lad.push(item('jhaLadderDefect', 'Open defect', s.open_defect.description +
            ' (removed from service: ' + yesNo(s.open_defect.removed_from_service) + ')', { flagged: true }));
        }
      }
    }
    if (lad.length) out.push({ title: 'Ladder Use', items: lad });

    var legacy = [];
    LEGACY_FIELDS.forEach(function (f) {
      if (f[0] === 'jhaNewRevised') return;
      if (filled(d[f[0]])) legacy.push(item(f[0], f[1], f[0] === 'jhaLadderSafe' ? yesNo(d[f[0]]) : d[f[0]], { legacy: true }));
    });
    if (legacy.length) {
      out.push({ title: 'Ladder / Fall Protection Variance (questions as asked when this JHA was submitted)',
                 items: legacy, legacy: true });
    }

    var aer = [];
    if (filled(d.jhaAerialUse)) aer.push(item('jhaAerialUse', AERIAL_USE_LABEL, yesNo(d.jhaAerialUse)));
    if (d.jhaAerialUse === 'yes') {
      var who = parseMaybe(d.jhaAerialInspectors, []);
      aer.push(item('jhaAerialInspectors', AERIAL_WHO_LABEL,
        (Array.isArray(who) && who.length) ? who.join(', ') : 'None selected'));
    }
    if (aer.length) out.push({ title: 'Aerial Lifts', items: aer });

    if (filled(d.jhaAdditionalNotes)) {
      out.push({ title: 'Additional Photos & Notes',
                 items: [item('jhaAdditionalNotes', 'Notes', d.jhaAdditionalNotes, { photoKey: 'jhaAdditionalNotes_photos' })] });
    }
    return out;
  }

  /* Submit-time checks the HTML required attributes can't express. */
  function jhaSubmitProblems(data, ladderLook) {
    var d = data || {}, p = [];
    if (d.jhaLadderUse === 'yes') {
      if (!normalizeLadderId(d.jhaLadderId)) p.push('Enter the Ladder ID.');
      else if (ladderLook && ladderLook.state === 'duplicate') p.push(ladderLook.message);
      else if (ladderLook && ladderLook.status === 'do-not-use') {
        p.push('Ladder ' + ladderLook.id + ' is marked Do Not Use. Use a different ladder and enter its ID, or change the ladder answer.');
      }
    }
    if (d.jhaAerialUse === 'yes') {
      var who = parseMaybe(d.jhaAerialInspectors, []);
      if (!Array.isArray(who) || !who.length) p.push('Select at least one person who will conduct the lift inspections.');
    }
    return p;
  }

  var api = {
    TZ: TZ, JHA_REVISION_RULES: JHA_REVISION_RULES, LADDER_INSPECTION_CADENCE: LADDER_INSPECTION_CADENCE,
    REVISION_CHANGE_TYPES: REVISION_CHANGE_TYPES, LEGACY_FIELDS: LEGACY_FIELDS, HEADER_FIELDS: HEADER_FIELDS,
    LADDER_USE_LABEL: LADDER_USE_LABEL, AERIAL_USE_LABEL: AERIAL_USE_LABEL, AERIAL_WHO_LABEL: AERIAL_WHO_LABEL,
    indyParts: indyParts, workweekOf: workweekOf, fmtIndy: fmtIndy, isoAddDays: isoAddDays,
    familyVersions: familyVersions, familyHead: familyHead, revisionsUsed: revisionsUsed,
    revisionLabel: revisionLabel, reviseEligibility: reviseEligibility,
    revisionCandidates: revisionCandidates, createOriginal: createOriginal,
    submitRevision: submitRevision, dailyJhaCount: dailyJhaCount,
    revisionEventCount: revisionEventCount, freezeDeep: freezeDeep,
    normalizeLadderId: normalizeLadderId, ladderLookup: ladderLookup,
    ladderStatusLabel: ladderStatusLabel, ladderCadence: ladderCadence,
    recordLadderInspection: recordLadderInspection, ladderSnapshot: ladderSnapshot,
    normalizeJhaData: normalizeJhaData, jhaSections: jhaSections,
    jhaSubmitProblems: jhaSubmitProblems
  };
  root.JhaModel = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
/* JHA-MODEL:END */
