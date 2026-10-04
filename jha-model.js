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

  /* Exact attestation wording, versioned so a stored record always says what
     the person agreed to. Change the text => bump the version. */
  var LADDER_SAFE_ATTESTATION = { version: 'ladder-safe-use-v1',
    text: 'I inspected this ladder before use today and found it safe to use.' };
  var LADDER_DEFECT_ACK = { version: 'ladder-do-not-use-v1',
    text: 'I marked or tagged this ladder \u2018Do Not Use\u2019 and removed it from service.' };
  var SIGN_IN_REQUIRED = 'Sign in with your employee access before recording an inspection.';

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
      revision_note: null, revision_diff: null,
      data: normalizeJhaData(req.data || {}), crew: req.crew || { employees: [], groups: [] },
      photos: req.photos || []
    });
    store.push(rec);
    return { ok: true, record: rec };
  }

  /* Append the next revision. Refuses (never overwrites) when the JHA moved on
     since the form opened (stale), when the cap is reached, or when the window
     is closed. What changed is computed, field by field — the foreman is never
     asked to explain each change; an optional note can add context. */
  function submitRevision(store, req, serverNow) {
    var e = reviseEligibility(store, req.rootId, { now: serverNow, jobId: req.jobId, companyId: req.companyId });
    if (!e.ok) return { ok: false, code: e.code, message: e.message };
    if (req.baseVersionId !== e.head.id) {
      return { ok: false, code: 'stale',
        message: 'This JHA was revised after you opened it. Refresh to load the latest version, then make your changes again.' };
    }
    var at = new Date(serverNow).toISOString();
    var nextData = normalizeJhaData(req.data || {});
    var nextCrew = req.crew || { employees: [], groups: [] };
    var rec = freezeDeep({
      id: req.rootId + '-v' + (e.head.revision_number + 1), root_jha_id: req.rootId,
      previous_revision_id: e.head.id, revision_number: e.head.revision_number + 1,
      company_id: e.original.company_id || null, job_id: e.original.job_id,
      work_date: e.original.work_date, original_submitted_at: e.original.original_submitted_at,
      revised_at: at, submitted_by: e.original.submitted_by, revised_by: req.by || '',
      status: 'submitted',
      revision_note: String(req.note || '').trim() || null,
      revision_diff: diffJhaData(e.head.data, nextData, e.head.crew, nextCrew),
      data: nextData, crew: nextCrew,
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

  /* Ladders assigned to a job, for the picker. Users select; nobody types an
     ID. A duplicated ID is listed once, flagged, and cannot be selected. */
  function laddersForJob(registry, inspections, jobId) {
    var seen = {};
    (registry || []).forEach(function (l) {
      if (l.job_id !== jobId) return;
      var id = normalizeLadderId(l.ladder_id);
      if (id) seen[id] = (seen[id] || 0) + 1;
    });
    return Object.keys(seen).sort().map(function (id) {
      var look = ladderLookup(registry, inspections, id);
      return { id: id, description: look.state === 'found' ? (look.ladder.description || '') : '',
        duplicate: look.state === 'duplicate', last_inspected_at: look.last ? look.last.inspected_at : null,
        last_inspected_by: look.last ? look.last.inspected_by : null,
        do_not_use: look.status === 'do-not-use', look: look };
    });
  }
  function ladderGuard(registry, inspections, req) {
    var u = req.user || {};
    if (!u.id || !String(u.name || '').trim()) return { ok: false, code: 'auth', message: SIGN_IN_REQUIRED };
    var id = normalizeLadderId(req.ladderId);
    var look = ladderLookup(registry, inspections, id);
    if (look.state === 'duplicate') return { ok: false, code: 'duplicate', message: look.message };
    if (look.state !== 'found' || look.ladder.job_id !== req.jobId) {
      return { ok: false, code: 'not-assigned', message: 'Ladder ' + id + ' is not assigned to this job.' };
    }
    return { ok: true, id: id, look: look, user: { id: u.id, name: String(u.name).trim() } };
  }
  function ladderEvent(kind, g, req, at, extra) {
    return freezeDeep(Object.assign({
      id: 'lad-' + kind + '-' + Date.parse(at).toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      kind: kind, ladder_id: g.id, job_id: req.jobId || null, company_id: req.companyId || null,
      inspected_at: at, inspected_by: g.user.name, inspected_by_user_id: g.user.id,
      jha_root_id: req.jhaRootId || null, jha_revision_number: req.jhaRevisionNumber || null
    }, extra));
  }
  /* "Inspect for today's use". Identity is the signed-in employee — a typed
     name is never accepted. Time is the server's; nothing in the request can
     set it. A ladder with an open defect cannot be confirmed safe. */
  function confirmLadderSafe(registry, inspections, req, serverNow) {
    var g = ladderGuard(registry, inspections, req);
    if (!g.ok) return g;
    if (g.look.status === 'do-not-use') {
      return { ok: false, code: 'do-not-use', message: 'Ladder ' + g.id + ' is marked Do Not Use and cannot be confirmed safe. Select a different assigned ladder.' };
    }
    if (req.attested !== true || req.attestationVersion !== LADDER_SAFE_ATTESTATION.version) {
      return { ok: false, code: 'attest', message: 'Confirm the statement before recording the inspection.' };
    }
    var at = new Date(serverNow).toISOString();
    var rec = ladderEvent('inspection', g, req, at, { result: 'safe',
      attestation_text: LADDER_SAFE_ATTESTATION.text, attestation_version: LADDER_SAFE_ATTESTATION.version,
      defect: null });
    inspections.push(rec);
    return { ok: true, record: rec, lookup: ladderLookup(registry, inspections, g.id) };
  }
  /* "Report a defect or unsafe condition". Description and the Do Not Use
     acknowledgment are required; the photo is optional. Field users can never
     resolve or delete a defect — only a future office workflow may. */
  function reportLadderDefect(registry, inspections, req, serverNow) {
    var g = ladderGuard(registry, inspections, req);
    if (!g.ok) return g;
    var desc = String(req.description || '').trim();
    if (!desc) return { ok: false, code: 'defect-description', message: 'Describe the defect or unsafe condition.' };
    if (req.acknowledged !== true) {
      return { ok: false, code: 'defect-ack', message: 'Confirm that you marked or tagged the ladder Do Not Use and removed it from service.' };
    }
    var at = new Date(serverNow).toISOString();
    var rec = ladderEvent('defect', g, req, at, { result: 'defect',
      defect: { description: desc, photo: req.photo || null, tagged_do_not_use: true,
        acknowledgment_text: LADDER_DEFECT_ACK.text, acknowledgment_version: LADDER_DEFECT_ACK.version,
        reported_at: at, reported_by: g.user.name, resolved_at: null } });
    inspections.push(rec);
    return { ok: true, record: rec, lookup: ladderLookup(registry, inspections, g.id) };
  }

  /* What a JHA stores about each selected ladder — the information visible
     when it was submitted, plus any inspection or defect recorded during this
     JHA (identified by the inspection record id). */
  function ladderSnapshot(look, todays) {
    if (!look || look.state !== 'found') return null;
    var safe = (todays || []).filter(function (r) { return r.result === 'safe'; }).pop() || null;
    return { ladder_id: look.id, description: look.ladder.description || '',
      last_inspected_at: look.last ? look.last.inspected_at : null,
      last_inspected_by: look.last ? look.last.inspected_by : null,
      status: look.status, status_label: look.statusLabel,
      open_defect: look.openDefect ? { description: look.openDefect.description,
        reported_at: look.openDefect.reported_at || null, reported_by: look.openDefect.reported_by || null } : null,
      todays_check: safe ? { record_id: safe.id, result: 'safe', at: safe.inspected_at, by: safe.inspected_by,
        by_user_id: safe.inspected_by_user_id, attestation_version: safe.attestation_version } : null };
  }
  function defectSnapshot(rec) {
    return { record_id: rec.id, ladder_id: rec.ladder_id, description: rec.defect.description,
      reported_at: rec.defect.reported_at, reported_by: rec.defect.reported_by,
      reported_by_user_id: rec.inspected_by_user_id, has_photo: !!rec.defect.photo,
      acknowledgment_version: rec.defect.acknowledgment_version };
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
  var LADDER_PICK_LABEL = 'Which ladder or ladders will be used today?';
  var NO_LADDERS_ASSIGNED = 'No ladders are assigned to this job. Contact the office before using a ladder.';
  var AERIAL_USE_LABEL = 'Will any aerial lift devices be used today?';
  var AERIAL_WHO_LABEL = 'Who will conduct the lift inspections?';
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
    // jhaLadderId / jhaLadderInspection were the single typed-ID format of the
    // previous review build; new JHAs use the job-assigned selection instead.
    delete d.jhaLadderId; delete d.jhaLadderInspection;
    if (d.jhaLadderUse === 'yes') {
      var ids = parseMaybe(d.jhaLadderIds, []);
      d.jhaLadderIds = (Array.isArray(ids) ? ids : []).map(normalizeLadderId)
        .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      var checks = parseMaybe(d.jhaLadderChecks, []);
      d.jhaLadderChecks = (Array.isArray(checks) ? checks : []).filter(function (c) {
        return c && d.jhaLadderIds.indexOf(normalizeLadderId(c.ladder_id)) !== -1; });
      // Defects reported during this JHA stay on it even if that ladder was
      // then swapped for another.
      var defects = parseMaybe(d.jhaLadderDefects, []);
      d.jhaLadderDefects = Array.isArray(defects) ? defects : [];
    } else {
      delete d.jhaLadderIds; delete d.jhaLadderChecks; delete d.jhaLadderDefects;
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
      var ids = parseMaybe(d.jhaLadderIds, []);
      if (Array.isArray(ids) && ids.length) lad.push(item('jhaLadderIds', LADDER_PICK_LABEL, ids.join(', ')));
      (parseMaybe(d.jhaLadderChecks, []) || []).forEach(function (c) {
        var p = 'Ladder ' + c.ladder_id + ' \u2014 ';
        lad.push(item('ladder:' + c.ladder_id + ':last', p + 'Last inspected',
          c.last_inspected_at ? fmtIndy(c.last_inspected_at) : 'No previous inspection is recorded for this ladder.'));
        if (c.last_inspected_by) lad.push(item('ladder:' + c.ladder_id + ':by', p + 'Inspected by', c.last_inspected_by));
        lad.push(item('ladder:' + c.ladder_id + ':status', p + 'Current status', c.status_label || '',
          { flagged: c.status === 'do-not-use' }));
        lad.push(item('ladder:' + c.ladder_id + ':today', p + 'Inspection for today\u2019s use',
          c.todays_check ? 'Confirmed safe for use by ' + c.todays_check.by + ' \u00b7 ' + fmtIndy(c.todays_check.at)
            : 'Not recorded on this JHA'));
      });
      (parseMaybe(d.jhaLadderDefects, []) || []).forEach(function (x) {
        lad.push(item('ladder:' + x.ladder_id + ':defect:' + x.record_id, 'Ladder ' + x.ladder_id + ' \u2014 Defect reported',
          x.description + ' \u00b7 marked Do Not Use and removed from service \u00b7 ' + x.reported_by +
          ' \u00b7 ' + fmtIndy(x.reported_at) + (x.has_photo ? ' \u00b7 photo attached' : ''), { flagged: true }));
      });
      // Earlier review-build format (single typed ID) — shown as stored.
      if (filled(d.jhaLadderId)) lad.push(item('jhaLadderId', 'Ladder ID', d.jhaLadderId));
      var s = parseMaybe(d.jhaLadderInspection, null);
      if (s) {
        lad.push(item('jhaLadderLastInspected', 'Last inspection date', s.last_inspected_at ? fmtIndy(s.last_inspected_at) : 'None recorded'));
        if (s.last_inspected_by) lad.push(item('jhaLadderInspectedBy', 'Last inspected by', s.last_inspected_by));
        lad.push(item('jhaLadderStatus', 'Inspection status', s.status_label || '', { flagged: s.status === 'do-not-use' }));
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

  /* Submit-time checks the HTML required attributes can't express.
     ctx.ladders: { assigned: [ids assigned to this job], states: { id: lookup } } */
  function jhaSubmitProblems(data, ctx) {
    var d = data || {}, p = [], lad = (ctx && ctx.ladders) || null;
    if (d.jhaLadderUse === 'yes') {
      var ids = parseMaybe(d.jhaLadderIds, []);
      if (lad && !(lad.assigned || []).length) p.push(NO_LADDERS_ASSIGNED);
      else if (!Array.isArray(ids) || !ids.length) p.push('Select which ladder or ladders will be used today.');
      else if (lad) {
        ids.forEach(function (id) {
          var st = (lad.states || {})[id];
          if ((lad.assigned || []).indexOf(id) === -1) p.push('Ladder ' + id + ' is not assigned to this job.');
          else if (st && st.state === 'duplicate') p.push(st.message);
          else if (st && st.status === 'do-not-use') {
            p.push('Ladder ' + id + ' is marked Do Not Use. Remove it and select a different assigned ladder.');
          }
        });
      }
    }
    if (d.jhaAerialUse === 'yes') {
      var who = parseMaybe(d.jhaAerialInspectors, []);
      if (!Array.isArray(who) || !who.length) p.push('Select at least one person who will conduct the lift inspections.');
    }
    return p;
  }

  /* Field-level difference between two versions, computed automatically. */
  function diffJhaData(prevData, nextData, prevCrew, nextCrew) {
    var A = flatAnswers(prevData, prevCrew), B = flatAnswers(nextData, nextCrew), out = [];
    var keys = Object.keys(A);
    Object.keys(B).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
    keys.forEach(function (k) {
      var a = A[k], b = B[k];
      if ((a && a.value) === (b && b.value)) return;
      out.push({ key: k, label: (b || a).label, from: a ? a.value : '', to: b ? b.value : '' });
    });
    return out;
  }
  function flatAnswers(data, crew) {
    var m = {};
    jhaSections(data || {}, { crew: crew || { employees: [], groups: [] } }).forEach(function (sec) {
      sec.items.forEach(function (it) { m[it.key] = { label: it.label, value: it.value }; });
    });
    return m;
  }

  var api = {
    TZ: TZ, JHA_REVISION_RULES: JHA_REVISION_RULES, LADDER_INSPECTION_CADENCE: LADDER_INSPECTION_CADENCE,
    LEGACY_FIELDS: LEGACY_FIELDS, HEADER_FIELDS: HEADER_FIELDS,
    LADDER_USE_LABEL: LADDER_USE_LABEL, LADDER_PICK_LABEL: LADDER_PICK_LABEL, NO_LADDERS_ASSIGNED: NO_LADDERS_ASSIGNED,
    AERIAL_USE_LABEL: AERIAL_USE_LABEL, AERIAL_WHO_LABEL: AERIAL_WHO_LABEL,
    LADDER_SAFE_ATTESTATION: LADDER_SAFE_ATTESTATION, LADDER_DEFECT_ACK: LADDER_DEFECT_ACK,
    SIGN_IN_REQUIRED: SIGN_IN_REQUIRED,
    indyParts: indyParts, workweekOf: workweekOf, fmtIndy: fmtIndy, isoAddDays: isoAddDays,
    familyVersions: familyVersions, familyHead: familyHead, revisionsUsed: revisionsUsed,
    revisionLabel: revisionLabel, reviseEligibility: reviseEligibility,
    revisionCandidates: revisionCandidates, createOriginal: createOriginal,
    submitRevision: submitRevision, dailyJhaCount: dailyJhaCount,
    revisionEventCount: revisionEventCount, freezeDeep: freezeDeep,
    normalizeLadderId: normalizeLadderId, ladderLookup: ladderLookup,
    ladderStatusLabel: ladderStatusLabel, ladderCadence: ladderCadence,
    laddersForJob: laddersForJob, confirmLadderSafe: confirmLadderSafe,
    reportLadderDefect: reportLadderDefect, ladderSnapshot: ladderSnapshot, defectSnapshot: defectSnapshot,
    normalizeJhaData: normalizeJhaData, jhaSections: jhaSections,
    jhaSubmitProblems: jhaSubmitProblems, diffJhaData: diffJhaData
  };
  root.JhaModel = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
/* JHA-MODEL:END */
