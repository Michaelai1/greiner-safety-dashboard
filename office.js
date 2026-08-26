/* ============================================================================
   Safety Dashboard — desk build.

   Purpose-built for a general contractor's internal safety department. It is
   NOT a client portal: nobody here is reporting up to a consultant, they are
   running the program themselves. That is why the nav leads with what is
   happening right now (permits, incidents) rather than with an archive.

   Reads the same bundle the phone reads, so the two never disagree.
   Nothing contractor-specific lives in this file — see config.js.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.CONFIG;
  if (!C) { document.body.innerHTML = '<p style="padding:3rem">config.js did not load.</p>'; return; }

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(t, c, txt) {
    var n = document.createElement(t);
    if (c) n.className = c;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- session ---------------------------------------------------- */
  var SKEY = 'cs_session_' + C.slug;
  function getSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SKEY) || 'null');
      if (!s || !s.session) return null;
      if (s.expires_at && new Date(s.expires_at) <= new Date()) {
        localStorage.removeItem(SKEY); return null;
      }
      return s;
    } catch (e) { return null; }
  }
  function post(fn, body) {
    if (C.demo) return window.DEMO.call(fn, body);
    body = body || {};
    // real RPCs are session-scoped: carry the login token on every call but login
    if (fn !== 'cs_portal_login' && body.p_token === undefined) {
      var s = getSession();
      if (s && s.session) body = Object.assign({ p_token: s.session }, body);
    }
    return fetch(C.creekside.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: C.creekside.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) {
          if (/invalid token|insufficient scope/i.test((b && b.message) || '')) {
            try { localStorage.removeItem(SKEY); } catch (e) {}
          }
          throw new Error((b && b.message) || 'request failed');
        }
        return b;
      });
    });
  }

  /* ---------- formatting ------------------------------------------------- */
  var B = null, CREW = [];

  /* Real backend returns a lean bundle (company/jobs/reports/certs/stats/docs).
     Guarantee every key the UI reads exists so modules with no backend render
     clean empty states instead of throwing, and overlay the standalone real
     feeds (findings, incidents). Never fabricates data. */
  function normalizeBundle(raw, findings, incidents) {
    var b = raw || {};
    ['jobs','reports','certs','stats','docs','subs','permits','permit_types',
     'permit_checklists','near_misses','incidents','talks','templates','people','invites',
     'talk_sends','permit_sends','doc_folders','hazcats','reg_visits','schedules','send_log',
     'equipment','talk_templates','job_orientations','orientation_sends','worker_pdfs',
     'internal_crew','findings','cjsc','scorecard'].forEach(function (k) {
      if (!Array.isArray(b[k])) b[k] = [];
    });
    if (!b.company) b.company = { name: (C.contractor || 'Greiner Brothers') };
    if (!b.sub_hours || typeof b.sub_hours !== 'object') b.sub_hours = {};
    if (!b.template_content || typeof b.template_content !== 'object') b.template_content = {};
    if (b.ccs === undefined) b.ccs = null;
    if (Array.isArray(findings)) b.findings = findings;
    if (Array.isArray(incidents)) b.incidents = incidents;
    return b;
  }

  /* Map real field submissions (cs_portal_field_inspections) into the CREW row
     shape the Inspections/Analytics views expect. */
  function crewFromField(rows) {
    return (rows || []).map(function (r) {
      return {
        id: r.id,
        inspector_name: r.inspector_name,
        jobsite: r.job_name || r.job_number || '',
        inspection_subtype: r.form_type,
        form_type: r.form_title || r.form_type,
        inspection_date: r.submitted_at ? tzDayStr(r.submitted_at) : '',
        submitted_at: r.submitted_at,
        has_defects: !!r.has_defects,
        defect_count: r.defect_count || 0,
        status: r.has_defects ? 'flagged' : 'submitted',
        asset_id: r.asset_id || null,
        pdf_path: r.pdf_path || null,
        fields: {}
      };
    });
  }

  /* Open a stored field-submission PDF via the private-bucket edge function
     (authorizes the session, returns a short-lived signed URL). */
  function openFieldPdf(id) {
    var s = getSession(); if (!s || !s.session) return;
    fetch(C.creekside.url + '/functions/v1/field-pdf', {
      method: 'POST',
      headers: { apikey: C.creekside.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'url', token: s.session, id: id })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.url) window.open(j.url, '_blank', 'noopener');
      else toast('Could not open PDF');
    }).catch(function () { toast('Could not open PDF'); });
  }

  /* All activity timestamps display in Indiana time regardless of the viewer's
     device or server timezone. Storage stays UTC; this is display-layer only.
     Date-only strings ("2026-08-25") are calendar dates — never TZ-shifted. */
  var TZ = 'America/Indiana/Indianapolis';
  function tzDate(t) {
    return new Date(t).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
  }
  function tzTime(t) {
    return new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  }
  function tzDateTime(t) { return tzDate(t) + ' · ' + tzTime(t); }
  function tzDayStr(t) {   // YYYY-MM-DD as it reads in Indiana, for filters/sorts
    return new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
  }
  /* Safety reports: submitted_at (UTC timestamptz) is authoritative; the stored
     report_date is the UTC calendar day at insert and reads one day ahead during
     Indiana evenings. Rows without submitted_at fall back to report_date. */
  function repDay(r) { return r.submitted_at ? tzDayStr(r.submitted_at) : (r.report_date || ''); }
  function repDateDisp(r) { return r.submitted_at ? tzDate(r.submitted_at) : repDateDisp(r); }
  function fmtDate(d) {
    if (!d) return '—';
    if (String(d).length <= 10) {
      var x = new Date(d + 'T12:00:00');
      return isNaN(x) ? String(d) : x.toLocaleDateString('en-US',
        { month: 'short', day: 'numeric', year: 'numeric' });
    }
    var y = new Date(d);
    return isNaN(y) ? String(d) : tzDate(y);
  }
  /* Permits show a clock time, not a live countdown. The countdown read as
     fussy; what a superintendent needs is "when does this die" plus a flag if
     that is soon. Precision below the minute helps nobody. */
  function fmtTime(t) {
    if (!t) return '—';
    return tzTime(t);
  }
  function fmtWhen(t) {
    if (!t) return '—';
    var same = tzDayStr(t) === tzDayStr(new Date());
    return (same ? 'Today' : new Date(t).toLocaleDateString('en-US',
      { timeZone: TZ, month: 'short', day: 'numeric' })) + ' ' + fmtTime(t);
  }
  function minsLeft(p) {
    return p.expires_at ? Math.round((new Date(p.expires_at) - new Date()) / 60000) : null;
  }
  function jobName(id) {
    var j = (B.jobs || []).filter(function (x) { return x.id === id; })[0];
    return j ? j.name : '—';
  }
  function jobNum(id) {
    var j = (B.jobs || []).filter(function (x) { return x.id === id; })[0];
    return j ? j.job_number : '';
  }
  function subName(id) {
    var s = (B.subs || []).filter(function (x) { return x.id === id; })[0];
    return s ? s.name : '—';
  }
  function permitLabel(code) {
    var t = (B.permit_types || []).filter(function (x) { return x.code === code; })[0];
    return t ? t.label : code;
  }
  function pill(cls, txt) { return '<span class="pill ' + cls + '">' + esc(txt) + '</span>'; }

  /* ---- Shared assignment layer (first-completion-wins) -------------------
     One field task can be sent to several recipients; the invites/sends share
     an assignment_id and only ONE completion is required. A legacy send with no
     assignment_id is its own single-recipient assignment. Display-only here —
     the first-wins guard itself lives in the demo submit handler. Orientation
     never uses this. */
  function asgId(rec) { return rec.assignment_id || rec.id; }
  function asgGroup(arr, id) { return (arr || []).filter(function (r) { return (r.assignment_id || r.id) === id; }); }
  function asgWinner(group) { return group.filter(function (r) { return r.submitted_at; })[0] || null; }
  function asgComplete(group) { return !!asgWinner(group); }
  function sendName(r) { return r.name || r.recipient || '—'; }
  // Collapse a send array into one entry per assignment, first occurrence order.
  function groupAssignments(arr) {
    var by = {}, order = [];
    (arr || []).forEach(function (r) { var id = asgId(r); if (!by[id]) { by[id] = []; order.push(id); } by[id].push(r); });
    return order.map(function (id) { return { id: id, group: by[id] }; });
  }
  function asgOpenedCount(group) { return group.filter(function (r) { return r.opened_at; }).length; }
  // Derived per-recipient delivery state (never mutates submitted_at).
  function sendState(r, group) {
    if (r.submitted_at) return { label: 'Submitted', cls: 'p-ok' };
    if (asgComplete(group)) return { label: 'Completed by crew', cls: 'p-grey' };
    if (r.opened_at) return { label: 'Opened, not submitted', cls: 'p-warn' };
    return { label: 'Sent', cls: 'p-grey' };
  }
  // Awaiting-Submission rows for one send array, grouped by assignment (one row
  // per OUTSTANDING assignment). Multi-recipient assignments collapse to a
  // single row; single-recipient (incl. legacy) still show the recipient name.
  function awaitingRows(arr, kind, recordFn, q) {
    return groupAssignments(arr)
      .filter(function (g) { return !asgComplete(g.group); })
      .filter(function (g) { var rep = g.group[0];
        return has(g.group.map(sendName).join(' ') + ' ' + recordFn(rep) + ' ' + (rep.job_id ? jobName(rep.job_id) : ''), q); })
      .map(function (g) {
        var grp = g.group, rep = grp[0], multi = grp.length > 1, opened = asgOpenedCount(grp);
        var sentTo = multi ? (grp.length + ' recipients') : sendName(rep);
        var openedCell = multi ? (opened + ' of ' + grp.length + ' opened')
          : (rep.opened_at ? esc(fmtWhen(rep.opened_at)) : '<span class="muted">Not yet</span>');
        var statusPill = multi ? pill('p-warn', 'Awaiting Submission')
          : (rep.opened_at ? pill('p-warn', 'Opened, not submitted') : pill('p-grey', 'Sent'));
        return '<tr class="click" data-asg="' + kind + '|' + esc(g.id) + '">' +
          '<td><span class="t-main">' + esc(sentTo) + '</span>' + (!multi && rep.phone ? '<div class="t-sub num">' + esc(rep.phone) + '</div>' : '') + '</td>' +
          '<td>' + esc(recordFn(rep)) + '</td>' +
          '<td>' + (rep.job_id ? esc(jobName(rep.job_id)) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + esc(fmtWhen(rep.sent_at)) + '</td>' +
          '<td>' + openedCell + '</td>' +
          '<td class="r">' + statusPill + '</td></tr>';
      });
  }
  // Delivery-summary block for a shared assignment, reused inside completed
  // record details. Empty for single-recipient assignments (nothing to add).
  function assignmentDeliveryHtml(kind, assignmentId) {
    if (!assignmentId) return '';
    var arr = kind === 'toolbox' ? B.talk_sends : kind === 'permit' ? B.permit_sends : B.invites;
    var group = asgGroup(arr, assignmentId);
    if (group.length < 2) return '';
    var winner = asgWinner(group);
    return '<div class="sec-h">Delivery activity</div>' +
      kv('Sent to', group.length + ' recipients') +
      kv('Opened', asgOpenedCount(group) + ' of ' + group.length) +
      (winner ? kv('Submitted by', winner.submitted_by || sendName(winner)) + kv('Submitted', fmtWhen(winner.submitted_at)) : '');
  }
  // Assignment detail drawer — one form task, its recipients, and their real
  // individual delivery states. Non-submitters on a completed assignment read
  // "Completed by crew" (derived; their submitted_at stays null).
  function openAssignment(kind, id) {
    var arr = kind === 'toolbox' ? B.talk_sends : kind === 'permit' ? B.permit_sends : B.invites;
    var group = asgGroup(arr, id);
    if (!group.length) return;
    var rep = group[0], multi = group.length > 1;
    var recordFn = kind === 'toolbox' ? function (s) { return s.topic; }
      : kind === 'permit' ? function (s) { return permitLabel(s.type); }
      : function (v) { return (v.templates || []).join(', '); };
    var kindLabel = kind === 'toolbox' ? 'Toolbox talk' : kind === 'permit' ? 'Permit' : 'Inspection / JHA';
    var title = recordFn(rep) || '—', winner = asgWinner(group), complete = !!winner, opened = asgOpenedCount(group);
    var h = '<div style="margin-bottom:12px">' + (complete ? pill('p-ok', 'Completed') : pill('p-warn', 'Awaiting Submission')) + '</div>';
    h += '<div class="sec-h">Assignment</div>' +
      kv('Form', title) + kv('Type', kindLabel) +
      kv('Jobsite', rep.job_id ? jobName(rep.job_id) : 'Company-wide / —') +
      kv('Status', complete ? 'Completed' : 'Awaiting Submission', !complete);
    h += '<div class="sec-h">Delivery summary</div>' +
      kv('Sent to', group.length + (group.length === 1 ? ' recipient' : ' recipients')) +
      kv('Opened', opened + ' of ' + group.length) +
      kv('Submitted', (complete ? 1 : 0) + ' of ' + group.length);
    if (complete) h += kv('Completed by', winner.submitted_by || sendName(winner)) + kv('Completed', fmtWhen(winner.submitted_at));
    h += '<div class="sec-h">Recipients</div>';
    group.forEach(function (r) {
      var stt = sendState(r, group);
      var sub = r.submitted_at ? ('Submitted · ' + fmtWhen(r.submitted_at))
        : r.opened_at ? ('Opened · ' + fmtWhen(r.opened_at)) : 'Sent · Not opened';
      h += '<div class="kv"><span class="k">' + esc(sendName(r)) +
        (r.phone ? ' <span class="small muted num">' + esc(r.phone) + '</span>' : '') +
        '<div class="small muted">' + esc(sub) + '</div></span>' + pill(stt.cls, stt.label) + '</div>';
    });
    drawer(title, kindLabel + (multi ? ' · ' + group.length + ' recipients' : (' · ' + sendName(rep))), h);
  }
  function toast(msg) {
    var t = el('div', 'toast', msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }

  /* ---------- counts that drive the nav badges --------------------------- */
  function counts() {
    var permits   = B.permits   || [];
    var incidents = B.incidents || [];
    var sc        = B.scorecard || [];
    var active = permits.filter(function (p) { return p.status === 'active'; });
    return {
      permitsPending: permits.filter(function (p) { return p.status === 'pending'; }).length,
      permitsSoon:    active.filter(function (p) { return minsLeft(p) <= 60; }).length,
      permitsActive:  active.length,
      incOpen:  incidents.filter(function (i) { return i.status === 'investigating' && i.classification !== 'near_miss'; }).length,
      caOpen:   incidents.reduce(function (a, i) {
                  return a + i.corrective.filter(function (c) { return c.status === 'open'; }).length; }, 0),
      subsBlocked: sc.filter(function (x) { return !x.cleared; }).length,
      findOpen: (B.findings || []).filter(function (f) { return f.status === 'open'; }).length,
      notAuth: workerRoster().filter(function (w) { return !w.authorized; }).length,
      equipDue: (B.equipment || []).filter(function (e) { return equipStatus(e).k !== 'ok'; }).length
    };
  }

  /* ---------- orientation / authorization --------------------------------
     Derived, never entered daily: a worker is authorized when their
     orientation is current and no cert on file is expired. */
  function workerRoster() {
    var out = [];
    (B.subs || []).forEach(function (s) {
      (s.crew || []).forEach(function (w) {
        var oDays = w.orient_expires
          ? Math.round((new Date(w.orient_expires + 'T12:00:00') - new Date()) / 86400000)
          : null;
        var expiredCerts = (w.certs || []).filter(function (c) {
          return Math.round((new Date(c.exp + 'T12:00:00') - new Date()) / 86400000) < 0;
        });
        var why = [];
        if (!w.oriented) why.push('Not oriented');
        else if (oDays !== null && oDays < 0) why.push('Orientation expired');
        expiredCerts.forEach(function (c) { why.push(c.t + ' expired'); });
        out.push({ id: w.id, type: 'external', sub: s, w: w, orient_days: oDays,
                   expired_certs: expiredCerts, authorized: why.length === 0, why: why });
      });
    });
    return out.sort(function (a, b) { return (a.authorized ? 1 : 0) - (b.authorized ? 1 : 0); });
  }
  function catName(key) {
    var hit = (B.hazcats || []).filter(function (c) { return c[0] === key; })[0];
    return hit ? hit[1] : key;
  }

  /* ---------- nav --------------------------------------------------------- */
  /* Grouped the way the work actually flows: what came in from the field
     today, then the program you manage on top of it, then configuration.
     Overview sits alone at the top — it is the landing page, not a sibling. */
  var PAGES = [
    { id: 'overview',  label: 'Overview',        group: '' },
    { id: 'analytics', label: 'Analytics',       group: '' },
    { id: 'obs',       label: 'Safety Inspections', group: 'Field work' },
    { id: 'insp',      label: 'Inspections',     group: 'Field work' },
    { id: 'equipment', label: 'Equipment',       group: 'Field work', badge: 'equipDue', warn: true },
    { id: 'permits',   label: 'Permits',         group: 'Field work', badge: 'permitsSoon' },
    { id: 'talks',     label: 'Toolbox Talks',   group: 'Field work' },
    { id: 'incidents', label: 'Incidents',       group: 'Safety program', badge: 'incOpen', warn: true },
    { id: 'nearmiss',  label: 'Near Misses',     group: 'Safety program' },
    { id: 'subs',      label: 'Subcontractors',  group: 'Safety program', badge: 'subsBlocked' },
    { id: 'orient',    label: 'Orientation',     group: 'Safety program', badge: 'notAuth' },
    { id: 'training',  label: 'Training',        group: 'Safety program' },
    { id: 'docs',      label: 'Documents',       group: 'Safety program' },
    { id: 'automations', label: 'Automations',   group: 'Setup' },
    { id: 'jobs',      label: 'Jobs',            group: 'Setup' },
    { id: 'templates', label: 'Templates',       group: 'Setup' }
  ];
  var page = 'overview';

  /* ====================== AUTOMATIONS ================================== */
  /* Same shape as the consulting-firm software: scheduled inspection texts +
     the full send log. In a live build Twilio sends these; here it's demo
     data so the tab reads identically. */
  /* ---- Automations: multi-workflow delivery control center ---------------
     kind ∈ inspection|toolbox|orientation|permit (missing = inspection).
     Automation STATUS (running/paused/archived) is kept strictly separate from
     DELIVERY STATUS (sent/opened/submitted/failed/replaced). Equipment is out —
     it uses physical QR, never a scheduled send. */
  var autoTab = 'active';
  var autoCat = 'all';                                   // category filter in the active view
  var autoLogF = { q: '', type: '', job: '', status: '' };
  var AUTO_KIND_LABEL = { inspection: 'Inspection', toolbox: 'Toolbox Talk', orientation: 'Orientation', permit: 'Permit' };
  function autoKind(s) { return s.kind || 'inspection'; }
  function autoKindLabel(k) { return AUTO_KIND_LABEL[k] || 'Inspection'; }
  function autoTypePill(k) { return pill('p-grey', autoKindLabel(k)); }
  function autoFdate(x) { return new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function schRecips(s) {
    if (s.recipients && s.recipients.length) return s.recipients;
    if (s.to_name || s.to_phone) return [{ name: s.to_name, phone: s.to_phone }];
    return [];
  }
  function autoScope(s) {
    if (s.scope === 'company') return 'Company-wide';
    return s.job || (s.job_id ? jobName(s.job_id) : '—');
  }
  function autoRecipText(s) {
    if (autoKind(s) === 'orientation' && s.audience) return s.audience;
    var rs = schRecips(s);
    if (!rs.length) return '—';
    return rs.length > 1 ? (rs.length + ' recipients') : (rs[0].name || rs[0].phone || '—');
  }
  function autoTemplateName(s) {
    var k = autoKind(s);
    if (k === 'orientation' && s.template) return orientTplName(s.template) !== s.template ? orientTplName(s.template) : s.template;
    if (s.template) return s.template;
    if (s.forms && s.forms.length) return s.forms.join(', ');
    return '—';
  }
  function autoNextRun(s) {
    var ds = autoDerivedStatus(s);
    if (ds === 'completed' || ds === 'finishing') return '<span class="muted">—</span>';
    if (!s.active) return pill('p-grey', 'Paused');
    if (s.trigger || !s.next_run) return '<span class="muted">Trigger-based</span>';
    return esc(autoFdate(s.next_run));
  }

  /* ---- Toolbox Talk SERIES (mode:'series') --------------------------------
     Ordered list of talk-template codes; one talk per run, runs once through.
     Sent/completion is DERIVED from TALK_SENDS matched by automation_id +
     series_pos. Completed = every item sent AND submitted. Not a rotation. */
  function isSeries(s) { return autoKind(s) === 'toolbox' && s.mode === 'series'; }
  function talkTplTopic(code) {
    var t = (B.talk_templates || []).filter(function (x) { return x.id === code; })[0];
    return t ? t.topic : code;
  }
  function seriesProgress(s) {
    var sends = (B.talk_sends || []).filter(function (t) { return t.automation_id === s.id; });
    var upNextPos = null;
    var items = (s.series_items || []).map(function (it, i) {
      var send = sends.filter(function (t) { return t.series_pos === (i + 1); })[0] || null;
      if (!send && upNextPos === null) upNextPos = i + 1;
      return { pos: i + 1, code: it.code, topic: talkTplTopic(it.code), send: send };
    });
    items.forEach(function (it) {
      if (it.send) {
        it.delivery = 'Sent';
        it.completion = it.send.submitted_at ? 'Completed' : it.send.opened_at ? 'Opened' : 'Awaiting';
      } else {
        it.delivery = it.pos === upNextPos ? 'Up Next' : 'Queued';
        it.completion = '—';
      }
    });
    var sent = items.filter(function (it) { return it.send; }).length;
    var completed = items.filter(function (it) { return it.send && it.send.submitted_at; }).length;
    return { total: items.length, sent: sent, completed: completed, awaiting: sent - completed,
      items: items, upNext: upNextPos ? items[upNextPos - 1] : null };
  }
  // Derived automation status. Non-series behaves exactly as before (active?running:paused).
  function autoDerivedStatus(s) {
    if (s.archived) return 'archived';
    if (isSeries(s)) {
      var p = seriesProgress(s);
      if (p.total && p.sent === p.total && p.completed === p.total) return 'completed';
      if (p.total && p.sent === p.total && p.completed < p.total) return s.active ? 'finishing' : 'paused';
    }
    return s.active ? 'running' : 'paused';
  }
  function autoStatusPill(ds) {
    return ds === 'running' ? pill('p-ok', 'Running') : ds === 'paused' ? pill('p-warn', 'Paused')
      : ds === 'finishing' ? pill('p-warn', 'Finishing') : ds === 'completed' ? pill('p-ok', 'Completed')
      : pill('p-grey', 'Archived');
  }

  // Delivery STATUS pill (distinct from automation status).
  function normDeliv(raw) {
    return raw === 'completed' ? 'Submitted' : raw === 'opened' ? 'Opened' : raw === 'sent' ? 'Sent'
      : raw === 'failed' ? 'Failed' : raw === 'replaced' ? 'Replaced' : (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Sent');
  }
  function delivStatusPill(st) {
    var m = { Sent: 'p-grey', Opened: 'p-warn', Submitted: 'p-ok', Failed: 'p-bad', Replaced: 'p-warn' };
    return pill(m[st] || 'p-grey', st);
  }

  /* Unified delivery log — a derived VIEW over the source send datasets. The
     source arrays (INVITES / TALK_SENDS / PERMIT_SENDS / ORIENTATION_SENDS /
     SEND_LOG) are never merged or mutated here. */
  function buildDeliveryLog() {
    var out = [];
    (B.invites || []).forEach(function (v) {
      out.push({ src: 'invite', type: 'inspection', record: (v.templates || []).join(', ') || 'Inspection',
        recipient: v.name, phone: v.phone, job_id: null, sent: v.sent_at, opened: v.opened_at,
        submitted: v.submitted_at, status: normDeliv(v.status), raw: v });
    });
    (B.talk_sends || []).forEach(function (t) {
      out.push({ src: 'talk', type: 'toolbox', record: t.topic || 'Toolbox talk', recipient: t.recipient,
        phone: t.phone, job_id: t.job_id, sent: t.sent_at, opened: t.opened_at, submitted: t.submitted_at,
        status: normDeliv(t.status), raw: t });
    });
    (B.permit_sends || []).forEach(function (p) {
      out.push({ src: 'permit', type: 'permit', record: permitLabel(p.type), recipient: p.recipient,
        phone: p.phone, job_id: p.job_id, sent: p.sent_at, opened: p.opened_at, submitted: p.submitted_at,
        status: normDeliv(p.status), raw: p });
    });
    (B.orientation_sends || []).forEach(function (o) {
      out.push({ src: 'orient', type: 'orientation', record: orientTplName(o.template_id), recipient: o.recipient,
        phone: o.phone, job_id: o.job_id, sent: o.sent_at, opened: o.opened_at, submitted: o.submitted_at,
        status: normDeliv(o.status), raw: o });
    });
    // Legacy transport log: keep only failed / replaced events not represented above.
    (B.send_log || []).forEach(function (x) {
      if (x.result === 'failed' || x.result === 'replaced') {
        out.push({ src: 'log', type: 'other', record: (x.msg || '').split(':')[0] || 'Message', recipient: x.to,
          phone: x.to, job_id: null, sent: x.when, opened: null, submitted: null,
          status: normDeliv(x.result), detail: x.detail, raw: x, legacy: true });
      }
    });
    return out.sort(function (a, b) { return new Date(b.sent) - new Date(a.sent); });
  }
  // Recent delivery activity for one automation — SAFE matching only (same type,
  // and same job or same named recipient). Ambiguous → empty (caller shows a note).
  function autoActivity(s) {
    var k = autoKind(s);
    var names = schRecips(s).map(function (r) { return (r.name || '').toLowerCase(); }).filter(Boolean);
    return buildDeliveryLog().filter(function (row) {
      if (row.type !== k) return false;
      var jobMatch = s.job_id && row.job_id && row.job_id === s.job_id;
      var recipMatch = row.recipient && names.indexOf(row.recipient.toLowerCase()) !== -1;
      return jobMatch || recipMatch;
    }).slice(0, 4);
  }

  function pgAutomations() {
    var sch = B.schedules || [], log = B.send_log || [];
    var right = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">' +
      subtabs(autoTab, [['active', 'Automations'], ['log', 'Send Log'], ['archive', 'Archive']], 'au') +
      (autoTab === 'active' ? '<button class="btn btn-gold" id="auto-new-btn">New automation</button>' : '') + '</div>';
    var html = head('Automations',
      'Schedule and manage safety forms, toolbox talks, orientations and permits sent to the field.', right);

    if (autoTab === 'active') {
      var active = sch.filter(function (s) { return !s.archived; });
      var running = active.filter(function (s) { return autoDerivedStatus(s) === 'running'; }).length;
      var paused = active.filter(function (s) { return autoDerivedStatus(s) === 'paused'; }).length;
      var dlog = buildDeliveryLog();
      var sent7 = dlog.filter(function (r) {
        return r.type !== 'other' && (Date.now() - new Date(r.sent)) < 7 * 864e5; }).length;
      var attention = dlog.filter(function (r) { return r.status === 'Failed'; }).length;
      html += '<div class="cards">' +
        kpi(running, 'running', 'sending automatically', running ? 'c-ok' : 'c-grey') +
        kpi(paused, 'paused', paused ? 'not sending' : 'none paused', paused ? 'c-warn' : 'c-grey') +
        kpi(sent7, 'sent this week', 'across all automations', 'c-grey') +
        kpi(attention, 'needs attention', attention ? 'delivery failures' : 'no delivery issues', attention ? 'c-bad' : 'c-ok') +
        '</div>';

      // Category segment
      var cats = [['all', 'All'], ['inspection', 'Inspections'], ['toolbox', 'Toolbox Talks'],
        ['orientation', 'Orientations'], ['permit', 'Permits']];
      html += '<div class="fbar" style="margin-bottom:12px">' + cats.map(function (c) {
        return '<button class="btn btn-sm' + (autoCat === c[0] ? ' btn-gold' : '') + '" data-cat="' + c[0] + '">' + esc(c[1]) + '</button>';
      }).join('') + '</div>';

      var shown = active.filter(function (s) { return autoCat === 'all' || autoKind(s) === autoCat; });
      // Running, then Finishing, then Paused, then Completed; scheduled before trigger-based.
      var statRank = { running: 0, finishing: 1, paused: 2, completed: 3 };
      shown.sort(function (a, b) {
        var ra = statRank[autoDerivedStatus(a)] || 0, rb = statRank[autoDerivedStatus(b)] || 0;
        if (ra !== rb) return ra - rb;
        var ad = (a.trigger || !a.next_run), bd = (b.trigger || !b.next_run);
        if (ad !== bd) return ad ? 1 : -1;
        if (!ad) return new Date(a.next_run) - new Date(b.next_run);
        return 0;
      });
      var srows = shown.map(function (s) {
        var i = sch.indexOf(s);
        var sub = '';
        if (isSeries(s)) { var p = seriesProgress(s); sub = '<div class="t-sub">' + p.completed + ' of ' + p.total + ' completed</div>'; }
        return '<tr class="click" data-auto="' + i + '">' +
          '<td><span class="t-main">' + esc(s.name || autoTemplateName(s)) + '</span>' + sub + '</td>' +
          '<td>' + autoTypePill(autoKind(s)) + (isSeries(s) ? ' <span class="small muted">Series</span>' : '') + '</td>' +
          '<td>' + esc(autoScope(s)) + '</td>' +
          '<td>' + esc(autoRecipText(s)) + '</td>' +
          '<td>' + esc(s.cadence || '—') + '</td>' +
          '<td>' + autoNextRun(s) + '</td>' +
          '<td class="r">' + autoStatusPill(autoDerivedStatus(s)) + '</td></tr>';
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>Automations</h3>' +
        '<div class="sub">' + shown.length + ' automation' + (shown.length === 1 ? '' : 's') +
        ' · click one to view, pause, resume or archive it.</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: 'Automation' }, { t: 'Type' }, { t: 'Job / Scope' }, { t: 'Recipient(s)' }, { t: 'Schedule' },
         { t: 'Next run' }, { t: 'Status', r: 1 }], srows,
        autoCat === 'all' ? 'No automations yet. Create one to start scheduled sends.' : 'No automations in this category.') +
        '</div></div>';

    } else if (autoTab === 'log') {
      var rows0 = buildDeliveryLog();
      var q = (autoLogF.q || '').toLowerCase();
      var rows = rows0.filter(function (r) {
        if (autoLogF.type && r.type !== autoLogF.type) return false;
        if (autoLogF.job && r.job_id !== autoLogF.job) return false;
        if (autoLogF.status && r.status !== autoLogF.status) return false;
        return has((r.record || '') + ' ' + (r.recipient || '') + ' ' + (r.job_id ? jobName(r.job_id) : ''), q);
      });
      var jobIds = {}; rows0.forEach(function (r) { if (r.job_id) jobIds[r.job_id] = true; });
      var typeOpts = [['', 'All types'], ['inspection', 'Inspection'], ['toolbox', 'Toolbox Talk'],
        ['orientation', 'Orientation'], ['permit', 'Permit'], ['other', 'Other']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (autoLogF.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      var jobOpts = Object.keys(jobIds).map(function (jid) {
        return '<option value="' + esc(jid) + '"' + (autoLogF.job === jid ? ' selected' : '') + '>' + esc(jobName(jid)) + '</option>'; }).join('');
      var statOpts = [['', 'Any status'], ['Sent', 'Sent'], ['Opened', 'Opened'], ['Submitted', 'Submitted'],
        ['Failed', 'Failed'], ['Replaced', 'Replaced']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (autoLogF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="al-q" placeholder="Search record, recipient or jobsite…" value="' + esc(autoLogF.q) + '"></div>' +
        '<select id="al-type">' + typeOpts + '</select>' +
        '<select id="al-job"><option value="">All jobsites</option>' + jobOpts + '</select>' +
        '<select id="al-status">' + statOpts + '</select></div>';
      var lrows = rows.map(function (r, i) {
        return '<tr class="click" data-deliv="' + i + '">' +
          '<td>' + esc(fmtWhen(r.sent)) + '</td>' +
          '<td>' + (r.type === 'other' ? pill('p-grey', 'Other') : autoTypePill(r.type)) + '</td>' +
          '<td><span class="t-main">' + esc(r.record || '—') + '</span></td>' +
          '<td>' + esc(r.recipient || '—') + '</td>' +
          '<td>' + (r.job_id ? esc(jobName(r.job_id)) : '<span class="muted">—</span>') + '</td>' +
          '<td class="r">' + delivStatusPill(r.status) + '</td></tr>';
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>Safety Delivery Log</h3>' +
        '<div class="sub">Every safety item sent to the field, including delivery and completion status.</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: 'Sent' }, { t: 'Type' }, { t: 'Record' }, { t: 'Recipient' }, { t: 'Jobsite' }, { t: 'Delivery', r: 1 }],
        lrows, 'No delivery records match.') + '</div></div>';
      window.__auLog = rows;   // for row click resolution

    } else {
      var aq = (subQ.autoArch || '').toLowerCase();
      var archSch = sch.filter(function (s) {
        return s.archived && has((s.name || '') + ' ' + (s.job || '') + ' ' + autoKindLabel(autoKind(s)), aq); });
      var archLog = log.filter(function (x) { return x.archived && has((x.to || '') + ' ' + (x.msg || ''), aq); });
      html += fbarSearch('auarch-q', subQ.autoArch, 'Search archive…');
      var arows = archSch.map(function (s) {
        var i = sch.indexOf(s);
        return '<tr class="click" data-auto="' + i + '">' +
          '<td><span class="t-main">' + esc(s.name || autoTemplateName(s)) + '</span></td>' +
          '<td>' + autoTypePill(autoKind(s)) + '</td>' +
          '<td>' + esc(autoScope(s)) + '</td>' +
          '<td>' + esc(s.cadence || '—') + '</td>' +
          '<td>' + esc(s.archived_at ? autoFdate(s.archived_at) : '—') + '</td>' +
          '<td class="r"><button class="btn btn-sm" data-unarch="' + i + '">Restore</button></td></tr>';
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>Archived automations</h3>' +
        '<div class="sub">Kept for the record. Restore one to put it back in the active list.</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: 'Automation' }, { t: 'Type' }, { t: 'Job / Scope' }, { t: 'Schedule' }, { t: 'Archived' }, { t: '', r: 1 }],
        arows, 'Nothing archived yet.') + '</div></div>';
      var lrows2 = archLog.map(function (x) {
        var i = log.indexOf(x);
        return '<tr>' +
          '<td>' + esc(autoFdate(x.when)) + '</td>' +
          '<td>' + pill('p-grey', 'Other') + '</td>' +
          '<td class="muted small" style="max-width:300px">' + esc(x.msg) + '</td>' +
          '<td>' + esc(x.to) + '</td>' +
          '<td class="r">' + delivStatusPill(normDeliv(x.result)) +
            '<button class="btn btn-sm" data-lunarch="' + i + '" style="margin-left:8px">Restore</button></td></tr>';
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>Archived send records</h3>' +
        '<div class="sub">Send-log entries moved out of the active log. Kept as history.</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: 'Sent' }, { t: 'Type' }, { t: 'Record' }, { t: 'Recipient' }, { t: 'Delivery', r: 1 }],
        lrows2, 'Nothing archived yet.') + '</div></div>';
    }

    paint(html);
    wireSubtabs('au', function (v) { autoTab = v; pgAutomations(); });
    var nb = $('#auto-new-btn'); if (nb) nb.onclick = function () { openAutomationForm(null); };
    $$('[data-cat]').forEach(function (b) { b.onclick = function () { autoCat = b.dataset.cat; pgAutomations(); }; });
    $$('[data-auto]').forEach(function (tr) { tr.onclick = function (e) {
      if (e.target.closest('[data-unarch]')) return;
      openAutomation(sch[+tr.dataset.auto]); }; });
    $$('[data-deliv]').forEach(function (tr) { tr.onclick = function () { openDeliveryDetail((window.__auLog || [])[+tr.dataset.deliv]); }; });
    $$('[data-unarch]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation();
      sch[+b.dataset.unarch].archived = false; toast('Automation restored.'); pgAutomations(); }; });
    $$('[data-lunarch]').forEach(function (b) { b.onclick = function () { log[+b.dataset.lunarch].archived = false; pgAutomations(); }; });
    if (autoTab === 'log') {
      var alq = $('#al-q'); if (alq) alq.oninput = function () { autoLogF.q = alq.value; pgAutomations(); };
      var alt = $('#al-type'); if (alt) alt.onchange = function () { autoLogF.type = alt.value; pgAutomations(); };
      var alj = $('#al-job'); if (alj) alj.onchange = function () { autoLogF.job = alj.value; pgAutomations(); };
      var als = $('#al-status'); if (als) als.onchange = function () { autoLogF.status = als.value; pgAutomations(); };
      var _alq = $('#al-q'); if (_alq && autoLogF.q) { _alq.focus(); try { _alq.setSelectionRange(_alq.value.length, _alq.value.length); } catch (e) {} }
    }
    if (autoTab === 'archive') wireSearch('auarch-q', function (v) { subQ.autoArch = v; pgAutomations(); });
  }

  // Automation detail — name, status, type, template, scope, recipients,
  // schedule/trigger, next run, safe recent activity, and status actions.
  function openAutomation(s) {
    if (!s) return;
    var k = autoKind(s), ds = autoDerivedStatus(s), series = isSeries(s);
    var h = '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">' +
      autoStatusPill(ds) + autoTypePill(k) + (series ? ' <span class="small muted">Series</span>' : '') + '</div>';
    h += '<div class="sec-h">Automation</div>' +
      kv('Type', autoKindLabel(k) + (series ? ' Series' : '')) +
      (series ? kv('Talks in series', (s.series_items || []).length + ' talks')
              : kv(k === 'orientation' ? 'Orientation template' : k === 'permit' ? 'Permit' : k === 'toolbox' ? 'Toolbox talk' : 'Template / form', autoTemplateName(s))) +
      kv('Job / scope', autoScope(s)) +
      kv('Schedule / trigger', s.cadence || '—') +
      kv('Next run', autoNextRun(s).replace(/<[^>]+>/g, '') || '—');

    h += '<div class="sec-h">' + (series ? 'Audience' : 'Recipients') + '</div>';
    if (s.audience) h += '<div class="kv"><span class="k">Audience</span><span class="v">' + esc(s.audience) + '</span></div>';
    var rs = schRecips(s);
    if (!rs.length && !s.audience) h += '<div class="small muted">No named recipients.</div>';
    rs.forEach(function (r) {
      h += '<div class="kv"><span class="k">' + esc(r.name || 'Crew') + '</span>' +
        '<span class="v num">' + esc(r.phone || '—') + '</span></div>';
    });

    if (series) {
      var p = seriesProgress(s);
      h += '<div class="sec-h">Series progress</div>' +
        kv('Sent', p.sent + ' / ' + p.total) +
        kv('Completed', p.completed + ' / ' + p.total) +
        kv('Awaiting completion', String(p.awaiting), p.awaiting > 0);
      // Up next / finishing / complete
      h += '<div class="kv" style="border-bottom:none"><span class="k">Up next</span><span class="v">';
      if (ds === 'completed') h += 'Series complete';
      else if (p.upNext) h += esc(p.upNext.topic) + (s.next_run ? ' <span class="small muted">· ' + esc(autoFdate(s.next_run)) + '</span>' : '');
      else h += 'All talks sent — waiting on ' + p.awaiting + ' completion' + (p.awaiting === 1 ? '' : 's');
      h += '</span></div>';
      // Ordered talks table
      var trows = p.items.map(function (it) {
        var dpill = it.delivery === 'Sent' ? pill('p-grey', 'Sent')
          : it.delivery === 'Up Next' ? pill('p-warn', 'Up Next') : '<span class="muted">Queued</span>';
        var cpill = it.completion === 'Completed' ? pill('p-ok', 'Completed')
          : it.completion === 'Opened' ? pill('p-warn', 'Opened')
          : it.completion === 'Awaiting' ? pill('p-warn', 'Awaiting') : '<span class="muted">—</span>';
        return '<tr><td class="num">' + it.pos + '</td>' +
          '<td><span class="t-main">' + esc(it.topic) + '</span></td>' +
          '<td>' + dpill + '</td>' + '<td class="r">' + cpill + '</td></tr>';
      });
      h += '<div class="sec-h">Talks in series</div><div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: '#', }, { t: 'Toolbox Talk' }, { t: 'Delivery' }, { t: 'Completion', r: 1 }], trows) + '</div></div>';
    } else {
      h += '<div class="sec-h">Recent activity</div>';
      var acts = autoActivity(s);
      if (!acts.length) {
        h += '<div class="small muted">No linked activity available.</div>';
      } else {
        acts.forEach(function (a) {
          var flow = ['Sent'].concat(a.opened ? ['Opened'] : [], a.submitted ? ['Submitted'] : []);
          if (a.status === 'Failed' || a.status === 'Replaced') flow = [a.status];
          h += '<div class="kv"><span class="k">' + esc(fmtDate(a.sent)) +
            '<div class="small muted">' + esc(a.recipient || '') + '</div></span>' +
            '<span class="v" style="font-weight:400;font-size:12px">' + esc(flow.join(' → ')) + '</span></div>';
        });
      }
    }

    if (s.archived) {
      h += '<div style="margin-top:16px"><button class="btn btn-gold btn-sm" id="au-restore">Restore</button></div>';
    } else if (ds === 'completed') {
      h += '<div style="margin-top:16px"><button class="btn btn-sm" id="au-arch">Archive</button></div>' +
        '<p class="small muted" style="margin-top:.5rem">Series finished — every talk was sent and completed. Kept for the record.</p>';
    } else {
      h += '<div style="display:flex;gap:.5rem;margin-top:16px">' +
        '<button class="btn btn-sm" id="au-edit">Edit automation</button>' +
        '<button class="btn btn-sm" id="au-toggle">' + (s.active ? 'Pause' : 'Resume') + '</button>' +
        '<button class="btn btn-sm" id="au-arch">Archive</button></div>';
    }
    drawer(s.name || autoTemplateName(s), autoKindLabel(k) + (series ? ' Series' : '') + ' · ' + autoScope(s), h);
    var et = $('#au-edit'); if (et) et.onclick = function () { openAutomationForm(s); };
    var tg = $('#au-toggle'); if (tg) tg.onclick = function () {
      s.active = !s.active; toast(s.active ? 'Automation resumed.' : 'Automation paused.'); pgAutomations(); openAutomation(s); };
    var ar = $('#au-arch'); if (ar) ar.onclick = function () {
      s.archived = true; s.archived_at = new Date().toISOString().slice(0, 10); closeDrawer(); toast('Automation archived.'); pgAutomations(); };
    var rs2 = $('#au-restore'); if (rs2) rs2.onclick = function () {
      s.archived = false; closeDrawer(); toast('Automation restored.'); pgAutomations(); };
  }

  // Read-only delivery detail (unified Send Log row). No status mutation.
  function openDeliveryDetail(r) {
    if (!r) return;
    var h = '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">' +
      delivStatusPill(r.status) + (r.type === 'other' ? pill('p-grey', 'Other') : autoTypePill(r.type)) + '</div>';
    h += '<div class="sec-h">Record</div>' +
      kv('Record', r.record || '—') +
      kv('Type', r.type === 'other' ? 'Other' : autoKindLabel(r.type)) +
      kv('Jobsite', r.job_id ? jobName(r.job_id) : 'Company-wide / —');
    // Series association (safe: only when the send carries automation_id).
    if (r.raw && r.raw.automation_id) {
      var au = (B.schedules || []).filter(function (x) { return x.id === r.raw.automation_id; })[0];
      if (au) {
        h += kv('Automation', au.name || '—');
        if (r.raw.series_pos && isSeries(au)) h += kv('Series item', r.raw.series_pos + ' of ' + (au.series_items || []).length);
      }
    }
    h += '<div class="sec-h">Recipient</div>' +
      kv('Name', r.recipient || '—') +
      (r.phone ? kv('Phone', r.phone) : '');
    h += '<div class="sec-h">Delivery activity</div>';
    if (r.status === 'Failed') {
      h += kv('Attempted', fmtWhen(r.sent)) + kv('Status', 'Failed', true) +
        (r.detail ? kv('Detail', r.detail, true) : '');
    } else if (r.status === 'Replaced') {
      h += kv('Sent', fmtWhen(r.sent)) + kv('Status', 'Replaced') +
        (r.detail ? kv('Detail', r.detail) : kv('Detail', 'A newer link was sent'));
    } else {
      h += kv('Sent', fmtWhen(r.sent)) +
        kv('Opened', r.opened ? fmtWhen(r.opened) : 'Not opened') +
        kv('Submitted', r.submitted ? fmtWhen(r.submitted) : 'Awaiting submission') +
        '<div class="kv"><span class="k">Status</span>' + delivStatusPill(r.status) + '</div>';
    }
    drawer(r.record || 'Delivery', (r.type === 'other' ? 'Other' : autoKindLabel(r.type)) +
      (r.recipient ? ' · ' + r.recipient : ''), h);
  }

  /* New / edit automation — adaptive by type. Demo-only: cadence/trigger are
     descriptive strings; no scheduler or event engine is created. */
  var ORIENT_TRIGGERS = ['On worker added', 'On assignment', '30 days before expiration', 'Scheduled date'];

  /* ---- Structured schedule (demo, no backend) ----------------------------
     A recurring schedule is { type:'recurring', preset, days:['mon'…], time:'HH:MM' }.
     cadence text + next_run are DERIVED for display; legacy rows that carry only
     a cadence string still render via that string as fallback. */
  var DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_ABBR = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  var SCHED_PRESETS = [['weekdays', 'Every weekday'], ['everyday', 'Every day'], ['monday', 'Every Monday'], ['friday', 'Every Friday'], ['custom', 'Custom']];
  function presetDays(p) {
    return p === 'weekdays' ? ['mon', 'tue', 'wed', 'thu', 'fri']
      : p === 'everyday' ? DAY_KEYS.slice()
      : p === 'monday' ? ['mon'] : p === 'friday' ? ['fri'] : [];
  }
  function to12h(t) {
    if (!t || t.indexOf(':') < 0) return t || '';
    var p = t.split(':'), h = +p[0], m = p[1], ap = h < 12 ? 'AM' : 'PM', hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + m + ' ' + ap;
  }
  function sortDays(days) { return (days || []).slice().sort(function (a, b) { return DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b); }); }
  function schedDayLabel(days) {
    var d = sortDays(days);
    if (d.length === 7) return 'Every day';
    if (d.length === 5 && ['mon', 'tue', 'wed', 'thu', 'fri'].every(function (k) { return d.indexOf(k) > -1; })) return 'Mon–Fri';
    if (d.length === 1) return 'Every ' + DAY_ABBR[d[0]];
    return d.map(function (k) { return DAY_ABBR[k]; }).join(', ');
  }
  function cadenceFromSched(sched) {
    if (!sched || sched.type === 'trigger' || !(sched.days || []).length) return null;
    return schedDayLabel(sched.days) + ' · ' + to12h(sched.time || '08:00');
  }
  function cadenceSentence(sched) {
    var c = cadenceFromSched(sched); if (!c) return '';
    var parts = c.split(' · ');
    return parts[0].replace(/, ([^,]+)$/, ' and $1') + ' at ' + parts[1];
  }
  // Demo next-run: the next matching weekday/time strictly after now.
  function nextRunFromSched(sched) {
    if (!sched || sched.type === 'trigger' || !(sched.days || []).length) return null;
    var now = new Date(), hm = (sched.time || '08:00').split(':'), th = +hm[0], tm = +hm[1];
    var idxKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    for (var add = 0; add <= 7; add++) {
      var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, th, tm, 0, 0);
      if (sched.days.indexOf(idxKey[dt.getDay()]) > -1 && dt.getTime() > now.getTime()) return dt.toISOString().slice(0, 10);
    }
    return null;
  }
  // Best-effort parse of a legacy cadence string into a structured schedule.
  function parseCadence(str) {
    if (!str) return null;
    var time = '08:00', t12 = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(str), t24 = /(\d{1,2}):(\d{2})/.exec(str);
    if (t12) { var h = (+t12[1]) % 12; if (/PM/i.test(t12[3])) h += 12; time = (h < 10 ? '0' : '') + h + ':' + t12[2]; }
    else if (t24) { time = (t24[1].length < 2 ? '0' : '') + t24[1] + ':' + t24[2]; }
    var lo = str.toLowerCase();
    if (/every day/.test(lo)) return { type: 'recurring', preset: 'everyday', days: presetDays('everyday'), time: time };
    if (/weekday|mon.?fri/.test(lo)) return { type: 'recurring', preset: 'weekdays', days: presetDays('weekdays'), time: time };
    if (/every mon/.test(lo)) return { type: 'recurring', preset: 'monday', days: ['mon'], time: time };
    if (/every fri/.test(lo)) return { type: 'recurring', preset: 'friday', days: ['fri'], time: time };
    return null;
  }
  function schedFromExisting(ex) {
    if (ex && Array.isArray(ex.schedule_days) && ex.schedule_days.length) {
      return { type: ex.schedule_type || 'recurring', preset: ex.schedule_preset || 'custom',
        days: ex.schedule_days.slice(), time: ex.schedule_time || '08:00' };
    }
    if (ex && ex.trigger) return { type: 'trigger', preset: 'weekdays', days: presetDays('weekdays'), time: '08:00' };
    var parsed = ex && ex.cadence ? parseCadence(ex.cadence) : null;
    if (parsed) return parsed;
    return { type: 'recurring', preset: 'weekdays', days: presetDays('weekdays'), time: '08:00' };
  }
  // Real-SMS config, loaded from the Node server (server.js). formBaseUrl is a
  // phone-reachable base (LAN IP or public base) so texted field links open on a
  // real phone. When the demo is served statically (no server), enabled=false and
  // Send now honestly reports that messaging is not configured.
  var SMS_CFG = { loaded: false, enabled: false, formBaseUrl: '' };
  function loadSmsCfg(cb) {
    Promise.all([
      fetch('/api/demo-sms/status').then(function (r) { return r.json(); }).catch(function () { return { enabled: false }; }),
      fetch('/api/demo-config').then(function (r) { return r.json(); }).catch(function () { return { formBaseUrl: '' }; })
    ]).then(function (r) {
      SMS_CFG.enabled = !!(r[0] && r[0].enabled);
      SMS_CFG.formBaseUrl = (r[1] && r[1].formBaseUrl) || '';
      SMS_CFG.loaded = true; if (cb) cb();
    });
  }
  function copyText(txt, okMsg) {
    var done = function () { toast(okMsg); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(done);
    else { var t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); done(); }
  }
  function openAutomationForm(existing) {
    loadSmsCfg();   // refresh SMS availability + reachable base URL for Send once
    var editing = !!existing;
    var st = { kind: existing ? autoKind(existing) : 'inspection',
      name: existing ? (existing.name || '') : '',
      mode: existing ? (existing.mode || 'single') : 'single',
      once: false,   // 'Send once (now)' — a single immediate text, not a schedule

      series: existing && existing.series_items ? existing.series_items.slice() : [],
      recips: existing && existing.recipients ? existing.recipients.slice()
              : (existing && existing.to_name ? [{ name: existing.to_name, phone: existing.to_phone }] : []),
      sched: schedFromExisting(existing),
      // Orientation timing: preserve a legacy trigger; default new orientation to trigger.
      orientTiming: existing ? (existing.trigger ? 'trigger' : 'scheduled') : 'trigger',
      trigger: existing && existing.trigger ? existing.cadence : ORIENT_TRIGGERS[0] };
    // When editing an in-progress series, already-sent positions are locked so
    // history is never reordered (Part 13). Only queued items can move/remove.
    var lockedCount = (editing && isSeries(existing)) ? seriesProgress(existing).sent : 0;
    var contacts = (B.people || []).map(function (p) { return { name: p.name, phone: p.phone, tag: p.title }; })
      .concat((B.subs || []).map(function (s) { return { name: s.contact_name, phone: s.contact_phone, tag: s.name }; }));

    function tplOptions(sel) {
      var opts;
      if (st.kind === 'toolbox') opts = (B.talk_templates || []).map(function (t) { return t.topic; });
      else if (st.kind === 'orientation') opts = (B.templates || []).filter(function (t) { return t.family === 'orientation'; }).map(function (t) { return t.name; });
      else if (st.kind === 'permit') opts = (B.templates || []).filter(function (t) { return t.family === 'permit'; }).map(function (t) { return t.name; });
      else opts = (B.templates || []).filter(function (t) { return t.family === 'inspection'; }).map(function (t) { return t.name; });
      return opts.map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
    }
    function seriesBuilder() {
      var avail = (B.talk_templates || []).filter(function (t) { return st.series.every(function (x) { return x.code !== t.id; }); });
      var h = '<div class="f"><label>Talks in series <span class="small muted" style="text-transform:none;font-weight:400;letter-spacing:0">· one per scheduled run, in order</span></label>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px">' +
          '<select id="af-addtalk" style="flex:1">' + avail.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.topic) + '</option>'; }).join('') +
          (avail.length ? '' : '<option value="">All talks added</option>') + '</select>' +
          '<button type="button" class="btn btn-sm" id="af-talkadd">+ Add talk</button></div>';
      h += st.series.length ? st.series.map(function (it, i) {
        var locked = i < lockedCount;
        return '<div style="display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin-bottom:6px">' +
          '<span class="num" style="width:20px;flex:0 0 auto">' + (i + 1) + '</span>' +
          '<span style="flex:1;min-width:0">' + esc(talkTplTopic(it.code)) + (locked ? ' <span class="small muted">· sent</span>' : '') + '</span>' +
          (locked ? '' :
            '<button type="button" class="btn btn-sm" data-mvup="' + i + '"' + (i <= lockedCount ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" class="btn btn-sm" data-mvdn="' + i + '"' + (i >= st.series.length - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button type="button" class="linklike" data-rmtalk="' + i + '" style="color:var(--fail)">Remove</button>') +
          '</div>';
      }).join('') : '<span class="small muted">No talks yet — add at least two.</span>';
      return h + '</div>';
    }
    // Structured schedule picker: preset + optional custom days + time + summary.
    function scheduleUI() {
      var presetOpts = SCHED_PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (st.sched.preset === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('');
      var h = '<div class="f"><label for="af-preset">Schedule</label><select id="af-preset">' + presetOpts + '</select></div>';
      if (st.sched.preset === 'custom') {
        h += '<div class="f"><label>Days</label><div class="fbar" style="margin:0;flex-wrap:wrap">' +
          DAY_KEYS.map(function (dk) { return '<button type="button" class="btn btn-sm' + (st.sched.days.indexOf(dk) > -1 ? ' btn-gold' : '') + '" data-day="' + dk + '">' + DAY_ABBR[dk] + '</button>'; }).join('') +
          '</div></div>';
      }
      h += '<div class="f"><label for="af-time">Send time</label><input type="time" id="af-time" value="' + esc(st.sched.time || '08:00') + '"></div>';
      var cad = cadenceFromSched(st.sched);
      if (cad) h += '<p class="small muted" style="margin-top:-6px">Runs ' + esc(cadenceSentence(st.sched)) + '</p>';
      else if (st.sched.preset === 'custom') h += '<p class="small" style="color:var(--fail);margin-top:-6px">Select at least one day.</p>';
      return h;
    }
    function render() {
      var kseg = [['inspection', 'Inspection'], ['toolbox', 'Toolbox Talk'], ['orientation', 'Orientation'], ['permit', 'Permit']]
        .map(function (c) { return '<button type="button" class="btn btn-sm' + (st.kind === c[0] ? ' btn-gold' : '') + '" data-k="' + c[0] + '">' + esc(c[1]) + '</button>'; }).join('');
      var jobOpts = (st.kind === 'orientation' ? '<option value="company">Company-wide</option>' : '') +
        (B.jobs || []).map(function (j) {
          var selJ = existing && (existing.job === j.name);
          return '<option value="' + esc(j.id) + '|' + esc(j.name) + '|' + esc(j.job_number) + '"' + (selJ ? ' selected' : '') + '>' + esc(j.name) + '</option>'; }).join('');
      var tplLabel = st.kind === 'toolbox' ? 'Toolbox talk template' : st.kind === 'orientation' ? 'Orientation template'
        : st.kind === 'permit' ? 'Permit template' : 'Template / form';
      var curTpl = existing ? (existing.template || (existing.forms || [])[0] || '') : '';
      var series = st.kind === 'toolbox' && st.mode === 'series';
      var h = '<div class="f"><label>What are you automating?</label>' +
          '<div class="fbar" style="margin:0">' + kseg + '</div></div>' +
        (st.kind === 'toolbox' ? '<div class="f"><label>Mode</label><div class="fbar" style="margin:0">' +
          [['single', 'Single / Recurring Talk'], ['series', 'Talk Series']].map(function (m) {
            return '<button type="button" class="btn btn-sm' + (st.mode === m[0] ? ' btn-gold' : '') + '" data-mode="' + m[0] + '">' + esc(m[1]) + '</button>'; }).join('') + '</div></div>' : '') +
        '<div class="f"><label for="af-name">Automation name</label>' +
          '<input type="text" id="af-name" value="' + esc(st.name) + '" placeholder="' + (series ? 'e.g. 20-Day Crew Safety Series' : 'e.g. Daily JHA — Plainfield') + '"></div>' +
        (series ? seriesBuilder()
                : '<div class="f"><label for="af-tpl">' + tplLabel + '</label><select id="af-tpl">' + tplOptions(curTpl) + '</select></div>') +
        '<div class="f"><label for="af-job">' + (st.kind === 'orientation' ? 'Scope / jobsite' : 'Jobsite') + '</label><select id="af-job">' + jobOpts + '</select></div>';
      // Delivery: a recurring schedule (default) or a single immediate send.
      var canOnce = !(st.kind === 'toolbox' && st.mode === 'series');
      if (canOnce) {
        h += '<div class="f"><label>Delivery</label><div class="fbar" style="margin:0">' +
          [['schedule', 'Recurring schedule'], ['once', 'Send once (now)']].map(function (m) {
            return '<button type="button" class="btn btn-sm' + ((st.once ? 'once' : 'schedule') === m[0] ? ' btn-gold' : '') + '" data-deliv="' + m[0] + '">' + esc(m[1]) + '</button>'; }).join('') +
          '</div></div>';
      }
      if (canOnce && st.once) {
        h += '<p class="small muted" style="margin-top:-2px">Send once (now) texts one recipient a real SMS immediately (server-side Twilio) — it does not create a schedule.</p>' +
          '<div class="f"><label for="af-oncephone">Recipient</label>' +
            '<div style="display:flex;gap:6px">' +
              '<input id="af-oncename" placeholder="Name" style="flex:1">' +
              '<input id="af-oncephone" placeholder="317-555-0100" style="flex:1" inputmode="tel"></div>' +
            '<div class="small muted" style="margin-top:4px">Enter a real phone number. Seeded 555 demo contacts cannot receive a text.</div></div>' +
          '<div class="f"><label>Message preview</label><pre id="af-oncepreview" class="small" style="white-space:pre-wrap;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--bg);margin:0"></pre></div>' +
          '<div id="af-onceresult" class="small" style="margin-top:.2rem;min-height:1em"></div>';
      } else if (st.kind === 'orientation') {
        h += '<div class="f"><label for="af-aud">Audience</label><select id="af-aud">' +
          ['Selected worker(s)', 'New workers', 'Workers assigned to selected job'].map(function (a) {
            return '<option' + (existing && existing.audience === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select></div>' +
          '<div class="f"><label>Timing</label><div class="fbar" style="margin:0">' +
            [['scheduled', 'Scheduled'], ['trigger', 'Trigger-based']].map(function (t) {
              return '<button type="button" class="btn btn-sm' + (st.orientTiming === t[0] ? ' btn-gold' : '') + '" data-timing="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('') + '</div></div>';
        if (st.orientTiming === 'trigger') {
          h += '<div class="f"><label for="af-trig">Trigger</label><select id="af-trig">' +
            ORIENT_TRIGGERS.map(function (t) { return '<option' + (st.trigger === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>';
        } else {
          h += scheduleUI();
        }
      } else {
        h += '<div class="f"><label for="af-who">Recipient(s)</label>' +
          '<select id="af-who"><option value="">Pick from contacts…</option>' +
          contacts.map(function (c, i) { return '<option value="' + i + '">' + esc(c.name) + ' — ' + esc(c.tag) + '</option>'; }).join('') + '</select>' +
          '<div style="display:flex;gap:6px;margin-top:6px">' +
            '<input id="af-rname" placeholder="Name" style="flex:1">' +
            '<input id="af-rphone" placeholder="317-555-0100" style="flex:1" inputmode="tel">' +
            '<button type="button" class="btn btn-sm" id="af-radd">Add</button></div>' +
          '<div id="af-recips" style="margin-top:8px">' + (st.recips.length
            ? st.recips.map(function (r, i) { return '<span class="photochip" style="margin:0 6px 6px 0">' + esc(r.name || r.phone) +
                (r.phone ? ' · ' + esc(r.phone) : '') + ' <button type="button" data-rmr="' + i + '" style="border:none;background:none;color:var(--fail);cursor:pointer;font-size:14px">×</button></span>'; }).join('')
            : '<span class="small muted">No recipients yet.</span>') + '</div></div>' +
          scheduleUI();
      }
      h += '<p class="small" id="af-err" style="color:var(--fail);min-height:1em"></p>' +
        '<div style="display:flex;gap:.5rem">' +
          ((canOnce && st.once)
            ? '<button type="button" class="btn btn-gold" id="af-sendonce" style="flex:1;justify-content:center">Send now</button>'
            : '<button type="button" class="btn btn-gold" id="af-save" style="flex:1;justify-content:center">' + (editing ? 'Save changes' : 'Create automation') + '</button>') +
          '<button type="button" class="btn btn-out" id="af-cancel" style="flex:0 0 auto">Cancel</button></div>';
      drawer(editing ? 'Edit automation' : 'New automation', 'Demo — schedules and triggers are illustrative', h);
      wire();
    }
    // Preserve name + live schedule inputs across every re-render.
    function saveName() {
      var e = $('#af-name'); if (e) st.name = e.value;
      var te = $('#af-time'); if (te && te.value) st.sched.time = te.value;
      var tr = $('#af-trig'); if (tr) st.trigger = tr.value;
    }
    function wire() {
      $$('[data-k]').forEach(function (b) { b.onclick = function () { saveName(); st.kind = b.dataset.k; render(); }; });
      $$('[data-mode]').forEach(function (b) { b.onclick = function () { saveName(); st.mode = b.dataset.mode; render(); }; });
      $$('[data-timing]').forEach(function (b) { b.onclick = function () { saveName(); st.orientTiming = b.dataset.timing; render(); }; });
      $$('[data-deliv]').forEach(function (b) { b.onclick = function () { saveName(); st.once = (b.dataset.deliv === 'once'); render(); }; });
      if (st.once) {
        var onceTpl = function () { return $('#af-tpl') ? $('#af-tpl').value : ''; };
        var onceJob = function () { var jv = ($('#af-job').value || '').split('|'); return { id: jv[0] === 'company' ? null : (jv[0] || null), name: jv[0] === 'company' ? '' : (jv[1] || '') }; };
        var onceLink = function () {
          var j = onceJob(); var nm = ($('#af-oncename') && $('#af-oncename').value.trim()) || '';
          var q = 'k=' + encodeURIComponent(C.inspectKey);
          if (j.id) q += '&job=' + encodeURIComponent(j.id);
          if (nm) q += '&by=' + encodeURIComponent(nm);
          if (st.kind === 'toolbox') {
            // Toolbox talks use the existing ?talk=<id> route, not the checklist tpl route.
            var tk = (B.talk_templates || []).filter(function (t) { return t.topic === onceTpl(); })[0];
            q += '&talk=' + encodeURIComponent(tk ? tk.id : '') + '&mk=toolbox';
          } else {
            q += '&tpl=' + encodeURIComponent(onceTpl()) + '&mk=' + encodeURIComponent(st.kind);
          }
          // Phone-reachable base from the server (LAN IP / public base), so the
          // texted link opens on the recipient's phone — not a localhost URL.
          var base = (SMS_CFG.formBaseUrl || location.origin).replace(/\/+$/, '');
          return base + '/inspect.html?' + q;
        };
        var onceMsg = function () {
          var j = onceJob();
          if (st.kind === 'toolbox') {
            return (C.brand || 'Greiner Brothers') + ' Safety: Toolbox Talk — ' + onceTpl() + (j.name ? ' requested for ' + j.name : '') +
              '.\n\nOpen the talk:\n' + onceLink() + '\n\nDemo environment.';
          }
          return (C.brand || 'Greiner Brothers') + ' Safety: ' + onceTpl() + (j.name ? ' requested for ' + j.name : '') +
            '.\n\nComplete the form:\n' + onceLink() + '\n\nDemo environment.';
        };
        var isDemoPhone = function (ph) { var dd = (ph || '').replace(/\D/g, ''); if (dd.length === 11 && dd[0] === '1') dd = dd.slice(1); return dd.length === 10 && dd.slice(3, 6) === '555'; };
        var updOnce = function () { var pv = $('#af-oncepreview'); if (pv) pv.textContent = onceMsg(); };
        if ($('#af-tpl')) $('#af-tpl').onchange = updOnce;
        if ($('#af-job')) $('#af-job').onchange = updOnce;
        if ($('#af-oncename')) $('#af-oncename').oninput = updOnce;
        updOnce();
        var so = $('#af-sendonce');
        if (so) so.onclick = function () {
          saveName(); var err = $('#af-err'); err.textContent = '';
          var res = $('#af-onceresult'); if (res) res.innerHTML = '';
          var tpl = onceTpl(); if (!tpl) { err.textContent = 'Choose a template or form.'; return; }
          var j = onceJob(); if (st.kind !== 'orientation' && !j.id) { err.textContent = 'Choose a jobsite.'; return; }
          var phone = ($('#af-oncephone').value || '').trim();
          if (!phone) { err.textContent = 'Enter the recipient phone number.'; return; }
          var link = onceLink(), msg = onceMsg();
          var mask = '+*******' + phone.replace(/\D/g, '').slice(-4);
          // Copy fallbacks — never imply the text was delivered.
          var fallbackBtns = '<div style="display:flex;gap:6px;margin-top:6px">' +
            '<button type="button" class="btn btn-sm" id="af-copylink" style="flex:1">Copy link</button>' +
            '<button type="button" class="btn btn-sm" id="af-copymsg" style="flex:1">Copy message</button></div>';
          var wireCopy = function () {
            var cl = $('#af-copylink'); if (cl) cl.onclick = function () { copyText(link, 'Link copied'); };
            var cm = $('#af-copymsg'); if (cm) cm.onclick = function () { copyText(msg, 'Message copied'); };
          };
          // Recipient safety — seeded 555 numbers never reach the carrier (server
          // enforces too; this is the friendly client-side guard).
          if (isDemoPhone(phone)) { res.innerHTML = '<b style="color:var(--warn)">Demo contact — enter a real phone number to send.</b>' + fallbackBtns; wireCopy(); return; }
          if (!SMS_CFG.enabled) { res.innerHTML = '<b style="color:var(--fail)">Text messaging is not configured on this server.</b> Run the demo with <code>npm start</code> and Twilio env vars set.' + fallbackBtns; wireCopy(); return; }
          var old = so.textContent; so.disabled = true; so.textContent = 'Sending…';
          // Real send. Success is shown ONLY when /api/demo-sms returns ok — no fake fallback.
          fetch('/api/demo-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: phone, message: msg }) })
            .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
            .then(function (r) {
              so.disabled = false; so.textContent = old;
              if (r.body && r.body.ok) {
                var stx = (r.body.status === 'accepted') ? 'queued' : (r.body.status || 'accepted by Twilio');
                res.innerHTML = '<b style="color:var(--ok)">Text sent · ' + esc(stx) + '</b> · ' + esc(mask) +
                  (r.body.sid ? ' <span class="small muted">(' + esc(String(r.body.sid).slice(0, 10)) + '…)</span>' : '') + fallbackBtns;
              } else {
                res.innerHTML = '<b style="color:var(--fail)">Text could not be sent</b> · ' + esc((r.body && r.body.error) || ('server returned ' + r.status)) + fallbackBtns;
              }
              wireCopy();
            })
            .catch(function () { so.disabled = false; so.textContent = old; res.innerHTML = '<b style="color:var(--fail)">Text could not be sent</b> · the server is not reachable.' + fallbackBtns; wireCopy(); });
        };
      }
      var pe = $('#af-preset'); if (pe) pe.onchange = function () {
        saveName();
        var np = this.value;
        if (np === 'custom') { if (!st.sched.days.length) st.sched.days = presetDays('weekdays'); }
        else st.sched.days = presetDays(np);
        st.sched.preset = np; render();
      };
      $$('[data-day]').forEach(function (b) { b.onclick = function () {
        saveName(); var dk = b.dataset.day, i = st.sched.days.indexOf(dk);
        if (i > -1) st.sched.days.splice(i, 1); else st.sched.days.push(dk);
        render();
      }; });
      var ta = $('#af-talkadd'); if (ta) ta.onclick = function () {
        saveName(); var code = ($('#af-addtalk') || {}).value;
        if (code && st.series.every(function (x) { return x.code !== code; })) st.series.push({ code: code });
        render(); };
      $$('[data-mvup]').forEach(function (b) { b.onclick = function () {
        var i = +b.dataset.mvup; if (i > lockedCount) { var t = st.series[i - 1]; st.series[i - 1] = st.series[i]; st.series[i] = t; } render(); }; });
      $$('[data-mvdn]').forEach(function (b) { b.onclick = function () {
        var i = +b.dataset.mvdn; if (i < st.series.length - 1) { var t = st.series[i + 1]; st.series[i + 1] = st.series[i]; st.series[i] = t; } render(); }; });
      $$('[data-rmtalk]').forEach(function (b) { b.onclick = function () {
        var i = +b.dataset.rmtalk; if (i >= lockedCount) st.series.splice(i, 1); render(); }; });
      var who = $('#af-who'); if (who) who.onchange = function () { var c = contacts[this.value]; if (c) { $('#af-rname').value = c.name; $('#af-rphone').value = c.phone; } };
      var add = $('#af-radd'); if (add) add.onclick = function () {
        saveName(); var nm = $('#af-rname').value.trim(), ph = $('#af-rphone').value.trim();
        if (!nm && !ph) { $('#af-err').textContent = 'Enter a name and phone to add.'; return; }
        st.recips.push({ name: nm || 'Crew', phone: ph }); render(); };
      $$('[data-rmr]').forEach(function (b) { b.onclick = function () { saveName(); st.recips.splice(+b.dataset.rmr, 1); render(); }; });
      $('#af-cancel').onclick = function () { if (editing) { openAutomation(existing); } else closeDrawer(); };
      var afSave = $('#af-save');
      if (afSave) afSave.onclick = function () {
        saveName();
        var err = $('#af-err');
        var series = st.kind === 'toolbox' && st.mode === 'series';
        if (!st.name.trim()) { err.textContent = 'Enter an automation name.'; return; }
        var tpl = $('#af-tpl') ? $('#af-tpl').value : '';
        if (!series && !tpl) { err.textContent = 'Choose a template or form.'; return; }
        if (series && st.series.length < 2) { err.textContent = 'Add at least two talks to the series.'; return; }
        var jv = ($('#af-job').value || '').split('|');
        var scope = jv[0] === 'company' ? 'company' : null;
        var job_id = scope ? null : (jv[0] || null);
        var jobName2 = scope ? '' : (jv[1] || '');
        var jobNum = scope ? '' : (jv[2] || '');
        var isOrient = st.kind === 'orientation';
        var isTrigger = isOrient && st.orientTiming === 'trigger';
        var recips, cadence, trigger, nextRun = null, sPreset, sDays, sTime;
        if (isTrigger) {
          recips = []; cadence = ($('#af-trig') ? $('#af-trig').value : st.trigger); trigger = true;
        } else {
          var days = st.sched.preset === 'custom' ? st.sched.days : presetDays(st.sched.preset);
          if (!days.length) { err.textContent = 'Select at least one day for the schedule.'; return; }
          st.sched.days = days;
          recips = isOrient ? [] : st.recips.slice();
          if (!isOrient && !recips.length) { err.textContent = 'Add at least one recipient.'; return; }
          cadence = cadenceFromSched(st.sched); trigger = false;
          nextRun = nextRunFromSched(st.sched);
          sPreset = st.sched.preset; sDays = days.slice(); sTime = st.sched.time || '08:00';
        }
        var patch = { kind: st.kind, name: st.name.trim(),
          scope: scope, job_id: job_id, job: jobName2, job_number: jobNum,
          recipients: recips, to_name: recips[0] ? recips[0].name : null, to_phone: recips[0] ? recips[0].phone : null,
          audience: isOrient ? $('#af-aud').value : undefined,
          cadence: cadence, trigger: trigger, next_run: trigger ? null : nextRun,
          schedule_type: trigger ? undefined : 'recurring', schedule_preset: trigger ? undefined : sPreset,
          schedule_days: trigger ? undefined : sDays, schedule_time: trigger ? undefined : sTime };
        if (series) {
          patch.mode = 'series'; patch.series_items = st.series.slice(); patch.template = undefined; patch.forms = undefined;
        } else {
          patch.mode = st.kind === 'toolbox' ? 'single' : undefined;
          patch.template = tpl; patch.forms = st.kind === 'inspection' ? [tpl] : undefined;
          patch.series_items = undefined;
        }
        var sch = B.schedules || (B.schedules = []);
        if (editing) {
          Object.keys(patch).forEach(function (kk) { existing[kk] = patch[kk]; });
          closeDrawer(); pgAutomations(); openAutomation(existing); toast('Automation updated.');
        } else {
          patch.id = 'sch' + (sch.length + 1); patch.active = true; patch.archived = false;
          sch.unshift(patch);
          autoTab = 'active'; autoCat = 'all'; closeDrawer(); pgAutomations(); toast('Automation created.');
        }
      };
    }
    render();
  }

  /* ====================== EQUIPMENT =================================== */
  /* Every serialized machine that needs a pre-use check. Each unit is tied to
     the inspection template for its type, so a QR sticker on the machine opens
     exactly that check — already attached to the unit. */
  function equipInspName(e) {
    var t = (B.templates || []).filter(function (x) { return x.code === e.insp; })[0];
    return t ? t.name : 'Pre-use inspection';
  }
  function equipStatus(e) {
    var next = new Date(new Date(e.last + 'T12:00:00').getTime() + e.interval * 86400000);
    var days = Math.floor((next - new Date()) / 86400000);
    if (days < 0)  return { k: 'overdue', label: 'Overdue',   cls: 'p-bad',  next: next };
    if (days <= 0) return { k: 'due',     label: 'Due today', cls: 'p-warn', next: next };
    return { k: 'ok', label: 'Current', cls: 'p-ok', next: next };
  }
  function equipUrl(e) { return 'https://safety.demo/inspect?equip=' + e.id + '&form=' + e.insp; }
  function offsetIso(iso, days) {
    return new Date(new Date(iso + 'T12:00:00').getTime() + days * 86400000).toISOString().slice(0, 10);
  }
  // Authentic-looking QR: real finder + timing patterns and deterministic data
  // modules from the payload. The live build swaps this for a scannable code
  // that opens the URL it encodes.
  function qrSvg(text, px) {
    var n = 25, m = [], x, y, i;
    for (y = 0; y < n; y++) { m[y] = []; for (x = 0; x < n; x++) m[y][x] = 0; }
    var seed = 2166136261; for (i = 0; i < text.length; i++) { seed ^= text.charCodeAt(i); seed = (seed * 16777619) >>> 0; }
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    function finder(ox, oy) {
      for (var yy = 0; yy < 7; yy++) for (var xx = 0; xx < 7; xx++) {
        var on = (xx === 0 || xx === 6 || yy === 0 || yy === 6) || (xx >= 2 && xx <= 4 && yy >= 2 && yy <= 4);
        m[oy + yy][ox + xx] = on ? 1 : 0;
      }
    }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    for (i = 8; i < n - 8; i++) { m[6][i] = (i % 2 === 0) ? 1 : 0; m[i][6] = (i % 2 === 0) ? 1 : 0; }
    function reserved(xx, yy) { return (xx < 8 && yy < 8) || (xx >= n - 8 && yy < 8) || (xx < 8 && yy >= n - 8) || xx === 6 || yy === 6; }
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) { if (reserved(x, y)) continue; if (rnd() > 0.52) m[y][x] = 1; }
    var cell = px / (n + 8), r = '';
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (m[y][x])
      r += '<rect x="' + ((x + 4) * cell).toFixed(2) + '" y="' + ((y + 4) * cell).toFixed(2) + '" width="' + (cell + 0.4).toFixed(2) + '" height="' + (cell + 0.4).toFixed(2) + '"/>';
    return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 ' + px + ' ' + px + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="' + px + '" height="' + px + '" rx="8" fill="#fff"/><g fill="#0b1120">' + r + '</g></svg>';
  }

  var eqF = { q: '', job: '', type: '', status: '' };   // Equipment registry filters
  var eqLogF = { q: '', job: '', type: '', result: '', range: '' };   // Inspection Log filters
  var equipTab = 'registry';

  function pgEquipment() {
    var right = subtabs(equipTab, [['registry', 'Equipment'], ['log', 'Inspection Log'], ['archive', 'Archive']], 'eqt');

    if (equipTab === 'archive') {
      var aq = (subQ.eqArch || '').toLowerCase();
      var arch = (B.equipment || []).filter(function (e) {
        return e.archived && has((e.id || '') + ' ' + (e.type || '') + ' ' + (e.model || '') + ' ' + (e.serial || '') + ' ' + (e.job || ''), aq); });
      var ah = head('Equipment', 'Units taken out of the active registry. Restore one to put it back.', right);
      ah += fbarSearch('eqarch-q', subQ.eqArch, 'Search archived units…');
      ah += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Unit' }, { t: 'Make / serial' }, { t: 'Jobsite' }, { t: '', r: 1 }],
        arch.map(function (e) {
          return '<tr><td><span class="t-main">' + esc(e.id) + '</span><div class="t-sub">' + esc(e.type) + '</div></td>' +
            '<td>' + esc(e.model) + '<div class="t-sub">SN ' + esc(e.serial) + '</div></td>' +
            '<td>' + esc(e.job) + '</td>' +
            '<td class="r"><button class="btn btn-sm" data-eqrestore="' + esc(e.id) + '">Restore</button></td></tr>';
        }), 'Nothing archived.') + '</div></div>';
      paint(ah);
      wireSubtabs('eqt', function (v) { equipTab = v; pgEquipment(); });
      wireSearch('eqarch-q', function (v) { subQ.eqArch = v; pgEquipment(); });
      $$('[data-eqrestore]').forEach(function (b) { b.onclick = function () {
        var e = (B.equipment || []).filter(function (x) { return x.id === b.dataset.eqrestore; })[0];
        if (e) e.archived = false; toast('Unit restored.'); pgEquipment(); }; });
      return;
    }

    if (equipTab === 'log') {
      // Company-wide equipment inspection history. Derived from the EXISTING
      // completed-submission source of truth (CREW — the same records the
      // Inspections › Completed tab shows and openCrewInsp opens), narrowed to
      // submissions actually tied to an asset (asset_id present). No new data
      // model, no duplicated records — each row IS a real CREW submission.
      var logAll = CREW.filter(function (r) { return r.asset_id && !r.archived; })
        .slice().sort(function (a, b) {
          return new Date(b.submitted_at || b.inspection_date) - new Date(a.submitted_at || a.inspection_date); });

      var lJobSet = {}, lTypeSet = {};
      logAll.forEach(function (r) {
        if (r.jobsite) lJobSet[r.jobsite] = 1;
        if (r.inspection_subtype) lTypeSet[r.inspection_subtype] = 1;
      });
      var lJobOpts = Object.keys(lJobSet).sort().map(function (j) {
        return '<option value="' + esc(j) + '"' + (eqLogF.job === j ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('');
      var lTypeOpts = Object.keys(lTypeSet).sort().map(function (t) {
        return '<option value="' + esc(t) + '"' + (eqLogF.type === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
      var lResOpts = [['', 'Any result'], ['pass', 'Pass'], ['defect', 'Defects found']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (eqLogF.result === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      var lRangeOpts = [['', 'Any date'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (eqLogF.range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');

      var lq = (eqLogF.q || '').toLowerCase();
      var lcut = eqLogF.range ? new Date(Date.now() - (+eqLogF.range) * 86400000) : null;
      var logRows = logAll.filter(function (r) {
        if (eqLogF.job && r.jobsite !== eqLogF.job) return false;
        if (eqLogF.type && r.inspection_subtype !== eqLogF.type) return false;
        if (eqLogF.result === 'pass' && r.has_defects) return false;
        if (eqLogF.result === 'defect' && !r.has_defects) return false;
        if (lcut && new Date(r.submitted_at || r.inspection_date) < lcut) return false;
        if (lq && ((r.asset_id || '') + ' ' + (r.inspection_subtype || '') + ' ' + (r.form_type || '') + ' ' +
          (r.jobsite || '') + ' ' + (r.inspector_name || '')).toLowerCase().indexOf(lq) === -1) return false;
        return true;
      });

      var lh = head('Equipment',
        'Every equipment pre-use inspection as it comes in from the field, newest first — the ' +
        'company-wide view across all jobsites. Each unit’s own history stays on its detail card.', right);
      lh += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="eqlog-q" placeholder="Search inspections…" value="' + esc(eqLogF.q) + '"></div>' +
        '<select id="eqlog-job"><option value="">All jobsites</option>' + lJobOpts + '</select>' +
        '<select id="eqlog-type"><option value="">All equipment types</option>' + lTypeOpts + '</select>' +
        '<select id="eqlog-res">' + lResOpts + '</select>' +
        '<select id="eqlog-range">' + lRangeOpts + '</select></div>';
      lh += '<div class="panel"><div class="panel-hd"><div><h3>Inspection log</h3>' +
        '<div class="sub">' + logRows.length + ' of ' + logAll.length + ' shown · newest first</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: 'Date / Time' }, { t: 'Unit' }, { t: 'Inspection' }, { t: 'Jobsite' }, { t: 'Completed By' }, { t: 'Result', r: 1 }],
        logRows.map(function (r) {
          return '<tr class="click" data-crewi="' + esc(r.id) + '">' +
            '<td>' + esc(r.submitted_at ? fmtWhen(r.submitted_at) : fmtDate(r.inspection_date)) + '</td>' +
            '<td><span class="t-main">' + esc(r.asset_id) + '</span>' +
              (r.inspection_subtype ? '<div class="t-sub">' + esc(r.inspection_subtype) + '</div>' : '') + '</td>' +
            '<td>' + esc(r.inspection_subtype || r.form_type) + '</td>' +
            '<td>' + esc(r.jobsite) + '</td>' +
            '<td>' + esc(r.inspector_name) + '</td>' +
            '<td class="r">' + (r.has_defects
              ? pill('p-bad', r.defect_count + ' defect' + (r.defect_count === 1 ? '' : 's'))
              : pill('p-ok', 'Clear')) + '</td></tr>';
        }), 'No equipment inspections match your filters.') + '</div></div>';
      paint(lh);
      wireSubtabs('eqt', function (v) { equipTab = v; pgEquipment(); });
      wireSearch('eqlog-q', function (v) { eqLogF.q = v; pgEquipment(); });
      function eqlBind(id, key) { var el2 = $('#' + id); if (el2) el2.onchange = function () { eqLogF[key] = el2.value; pgEquipment(); }; }
      eqlBind('eqlog-job', 'job'); eqlBind('eqlog-type', 'type'); eqlBind('eqlog-res', 'result'); eqlBind('eqlog-range', 'range');
      return;
    }

    var allEq = (B.equipment || []).filter(function (e) { return !e.archived; })
      .map(function (e) { return { e: e, s: equipStatus(e) }; })
      .sort(function (a, b) { var o = { overdue: 0, due: 1, ok: 2 }; return o[a.s.k] - o[b.s.k]; });

    var jobSet = {}, typeSet = {};
    allEq.forEach(function (r) { if (r.e.job) jobSet[r.e.job] = 1; if (r.e.type) typeSet[r.e.type] = 1; });
    var eqJobOpts = Object.keys(jobSet).sort().map(function (j) {
      return '<option value="' + esc(j) + '"' + (eqF.job === j ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('');
    var eqTypeOpts = Object.keys(typeSet).sort().map(function (t) {
      return '<option value="' + esc(t) + '"' + (eqF.type === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
    var eqStatusOpts = [['', 'Any status'], ['overdue', 'Overdue'], ['due', 'Due today'], ['ok', 'Current']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (eqF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');

    var eqQ = eqF.q.toLowerCase();
    var eq = allEq.filter(function (r) {
      var e = r.e;
      if (eqF.job && e.job !== eqF.job) return false;
      if (eqF.type && e.type !== eqF.type) return false;
      if (eqF.status && r.s.k !== eqF.status) return false;
      if (eqQ && ((e.id || '') + ' ' + (e.type || '') + ' ' + (e.model || '') + ' ' + (e.serial || '') + ' ' +
        (e.job || '') + ' ' + (e.operator || '')).toLowerCase().indexOf(eqQ) === -1) return false;
      return true;
    });
    var overdue = eq.filter(function (r) { return r.s.k === 'overdue'; }).length;
    var due = eq.filter(function (r) { return r.s.k === 'due'; }).length;

    var html = head('Equipment',
      'Every serialized machine that needs a pre-use check. Each unit carries a QR sticker — ' +
      'scan it and the right inspection opens on the phone, already tied to the unit.', right);
    html += '<div class="cards">' +
      kpi(eq.length, 'units tracked', 'across active jobsites', 'c-grey') +
      kpi(overdue, 'checks overdue', overdue ? 'inspection required before use' : 'all current', overdue ? 'c-bad' : 'c-ok') +
      kpi(due, 'due today', 'before next use', due ? 'c-warn' : 'c-grey') +
      kpi('QR', 'scan to inspect', 'tap a unit for its code', 'c-ok') +
      '</div>';

    html += '<div class="fbar">' +
      '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<input id="eq-q" placeholder="Search units…" value="' + esc(eqF.q) + '"></div>' +
      '<select id="eq-job"><option value="">All jobsites</option>' + eqJobOpts + '</select>' +
      '<select id="eq-type"><option value="">All types</option>' + eqTypeOpts + '</select>' +
      '<select id="eq-status">' + eqStatusOpts + '</select></div>';

    var rows = eq.map(function (r, i) {
      var e = r.e;
      return '<tr data-eq="' + i + '" style="cursor:pointer">' +
        '<td><span class="t-main" style="font-weight:600">' + esc(e.id) + '</span><div class="t-sub">' + esc(e.type) + '</div></td>' +
        '<td>' + esc(e.model) + '<div class="t-sub">SN ' + esc(e.serial) + '</div></td>' +
        '<td>' + esc(e.job) + '</td>' +
        '<td>' + esc(equipInspName(e)) + '</td>' +
        '<td>' + fmtDate(e.last) + '<div class="t-sub">every ' + (e.interval === 1 ? 'shift' : e.interval + ' days') + '</div></td>' +
        '<td class="r">' + pill(r.s.cls, r.s.label) + '</td>' +
        '<td class="r"><button class="btn btn-sm" data-eqarch="' + esc(e.id) + '">Archive</button></td></tr>';
    });
    html += '<div class="panel"><div class="panel-hd"><div><h3>Registry</h3>' +
      '<div class="sub">' + eq.length + ' of ' + allEq.length + ' shown · overdue first. Click a unit for its QR sticker and check history.</div>' +
      '</div></div><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Unit' }, { t: 'Make / serial' }, { t: 'Jobsite' }, { t: 'Pre-use check' }, { t: 'Last checked' }, { t: 'Status', r: 1 }, { t: '', r: 1 }],
      rows, 'No equipment matches your filters.') + '</div></div>';
    paint(html);
    wireSubtabs('eqt', function (v) { equipTab = v; pgEquipment(); });
    $$('[data-eq]').forEach(function (tr) { tr.onclick = function () { openEquip(eq[+tr.dataset.eq]); }; });
    $$('[data-eqarch]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation();
      var e = (B.equipment || []).filter(function (x) { return x.id === b.dataset.eqarch; })[0];
      if (e) e.archived = true; toast('Unit archived.'); pgEquipment(); }; });
    function eqBind(id, key) { var e = $('#' + id); if (e) e.oninput = e.onchange = function () { eqF[key] = e.value; pgEquipment(); }; }
    eqBind('eq-q', 'q'); eqBind('eq-job', 'job'); eqBind('eq-type', 'type'); eqBind('eq-status', 'status');
    var _eqq = $('#eq-q'); if (_eqq && eqF.q) { _eqq.focus(); try { _eqq.setSelectionRange(_eqq.value.length, _eqq.value.length); } catch (e) {} }
  }

  function openEquip(r) {
    var e = r.e, url = equipUrl(e);
    var h = '';
    if (r.s.k !== 'ok') h += '<div class="alert"><strong>' +
      (r.s.k === 'overdue' ? 'Pre-use check overdue.' : 'Pre-use check due today.') +
      '</strong> Do not operate until the ' + esc(equipInspName(e)) + ' is completed.</div>';
    h += '<div class="sec-h">QR sticker</div>' +
      '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        '<div style="border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:12px;background:#fff;line-height:0">' + qrSvg(url, 158) + '</div>' +
        '<div style="min-width:190px;flex:1">' +
          '<div class="small muted">Scan opens</div>' +
          '<div style="font-weight:600">' + esc(equipInspName(e)) + '</div>' +
          '<div class="small muted" style="margin-top:2px">Tied to asset ' + esc(e.id) + '</div>' +
          '<div class="small muted" style="margin-top:6px">Visual only — we provide the QR codes for every unit.</div>' +
          '<button class="btn btn-gold btn-sm" id="eq-start" style="margin-top:10px">Start ' + esc(equipInspName(e)) + '</button>' +
        '</div>' +
      '</div>';
    h += '<div class="sec-h">Rental</div>' +
      '<div class="small muted" style="margin-bottom:8px">If this unit fails its check or needs service, text the rental company for a swap — tied to asset ' + esc(e.id) + '.</div>' +
      '<button class="btn' + (r.s.k !== 'ok' ? ' btn-gold' : '') + '" id="eq-rental">Text rental company</button>';
    h += '<div class="sec-h">Unit</div>' +
      kv('Unit ID', e.id) + kv('Type', e.type) + kv('Make / model', e.model) +
      kv('Serial', e.serial) + kv('Jobsite', e.job) +
      kv('Assigned operator', e.operator === '—' ? 'Unassigned' : e.operator) +
      kv('Check frequency', e.interval === 1 ? 'Every shift / before use' : 'Every ' + e.interval + ' days') +
      kv('Last checked', fmtDate(e.last)) +
      kv('Next due', r.s.next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), r.s.k !== 'ok');
    h += '<div class="sec-h">Recent checks</div>';
    [0, 1, 2].forEach(function (k) {
      var when = offsetIso(e.last, -k * e.interval);
      var by = (k === 0 && e.operator !== '—') ? e.operator : 'Crew';
      h += '<div class="kv"><span class="k">' + fmtDate(when) + '</span><span class="v">' + esc(by) + ' · ' + pill('p-ok', 'Pass') + '</span></div>';
    });
    drawer(e.type + ' · ' + e.id, e.model + ' · SN ' + e.serial, h);
    var st = $('#eq-start'); if (st) st.onclick = function () {
      toast('Opening the ' + equipInspName(e) + ' — pre-filled for unit ' + e.id + '.');
    };
    var rt = $('#eq-rental'); if (rt) rt.onclick = function () {
      toast('Texted the rental company — swap requested for ' + e.type + ' ' + e.id + '.');
    };
  }

  /* ====================== CORRECTIVE ACTIONS ========================= */
  /* Items flagged for correction from inspections, reports and site walks —
     the same workflow as the contractor portal's "findings" tab: open first,
     filter, open one to read the corrective action and mark it corrected. */
  var caF = { q: '', site: '', sev: '', status: '', owner: '', range: '' };
  function sevPill(s) { return pill(s === 'high' ? 'p-bad' : s === 'medium' ? 'p-warn' : 'p-grey', s); }
  function caOverdue(f) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return f.status === 'open' && new Date(f.due + 'T00:00:00') < t;
  }
  function pgCorrective() {
    var F = B.findings || [];
    var openN = F.filter(function (f) { return f.status === 'open'; }).length;
    var overdueN = F.filter(caOverdue).length;
    var closedN = F.filter(function (f) { return f.status === 'closed'; }).length;
    var cd = F.filter(function (f) { return f.status === 'closed' && f.closed; })
      .map(function (f) { return Math.round((new Date(f.closed) - new Date(f.date)) / 86400000); });
    var avg = cd.length ? Math.round(cd.reduce(function (a, b) { return a + b; }, 0) / cd.length) : 0;

    var html = head('Corrective Actions',
      'Items flagged for correction, open first. A red row is past its due date and needs to move today.', '');
    html += '<div class="cards">' +
      kpi(openN, 'open', overdueN ? overdueN + ' overdue' : 'all on time', openN ? 'c-warn' : 'c-ok') +
      kpi(overdueN, 'overdue', overdueN ? 'past due date' : 'none late', overdueN ? 'c-bad' : 'c-ok') +
      kpi(closedN, 'closed', 'corrective action verified', 'c-grey') +
      kpi(avg + 'd', 'avg days to close', 'open to verified', 'c-grey') +
      '</div>';

    var jobIds = {}, owners = {}; F.forEach(function (f) { jobIds[f.job_id] = 1; owners[subName(f.sub_id)] = 1; });
    var jobOpts = Object.keys(jobIds).map(function (id) {
      return '<option value="' + esc(id) + '"' + (caF.site === id ? ' selected' : '') + '>' + esc(jobName(id)) + '</option>'; }).join('');
    var sevOpts = ['high', 'medium', 'low'].map(function (s) { return '<option' + (caF.sev === s ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    var ownerOpts = Object.keys(owners).sort().map(function (o) { return '<option' + (caF.owner === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
    var caRangeOpts = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']].map(function (o) { return '<option value="' + o[0] + '"' + (caF.range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    html += '<div class="fbar">' +
      '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<input id="ca-q" placeholder="Search description, jobsite, responsible…" value="' + esc(caF.q) + '"></div>' +
      '<select id="ca-site"><option value="">All jobsites</option>' + jobOpts + '</select>' +
      '<select id="ca-sev"><option value="">All severity</option>' + sevOpts + '</select>' +
      '<select id="ca-status"><option value="">Open + closed</option>' +
        '<option value="open"' + (caF.status === 'open' ? ' selected' : '') + '>Open only</option>' +
        '<option value="closed"' + (caF.status === 'closed' ? ' selected' : '') + '>Closed only</option></select>' +
      '<select id="ca-owner"><option value="">All responsible</option>' + ownerOpts + '</select>' +
      '<select id="ca-range"><option value="">Any date</option>' + caRangeOpts + '</select>' +
      '</div>';

    var q = caF.q.toLowerCase();
    var rows = F.slice().sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return a.due.localeCompare(b.due);
    }).filter(function (f) {
      if (caF.site && f.job_id !== caF.site) return false;
      if (caF.sev && f.severity !== caF.sev) return false;
      if (caF.status && f.status !== caF.status) return false;
      if (caF.owner && subName(f.sub_id) !== caF.owner) return false;
      if (caF.range && new Date(f.date + 'T00:00:00') < new Date(Date.now() - (+caF.range) * 86400000)) return false;
      if (q && (f.description + ' ' + jobName(f.job_id) + ' ' + subName(f.sub_id)).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    var trs = rows.map(function (f) {
      var od = caOverdue(f);
      var stat = f.status === 'closed' ? pill('p-ok', 'Closed · ' + fmtDate(f.closed))
        : (od ? pill('p-bad', 'Overdue') : pill('p-warn', 'Open · due ' + fmtDate(f.due)));
      return '<tr data-ca="' + esc(f.id) + '" style="cursor:pointer">' +
        '<td>' + sevPill(f.severity) + '</td>' +
        '<td><span class="t-main" style="font-weight:500">' + esc(f.description) + '</span>' +
          '<div class="t-sub">Opened ' + fmtDate(f.date) + '</div></td>' +
        '<td>' + esc(jobName(f.job_id)) + '</td>' +
        '<td>' + esc(subName(f.sub_id)) + '</td>' +
        '<td>' + stat + '</td></tr>';
    });
    html += '<div class="panel"><div class="panel-hd"><div><h3>Corrective actions</h3>' +
      '<div class="sub">' + rows.length + ' shown · open items first</div></div></div>' +
      '<div class="panel-bd flush">' + tableWrap(
      [{ t: 'Severity' }, { t: 'Finding' }, { t: 'Jobsite' }, { t: 'Responsible' }, { t: 'Status' }],
      trs, 'No corrective actions match your filter.') + '</div></div>';
    paint(html);

    function bind(id, key) { var e = $('#' + id); if (e) e.oninput = e.onchange = function () { caF[key] = e.value; pgCorrective(); }; }
    bind('ca-q', 'q'); bind('ca-site', 'site'); bind('ca-sev', 'sev'); bind('ca-status', 'status');
    bind('ca-owner', 'owner'); bind('ca-range', 'range');
    var qb = $('#ca-q'); if (qb && caF.q) { qb.focus(); try { qb.setSelectionRange(qb.value.length, qb.value.length); } catch (e2) {} }
    // Click a row → the shared corrective-action editor (add the fix, reassign the
    // owner, close it out, attach photos) — the same editor every source uses.
    $$('[data-ca]').forEach(function (tr) {
      tr.onclick = function () { openCA('find|' + tr.dataset.ca); };
    });
  }

  /* ====================== ANALYTICS (bridge) ========================= */
  /* The dashboard builder lives in analytics.js; office.js hands it the data
     and helpers so it never re-implements the app. */
  function anCtx() {
    return { getB: function () { return B; }, esc: esc, fmtDate: fmtDate, head: head, paint: paint,
      $: $, $$: $$, jobName: jobName, subName: subName, catName: catName, drawer: drawer,
      closeDrawer: closeDrawer, toast: toast, go: go, workerRoster: workerRoster };
  }
  function pgAnalytics() {
    if (window.SDAnalytics) { window.SDAnalytics.init(anCtx()); window.SDAnalytics.page(); }
    else paint('<div class="empty">Analytics module failed to load.</div>');
  }

  var navGroupsCollapsed = {};   // group name -> true when collapsed (session only)
  function navLink(p, c) {
    var a = el('a', p.id === page ? 'on' : '');
    a.href = '#' + p.id;
    a.appendChild(el('span', null, p.label));
    var n = p.badge ? c[p.badge] : 0;
    if (n) a.appendChild(el('span', 'badge' + (p.warn ? ' w' : ''), String(n)));
    a.onclick = function (e) { e.preventDefault(); go(p.id); };
    return a;
  }
  function renderNav() {
    var c = counts(), nav = $('#nav');
    nav.innerHTML = '';
    var order = [];
    PAGES.forEach(function (p) { var g = p.group || ''; if (order.indexOf(g) === -1) order.push(g); });
    order.forEach(function (g) {
      var items = PAGES.filter(function (p) { return (p.group || '') === g; });
      if (!g) { items.forEach(function (p) { nav.appendChild(navLink(p, c)); }); return; }
      var collapsed = !!navGroupsCollapsed[g];
      var hd = el('button', 'nav-sec' + (collapsed ? ' collapsed' : ''));
      hd.type = 'button';
      hd.appendChild(el('span', 'nav-sec-label', g));
      var right = el('span', 'nav-sec-right');
      // when collapsed, surface the group's total alert count so warnings aren't hidden
      if (collapsed) {
        var tot = items.reduce(function (s, p) { return s + (p.badge ? (c[p.badge] || 0) : 0); }, 0);
        var warn = items.some(function (p) { return p.warn && p.badge && c[p.badge]; });
        if (tot) right.appendChild(el('span', 'badge' + (warn ? ' w' : ''), String(tot)));
      }
      right.appendChild(el('span', 'nav-sec-caret', '▾'));
      hd.appendChild(right);
      hd.onclick = function () { navGroupsCollapsed[g] = !navGroupsCollapsed[g]; renderNav(); };
      nav.appendChild(hd);
      var wrap = el('div', 'nav-grp' + (collapsed ? ' hide' : ''));
      items.forEach(function (p) { wrap.appendChild(navLink(p, c)); });
      nav.appendChild(wrap);
    });
  }
  function go(id) {
    page = id;
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    renderNav();
    ({ overview: pgOverview, analytics: pgAnalytics, permits: pgPermits, incidents: pgIncidents, obs: pgObs,
       insp: pgInsp, equipment: pgEquipment, corrective: pgCorrective, talks: pgTalks, nearmiss: pgNearMiss,
       subs: pgSubs, training: pgTraining, templates: pgTemplates, jobs: pgJobs, docs: pgDocs,
       automations: pgAutomations, orient: pgOrient }[id] || pgOverview)();
    window.scrollTo(0, 0);
  }

  function head(title, note, right) {
    return '<div class="pg-hd"><div><h2>' + esc(title) + '</h2>' +
      (note ? '<p>' + esc(note) + '</p>' : '') + '</div>' +
      (right || '') + '</div>';
  }
  function tableWrap(cols, rows, emptyMsg) {
    if (!rows.length) return '<div class="empty">' + esc(emptyMsg || 'Nothing here.') + '</div>';
    return '<div class="tw"><table><thead><tr>' +
      cols.map(function (c) { return '<th' + (c.r ? ' class="r"' : '') + '>' + esc(c.t) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  /* ====================== ANALYTICS ==================================== */
  /* A small, polished executive view. Every number is DERIVED from the same
     demo state the rest of the app uses — no separate analytics dataset. The
     Date Range and Jobsite filters recompute everything on change. */
  var anlRange = 30, anlJob = '';                 // 7 | 30 | 90 | 'ytd'
  function anlRangeLabel() {
    return anlRange === 'ytd' ? 'Year to date' : 'Last ' + anlRange + ' days';
  }
  // Small chart primitives — pure HTML/CSS, no external library.
  function anlCols(items) {                        // vertical column chart
    if (!items.length) return '<div class="anl-empty">No data for this period.</div>';
    var max = Math.max(1, Math.max.apply(null, items.map(function (i) { return i.value; })));
    return '<div class="anl-cols">' + items.map(function (it) {
      var h = Math.max(it.value ? 3 : 0, Math.round(it.value / max * 100));
      return '<div class="anl-col"><div class="anl-col-v">' + (it.value || '') + '</div>' +
        '<div class="anl-col-bar" style="height:' + h + '%"></div>' +
        '<div class="anl-col-l">' + esc(it.label) + '</div></div>';
    }).join('') + '</div>';
  }
  function anlBars(items, keepZero) {               // horizontal bar chart
    var rows = keepZero ? items : items.filter(function (i) { return i.value > 0; });
    if (!rows.length || !items.some(function (i) { return i.value > 0; })) return '<div class="anl-empty">No data for this period.</div>';
    var max = Math.max(1, Math.max.apply(null, rows.map(function (i) { return i.value; })));
    return '<div class="anl-bars">' + rows.map(function (it) {
      var w = Math.max(2, Math.round(it.value / max * 100));
      return '<div class="anl-barrow"><div class="anl-barlbl">' + esc(it.label) + '</div>' +
        '<div class="anl-bartrack"><div class="anl-barfill" style="width:' + w + '%;background:' + (it.color || 'var(--accent)') + '"></div></div>' +
        '<div class="anl-barval">' + it.value + '</div></div>';
    }).join('') + '</div>';
  }
  function anlDonut(segs) {                         // SVG donut + legend
    var total = segs.reduce(function (a, s) { return a + s.value; }, 0);
    if (!total) return '<div class="anl-empty">No data for this period.</div>';
    var R = 54, CIRC = 2 * Math.PI * R, off = 0;
    var arcs = segs.map(function (s) {
      var len = s.value / total * CIRC;
      var c = '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + s.color + '" stroke-width="20" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (CIRC - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"/>';
      off += len; return c;
    }).join('');
    var legend = segs.map(function (s) {
      return '<div class="anl-leg"><span style="background:' + s.color + '"></span>' + esc(s.label) + ' · <b>' + s.value + '</b></div>';
    }).join('');
    return '<div class="anl-donut"><svg viewBox="0 0 140 140" width="140" height="140" aria-hidden="true">' + arcs +
      '<text x="70" y="70" text-anchor="middle" dominant-baseline="central" font-size="24" font-weight="700" fill="#0b1120">' + total + '</text></svg>' +
      '<div class="anl-legend">' + legend + '</div></div>';
  }
  function anlPanel(title, sub, body) {
    return '<div class="panel"><div class="panel-hd"><div><h3>' + esc(title) + '</h3>' +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div></div><div class="panel-bd">' + body + '</div></div>';
  }
  function pgAnalytics() {
    var jobs = B.jobs || [];
    var jobIdByName = function (nm) { for (var i = 0; i < jobs.length; i++) if (jobs[i].name === nm) return jobs[i].id; return null; };
    var now = new Date();
    var yearStart = new Date(now.getFullYear(), 0, 1);
    var start = anlRange === 'ytd' ? yearStart : new Date(now.getTime() - anlRange * 86400000);
    var inJob = function (jid) { return !anlJob || jid === anlJob; };

    // Every field submission, normalized. Same records the rest of the app shows.
    var subs = [];
    (B.reports || []).forEach(function (r) { if (r.report_date) subs.push({ t: new Date(repDay(r) + 'T09:00:00'), type: 'Observation', job_id: r.job_id, timed: false }); });
    (CREW || []).forEach(function (r) {
      var when = r.submitted_at ? new Date(r.submitted_at) : (r.inspection_date ? new Date(r.inspection_date + 'T09:00:00') : null);
      if (!when) return;
      var type = r.asset_id ? 'Equipment Inspection' : (/jha/i.test(r.form_type || r.inspection_subtype || '') ? 'JHA' : 'Inspection');
      subs.push({ t: when, type: type, job_id: jobIdByName(r.jobsite), timed: !!r.submitted_at });
    });
    (B.permits || []).forEach(function (p) { if (p.issued_at) subs.push({ t: new Date(p.issued_at), type: 'Permit', job_id: p.job_id, timed: true }); });
    (B.talks || []).forEach(function (t) { if (t.date) subs.push({ t: new Date(t.date + 'T10:00:00'), type: 'Toolbox Talk', job_id: t.job_id, timed: false }); });
    var inRange = subs.filter(function (s) { return s.t >= start && inJob(s.job_id); });

    // ---- KPIs (job-filtered; range applies to submissions + score) ----
    var openCA = (B.findings || []).filter(function (f) { return f.status === 'open' && inJob(f.job_id); });
    var overdueCA = openCA.filter(function (f) { return f.due && new Date(f.due) < now; });
    var closedCA = (B.findings || []).filter(function (f) { return f.status === 'closed' && inJob(f.job_id); });
    // Genuine Greiner metrics exclude demo_sample records so no fictional injury
    // history is presented as real. (The Injury Analytics panel below is a clearly
    // labeled illustrative sample.)
    var incYTD = (B.incidents || []).filter(function (i) { return !i.demo_sample && i.date && new Date(i.date) >= yearStart && inJob(i.job_id); });
    var nmYTD = (B.near_misses || []).filter(function (i) { return !i.demo_sample && i.date && new Date(i.date) >= yearStart && inJob(i.job_id); });
    var pass = 0, tot = 0;
    (B.reports || []).forEach(function (r) {
      if (!inJob(r.job_id) || !r.report_date || new Date(repDay(r) + 'T09:00:00') < start) return;
      var it = r.items || {}; Object.keys(it).forEach(function (k) { var v = it[k]; if (v === 'yes') { pass++; tot++; } else if (v === 'no') { tot++; } });
    });
    var score = tot ? Math.round(pass / tot * 100) : null;
    var soon = new Date(now.getTime() + 30 * 86400000), cCur = 0, cSoon = 0, cExp = 0;
    (B.certs || []).forEach(function (c) { var e = c.expires ? new Date(c.expires) : null; if (!e) { cCur++; return; } if (e < now) cExp++; else if (e < soon) cSoon++; else cCur++; });
    var certTot = (B.certs || []).length, comp = certTot ? Math.round(cCur / certTot * 100) : null;

    var cards = '<div class="cards">' +
      kpi(String(inRange.length), 'Reports Submitted', anlRangeLabel() + ' · all field records', '') +
      (overdueCA.length ? actionKpi(String(openCA.length), 'Open Corrective Actions', overdueCA.length + ' overdue')
                        : kpi(String(openCA.length), 'Open Corrective Actions', 'all on time', '')) +
      kpi(score == null ? '—' : score + '%', 'Avg Inspection Score', 'pass rate on inspection items', '') +
      kpi(comp == null ? '—' : comp + '%', 'Training Compliance', cSoon + ' expiring soon', '') +
      kpi(String(incYTD.length), 'Incidents YTD', 'year to date', '') +
      kpi(String(nmYTD.length), 'Near Misses YTD', 'year to date', '') +
      '</div>';

    // ---- Chart 1: submissions over time (adaptive buckets) ----
    var mode = anlRange === 7 ? 'day' : (anlRange === 30 ? 'week' : 'month');
    var buckets = [], seen = {};
    if (mode === 'month') {
      var dm = new Date(start.getFullYear(), start.getMonth(), 1);
      while (dm <= now) { var km = dm.getFullYear() + '-' + dm.getMonth(); seen[km] = { label: dm.toLocaleDateString('en-US', { month: 'short' }), value: 0 }; buckets.push(km); dm = new Date(dm.getFullYear(), dm.getMonth() + 1, 1); }
    } else {
      var step = mode === 'day' ? 1 : 7;
      var dd = new Date(start); if (mode === 'week') { var offs = (dd.getDay() + 6) % 7; dd.setDate(dd.getDate() - offs); } dd.setHours(0, 0, 0, 0);
      while (dd <= now) { var kd = dd.toISOString().slice(0, 10); seen[kd] = { label: dd.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }), value: 0 }; buckets.push(kd); dd = new Date(dd.getTime() + step * 86400000); }
    }
    function keyOf(t) {
      if (mode === 'month') return t.getFullYear() + '-' + t.getMonth();
      if (mode === 'day') return t.toISOString().slice(0, 10);
      var w = new Date(t); var o = (w.getDay() + 6) % 7; w.setDate(w.getDate() - o); w.setHours(0, 0, 0, 0); return w.toISOString().slice(0, 10);
    }
    inRange.forEach(function (s) { var k = keyOf(s.t); if (seen[k]) seen[k].value++; });
    var series = buckets.map(function (k) { return seen[k]; });

    // ---- Chart 2: by type ----
    var typeOrder = ['JHA', 'Inspection', 'Equipment Inspection', 'Permit', 'Toolbox Talk', 'Observation', 'Near Miss'];
    var typeCount = {}; inRange.forEach(function (s) { typeCount[s.type] = (typeCount[s.type] || 0) + 1; });
    typeCount['Near Miss'] = (B.near_misses || []).filter(function (i) { return i.date && new Date(i.date) >= start && inJob(i.job_id); }).length;
    var byType = typeOrder.map(function (t) { return { label: t, value: typeCount[t] || 0 }; });

    // ---- Chart 3: time of day (records that carry a real submission timestamp) ----
    var tod = [{ label: 'Before 7 AM', value: 0 }, { label: '7–9 AM', value: 0 }, { label: '9 AM–12 PM', value: 0 }, { label: '12–3 PM', value: 0 }, { label: 'After 3 PM', value: 0 }];
    var timedN = 0;
    inRange.filter(function (s) { return s.timed; }).forEach(function (s) {
      timedN++; var h = s.t.getHours();
      tod[h < 7 ? 0 : h < 9 ? 1 : h < 12 ? 2 : h < 15 ? 3 : 4].value++;
    });

    // ---- Chart 4: corrective action status ----
    var caSegs = [
      { label: 'Open', value: openCA.length - overdueCA.length, color: 'var(--warn)' },
      { label: 'Overdue', value: overdueCA.length, color: 'var(--fail)' },
      { label: 'Closed', value: closedCA.length, color: 'var(--ok)' }
    ];

    // ---- Chart 5: workforce compliance ----
    var certSegs = [
      { label: 'Current', value: cCur, color: 'var(--ok)' },
      { label: 'Expiring soon', value: cSoon, color: 'var(--warn)' },
      { label: 'Expired', value: cExp, color: 'var(--fail)' }
    ];

    // ---- Chart 6: safety events by month (YTD, stacked) ----
    var months = [], mSeen = {};
    var d6 = new Date(yearStart.getFullYear(), yearStart.getMonth(), 1);
    while (d6 <= now) { var k6 = d6.getMonth(); mSeen[k6] = { label: d6.toLocaleDateString('en-US', { month: 'short' }), a: 0, b: 0 }; months.push(k6); d6 = new Date(d6.getFullYear(), d6.getMonth() + 1, 1); }
    incYTD.forEach(function (i) { var m = new Date(i.date).getMonth(); if (mSeen[m]) mSeen[m].a++; });
    nmYTD.forEach(function (i) { var m = new Date(i.date).getMonth(); if (mSeen[m]) mSeen[m].b++; });
    var eventMonths = months.map(function (k) { return mSeen[k]; });
    var maxEv = Math.max(1, Math.max.apply(null, eventMonths.map(function (m) { return m.a + m.b; })));
    var eventsChart = (incYTD.length + nmYTD.length) ? ('<div class="anl-cols">' + eventMonths.map(function (m) {
      var ha = Math.round(m.a / maxEv * 100), hb = Math.round(m.b / maxEv * 100);
      return '<div class="anl-col"><div class="anl-col-v">' + ((m.a + m.b) || '') + '</div>' +
        '<div style="width:70%;max-width:32px;display:flex;flex-direction:column;justify-content:flex-end;height:100%">' +
        (ha ? '<div style="height:' + ha + '%;background:var(--fail)' + (hb ? '' : ';border-radius:4px 4px 0 0') + '"></div>' : '') +
        (hb ? '<div style="height:' + hb + '%;background:var(--warn);border-radius:4px 4px 0 0"></div>' : '') +
        '</div><div class="anl-col-l">' + esc(m.label) + '</div></div>';
    }).join('') + '</div><div class="anl-legend" style="flex-direction:row;gap:16px;margin-top:12px">' +
      '<div class="anl-leg"><span style="background:var(--fail)"></span>Incidents</div>' +
      '<div class="anl-leg"><span style="background:var(--warn)"></span>Near misses</div></div>')
      : '<div class="anl-empty">No safety events recorded.</div>';

    var jobOpts = '<option value="">All Jobs</option>' + jobs.map(function (j) {
      return '<option value="' + esc(j.id) + '"' + (anlJob === j.id ? ' selected' : '') + '>' + esc(j.name) + '</option>';
    }).join('');
    var rangeOpts = [[7, 'Last 7 Days'], [30, 'Last 30 Days'], [90, 'Last 90 Days'], ['ytd', 'Year to Date']].map(function (o) {
      return '<option value="' + o[0] + '"' + (String(anlRange) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');

    // Only render charts that have real data — never show an empty/fabricated chart.
    var panels = [];
    if (inRange.length) panels.push(anlPanel('Reports Submitted', anlRangeLabel() + ' · inspections, JHAs, permits, toolbox talks', anlCols(series)));
    if (inRange.length || typeCount['Near Miss']) panels.push(anlPanel('Reports by Type', 'Distribution of field submissions', anlBars(byType)));
    if (timedN) panels.push(anlPanel('Submission Activity by Time of Day', timedN + ' timestamped field submissions', anlBars(tod, true)));
    if ((openCA.length + closedCA.length) > 0) panels.push(anlPanel('Corrective Action Status', 'Findings across the selected scope', anlDonut(caSegs)));
    if ((cCur + cSoon + cExp) > 0) panels.push(anlPanel('Workforce Compliance', 'Certifications company-wide', anlDonut(certSegs)));
    if ((incYTD.length + nmYTD.length) > 0) panels.push(anlPanel('Safety Events by Month', 'Incidents and near misses · year to date', eventsChart));

    var html = head('Analytics', 'Company-wide safety trends with jobsite-level filtering.') +
      '<div class="anl-filters">' +
        '<div class="fg"><label for="anl-range">Date Range</label><select id="anl-range">' + rangeOpts + '</select></div>' +
        '<div class="fg"><label for="anl-job">Jobsite</label><select id="anl-job">' + jobOpts + '</select></div>' +
      '</div>' +
      cards +
      (panels.length
        ? '<div class="anl-grid">' + panels.join('') + '</div>'
        : '<div class="panel" style="margin-top:16px"><div class="panel-bd"><div class="anl-empty">No trend charts yet — they appear here as inspections, findings, incidents and training records accumulate.</div></div></div>');

    paint(html);
    var rs = $('#anl-range'); if (rs) rs.onchange = function () { var v = this.value; anlRange = v === 'ytd' ? 'ytd' : +v; pgAnalytics(); };
    var js = $('#anl-job'); if (js) js.onchange = function () { anlJob = this.value; pgAnalytics(); };
  }

  /* ====================== OVERVIEW ====================================== */
  /* A safety director over six jobs does not want an alphabetical job list.
     They want to know which sites are hot today and what is about to lapse. */
  function pgOverview() {
    /* Exception-based hit list. Demo values; safety & compliance only. */
    var needRows = [
      { what: 'Failed Inspection: Excavator JR12 (Blown Hydraulic Line) — Do Not Operate',
        who: 'Crossroads Excavating', why: 'Red Tagged — Awaiting Corrective Action', goto: 'equipment' },
      { what: 'Missing Daily JHA',
        who: 'Crossroads Excavating (North Dock Footing)', why: 'Crew scanned in, but 0 safety forms submitted for today', goto: 'obs' },
      { what: 'Open Hazard: Trench missing protective system',
        who: 'Plainfield Cold Storage', why: 'Reported 2 hours ago — Immediate Action Required', goto: 'corrective' }
    ];
    var patterns = [
      { label: 'Missing Scans', text: 'Crossroads Excavating has missed <b style="color:var(--fail)">4</b> morning JHA deadlines in the last 14 days.' },
      { label: 'Equipment Hazards', text: 'Track / Tire conditions account for <b style="color:var(--fail)">40%</b> of QR safety inspection failures this month.' },
      { label: 'Site Compliance', text: 'Westfield HS Athletic Wing has <b style="color:var(--fail)">3</b> unresolved open safety findings.' }
    ];

    var html = head('Overview', 'Exception-based hit list — what needs attention today.',
      '<button class="btn" id="digest">Morning digest</button>');

    // TOP — Today's Field Pulse: neutral leading indicators, above the hit list.
    html += '<h3 class="sub" style="color:var(--ink);font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;margin:2px 0 8px">Today’s Field Pulse</h3>' +
      '<div class="cards">' +
        kpi('12 / 14', 'Daily JHAs', '2 sites outstanding', 'c-grey') +
        kpi('2', 'Toolbox Talks Logged', '2 today across 6 sites', 'c-grey') +
        kpi('3', 'Pending Corrective Actions', '3 outstanding from yesterday', 'c-grey') +
        kpi('42 of 45', 'Daily Equipment Scans', 'Cleared', 'c-grey') +
      '</div>';

    // SECTION 1 — Needs Attention: detailed table, worst first (not KPI boxes).
    html += '<div class="panel"><div class="panel-hd"><div><h3>Needs Attention</h3>' +
      '<div class="sub">Failed, overdue, or waiting on action. Worst first.</div></div></div>' +
      '<div class="panel-bd flush">' + tableWrap(
        [{ t: '' }, { t: 'What' }, { t: 'Who' }, { t: 'Why it is here' }],
        needRows.map(function (n) {
          return '<tr class="click" data-goto="' + esc(n.goto) + '">' +
            '<td style="width:22px;vertical-align:top;padding-top:14px"><span class="dot" style="background:var(--fail)"></span></td>' +
            '<td><span class="t-main" style="color:var(--ink);font-weight:600">' + esc(n.what) + '</span></td>' +
            '<td>' + esc(n.who) + '</td>' +
            '<td class="c-bad" style="font-weight:600">' + esc(n.why) + '</td></tr>';
        })) + '</div></div>';

    // SECTION 2 — Patterns: text-heavy insight sentences.
    html += '<div class="panel"><div class="panel-hd"><div><h3>Safety Trends</h3>' +
      '<div class="sub">Trends automatically surfaced from field activity.</div></div></div>' +
      '<div class="panel-bd">' + patterns.map(function (p) {
        return '<div class="bullet" style="padding:7px 0"><span class="dot" style="background:var(--fail);margin-top:6px"></span>' +
          '<span style="line-height:1.5"><b style="color:var(--ink)">' + esc(p.label) + ':</b> ' + p.text + '</span></div>';
      }).join('') + '</div></div>';

    // SECTION 3 — Safety Program Health: the numbers a safety department leads
    // with. Lagging rates on top, program standing below (computed from data).
    var recordables = (B.incidents || []).filter(function (i) { return i.osha_recordable; }).length;
    var openCA = (B.findings || []).filter(function (f) { return f.status === 'open'; }).length;
    var overdueCA = (B.findings || []).filter(caOverdue).length;
    var nearMiss = (B.near_misses || []).length;
    var certsAll = B.certs || [];
    var certsExpired = certsAll.filter(function (c) { return certDays(c.expires) < 0; }).length;
    var trainPct = certsAll.length ? Math.round((certsAll.length - certsExpired) / certsAll.length * 100) : 100;
    var subsBlocked = (B.scorecard || []).filter(function (x) { return !x.cleared; }).length;
    var subsTotal = (B.scorecard || []).length;

    html += '<h3 class="sub" style="color:var(--ink);font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;margin:18px 0 8px">Safety Performance · Trailing 12 Months</h3>' +
      '<div class="cards">' +
        kpi('0.94', 'TRIR', 'Total recordable incident rate', 'c-grey') +
        kpi('0.62', 'DART Rate', 'Days away / restricted / transfer', 'c-grey') +
        kpi('23', 'Days Since Last Recordable', 'Company-wide', 'c-grey') +
        kpi('0.89', 'EMR', "Workers' compensation experience rating", 'c-grey') +
      '</div>';
    html += '<h3 class="sub" style="color:var(--ink-4);font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;margin:18px 0 8px">Program Standing</h3>' +
      '<div class="cards">' +
        kpi(String(recordables), 'Recordables YTD', recordables ? 'as determined by the employer' : 'none this year', 'c-grey') +
        kpi(String(openCA), 'Open Corrective Actions', overdueCA ? overdueCA + ' overdue — past due date' : 'all on time', overdueCA ? 'c-bad' : 'c-grey') +
        kpi(String(nearMiss), 'Near-Miss Reports (30d)', 'Leading indicator — reporting is good', 'c-grey') +
        kpi(trainPct + '%', 'Training Compliance', certsExpired ? certsExpired + ' certs expired' : 'internal certs current', certsExpired ? 'c-bad' : 'c-grey') +
        kpi(subsBlocked + ' of ' + subsTotal, 'Subcontractors Not Cleared', subsBlocked ? 'failing a prequal gate' : 'all subs cleared', subsBlocked ? 'c-bad' : 'c-grey') +
      '</div>';

    // Corrective Actions — open / overdue / closed and how fast they close.
    var caClosed = (B.findings || []).filter(function (f) { return f.status === 'closed'; }).length;
    var caCd = (B.findings || []).filter(function (f) { return f.status === 'closed' && f.closed; })
      .map(function (f) { return Math.round((new Date(f.closed) - new Date(f.date)) / 86400000); });
    var caAvg = caCd.length ? Math.round(caCd.reduce(function (a, b) { return a + b; }, 0) / caCd.length) : 0;
    html += '<h3 class="sub" style="color:var(--ink);font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;margin:18px 0 8px">Corrective Actions</h3>' +
      '<div class="cards">' +
        kpi(String(openCA), 'open', overdueCA ? overdueCA + ' overdue' : 'all on time', openCA ? 'c-warn' : 'c-ok') +
        kpi(String(overdueCA), 'overdue', overdueCA ? 'past due date' : 'none late', overdueCA ? 'c-bad' : 'c-ok') +
        kpi(String(caClosed), 'closed', 'corrective action verified', 'c-grey') +
        kpi(caAvg + 'd', 'avg days to close', 'open to verified', 'c-grey') +
      '</div>';

    paint(html);
    /* The digest is the notification story: this exact content goes out by
       email at 6:00 AM in the live build. Here it prints. */
    var dg = $('#digest');
    if (dg) dg.onclick = function () {
      var h = '<div class="small muted" style="margin-bottom:12px">What the live build emails the safety team at 6:00 AM.</div>';
      h += '<div class="sec-h">Needs attention</div>';
      needRows.forEach(function (n) {
        h += '<div style="border-bottom:1px solid var(--line);padding:9px 0">' +
          '<div class="t-main" style="font-weight:600">' + esc(n.what) + '</div>' +
          '<div class="small muted">' + esc(n.who) + '</div>' +
          '<div class="small" style="color:var(--fail);font-weight:600;margin-top:2px">' + esc(n.why) + '</div></div>';
      });
      h += '<div class="sec-h">Patterns</div>';
      patterns.forEach(function (p) {
        h += '<div class="bullet" style="padding:5px 0"><span class="dot" style="background:var(--fail);margin-top:6px"></span>' +
          '<span style="line-height:1.5"><b style="color:var(--ink)">' + esc(p.label) + ':</b> ' + p.text + '</span></div>';
      });
      h += '<div class="sec-h">Today’s accountability pulse</div>' +
        kv('Daily equipment scans', '42 of 45 cleared') +
        kv('Toolbox talks logged', '3 across 6 sites') +
        kv('Pending corrective actions', '4 open fixes');
      h += '<button class="btn btn-gold" id="dg-pdf" style="width:100%;justify-content:center;margin-top:16px">Download PDF</button>';
      drawer('Morning digest', new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), h);
      $('#dg-pdf').onclick = function () {
        var body = '<div class="sec">Needs attention</div>' +
          needRows.map(function (n) {
            return '<div class="row"><span>' + esc(n.what) + ' — ' + esc(n.who) +
              '</span><span class="chip bad">' + esc(n.why) + '</span></div>';
          }).join('') +
          '<div class="sec">Patterns</div>' +
          patterns.map(function (p) {
            return '<div class="row"><span>' + esc(p.label) + ': ' + p.text.replace(/<[^>]+>/g, '') + '</span></div>';
          }).join('') +
          '<div class="sec">Today’s accountability pulse</div>' +
          '<div class="row"><span>Daily equipment scans</span><span>42 of 45 cleared</span></div>' +
          '<div class="row"><span>Toolbox talks logged</span><span>3 across 6 sites</span></div>' +
          '<div class="row"><span>Pending corrective actions</span><span>4 open fixes</span></div>';
        printRecord('Morning Digest', 'What the live build emails the safety team at 6:00 AM', body);
      };
    };
  }
  /* Label above an ink number, status colour only on the sub-line — big
     coloured numerals read as alarm theatre, and this screen is looked at
     every day. */
  function kpi(n, label, sub, cls) {
    return '<div class="kpi"><div class="l">' + esc(label) + '</div>' +
      '<div class="n">' + esc(n) + '</div>' +
      '<div class="s ' + (cls || '') + '">' + esc(sub) + '</div></div>';
  }
  // Critical / action-required card: RED number + red accent (brand: red = act now).
  function actionKpi(n, label, sub) {
    return '<div class="kpi" style="border-left:3px solid var(--fail);padding-left:15px">' +
      '<div class="l">' + esc(label) + '</div>' +
      '<div class="n" style="color:var(--fail);font-size:32px;font-weight:800">' + esc(n) + '</div>' +
      '<div class="s c-grey">' + esc(sub) + '</div></div>';
  }

  /* ====================== PERMITS ======================================= */
  var permitTab = 'permits';
  var permF = { q: '', type: '', job: '' };
  var permLogF = { q: '', type: '', job: '', status: '', range: '' };   // Permit Log filters
  function pgPermits() {
    var right = subtabs(permitTab, [['permits', 'Permits'], ['awaiting', 'Awaiting Submission'], ['log', 'Permit Log'], ['archive', 'Archive']], 'pt');
    var all = (B.permits || []).filter(function (p) { return !p.archived; });

    function rows(list, archived) {
      return list.map(function (p) {
        var m = minsLeft(p), st;
        if (p.status === 'active')       st = m <= 60 ? pill('p-bad', 'Expires ' + fmtTime(p.expires_at)) : pill('p-ok', 'Active');
        else if (p.status === 'pending') st = pill('p-warn', 'Awaiting approval');
        else if (p.status === 'denied')  st = pill('p-bad', 'Denied');
        else if (p.status === 'expired') st = pill('p-grey', 'Expired');
        else                             st = pill('p-grey', 'Closed');
        return '<tr class="click" data-permit="' + esc(p.id) + '">' +
          '<td><span class="t-main">' + esc(permitLabel(p.type)) + '</span>' +
            '<div class="t-sub">' + esc(p.location) + '</div></td>' +
          '<td>' + esc(jobName(p.job_id)) + '<div class="t-sub">' + esc(jobNum(p.job_id)) + '</div></td>' +
          '<td>' + esc(subName(p.sub_id)) + '</td>' +
          '<td class="r num">' + p.workers.length + '</td>' +
          '<td class="r">' + st + '</td>' +
          '<td class="r"><button class="btn btn-sm" data-' + (archived ? 'permrestore' : 'permarch') + '="' + esc(p.id) + '">' +
            (archived ? 'Restore' : 'Archive') + '</button></td></tr>';
      });
    }
    var cols = [{ t: 'Permit' }, { t: 'Site' }, { t: 'Subcontractor' },
                { t: 'Workers', r: 1 }, { t: 'Status', r: 1 }, { t: '', r: 1 }];

    var html;
    if (permitTab === 'archive') {
      html = head('Work Permits', 'Permits moved out of the active list. Restore one to bring it back.', right);
      var paq = (subQ.permArch || '').toLowerCase();
      var arch = (B.permits || []).filter(function (p) {
        return p.archived && has(permitLabel(p.type) + ' ' + (p.location || '') + ' ' + jobName(p.job_id) + ' ' + subName(p.sub_id), paq); });
      html += fbarSearch('pmarch-q', subQ.permArch, 'Search archived permits…');
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(cols, rows(arch, true), 'Nothing archived.') + '</div></div>';
    } else if (permitTab === 'awaiting') {
      // Digitally sent permit FORMS not yet submitted — a DELIVERY state, not an
      // approval state. Reads the demo delivery dataset; excludes submitted ones
      // (those live in the normal permit system / Permit Log). No approval UI.
      html = head('Work Permits',
        'Digitally sent permit forms still awaiting submission — sent but not opened, or ' +
        'opened but not yet submitted. Once submitted, the permit appears in the permit system.', right);
      var pawq = (subQ.permAwait || '').toLowerCase();
      html += fbarSearch('pmaw-q', subQ.permAwait, 'Search awaiting submission…');
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Sent To' }, { t: 'Permit' }, { t: 'Site' }, { t: 'Sent' }, { t: 'Opened' }, { t: 'Status', r: 1 }],
        awaitingRows(B.permit_sends, 'permit', function (s) { return permitLabel(s.type); }, pawq),
        'Nothing awaiting submission.') + '</div></div>';
    } else if (permitTab === 'log') {
      // Permanent permit history, derived from the existing permit records only.
      // Excludes archived permits (Archive stays its own view) and the approval-
      // workflow statuses (pending/denied) so the default demo doesn't surface
      // approvals — the records and their status handling remain untouched.
      html = head('Work Permits',
        'A permanent record of every work permit — active, closed and expired — newest first, across all jobsites.', right);
      var logAll = (B.permits || []).filter(function (p) {
        return !p.archived && ['pending', 'denied'].indexOf(p.status) === -1; })
        .slice().sort(function (a, b) { return new Date(b.issued_at || 0) - new Date(a.issued_at || 0); });

      var lTypeSet = {}, lJobSet = {};
      logAll.forEach(function (p) { lTypeSet[p.type] = 1; if (p.job_id) lJobSet[p.job_id] = 1; });
      var lTypeOpts = Object.keys(lTypeSet).map(function (t) {
        return '<option value="' + esc(t) + '"' + (permLogF.type === t ? ' selected' : '') + '>' + esc(permitLabel(t)) + '</option>'; }).join('');
      var lJobOpts = Object.keys(lJobSet).map(function (id) {
        return '<option value="' + esc(id) + '"' + (permLogF.job === id ? ' selected' : '') + '>' + esc(jobName(id)) + '</option>'; }).join('');
      var lStatOpts = [['', 'Any status'], ['active', 'Active'], ['closed', 'Closed'], ['expired', 'Expired']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (permLogF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      var lRangeOpts = [['', 'Any date'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (permLogF.range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="permlog-q" placeholder="Search permits…" value="' + esc(permLogF.q) + '"></div>' +
        '<select id="permlog-type"><option value="">All types</option>' + lTypeOpts + '</select>' +
        '<select id="permlog-job"><option value="">All jobsites</option>' + lJobOpts + '</select>' +
        '<select id="permlog-status">' + lStatOpts + '</select>' +
        '<select id="permlog-range">' + lRangeOpts + '</select></div>';

      var plq = (permLogF.q || '').toLowerCase();
      var plcut = permLogF.range ? new Date(Date.now() - (+permLogF.range) * 86400000) : null;
      var logRows = logAll.filter(function (p) {
        if (permLogF.type && p.type !== permLogF.type) return false;
        if (permLogF.job && p.job_id !== permLogF.job) return false;
        if (permLogF.status && p.status !== permLogF.status) return false;
        if (plcut && new Date(p.issued_at || 0) < plcut) return false;
        if (plq && (permitLabel(p.type) + ' ' + (p.location || '') + ' ' + jobName(p.job_id) + ' ' + subName(p.sub_id)).toLowerCase().indexOf(plq) === -1) return false;
        return true;
      });

      html += '<div class="panel"><div class="panel-hd"><div><h3>Permit log</h3>' +
        '<div class="sub">' + logRows.length + ' of ' + logAll.length + ' shown · newest first</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: 'Date / Time' }, { t: 'Permit' }, { t: 'Site' }, { t: 'Subcontractor' }, { t: 'Workers', r: 1 }, { t: 'Status', r: 1 }],
        logRows.map(function (p) {
          var m = minsLeft(p), st;
          if (p.status === 'active')       st = m <= 60 ? pill('p-bad', 'Expires ' + fmtTime(p.expires_at)) : pill('p-ok', 'Active');
          else if (p.status === 'expired') st = pill('p-grey', 'Expired');
          else                             st = pill('p-grey', 'Closed');
          return '<tr class="click" data-permit="' + esc(p.id) + '">' +
            '<td>' + (p.issued_at ? esc(fmtWhen(p.issued_at)) : '—') + '</td>' +
            '<td><span class="t-main">' + esc(permitLabel(p.type)) + '</span>' +
              '<div class="t-sub">' + esc(p.location) + '</div></td>' +
            '<td>' + esc(jobName(p.job_id)) + '<div class="t-sub">' + esc(jobNum(p.job_id)) + '</div></td>' +
            '<td>' + esc(subName(p.sub_id)) + '</td>' +
            '<td class="r num">' + p.workers.length + '</td>' +
            '<td class="r">' + st + '</td></tr>';
        }), 'No permits in the log.') + '</div></div>';
    } else {
      html = head('Work Permits',
        'Track confined space, excavation, working at height, energized electrical, hot work and ' +
        'critical lift permits. Each permit is tied to a jobsite, crew and active work window, with ' +
        'a permanent history after it closes or expires. Click one to review, monitor or close it out.', right);

      var typeSet = {}, jobSet = {};
      all.forEach(function (p) { typeSet[p.type] = 1; if (p.job_id) jobSet[p.job_id] = 1; });
      var pTypeOpts = Object.keys(typeSet).map(function (t) {
        return '<option value="' + esc(t) + '"' + (permF.type === t ? ' selected' : '') + '>' + esc(permitLabel(t)) + '</option>'; }).join('');
      var pJobOpts = Object.keys(jobSet).map(function (id) {
        return '<option value="' + esc(id) + '"' + (permF.job === id ? ' selected' : '') + '>' + esc(jobName(id)) + '</option>'; }).join('');
      var pq = permF.q.toLowerCase();
      var shown = all.filter(function (p) {
        if (permF.type && p.type !== permF.type) return false;
        if (permF.job && p.job_id !== permF.job) return false;
        if (pq && (permitLabel(p.type) + ' ' + (p.location || '') + ' ' + jobName(p.job_id) + ' ' + subName(p.sub_id) + ' ' + (p.requested_by || '')).toLowerCase().indexOf(pq) === -1) return false;
        return true;
      });
      var active  = shown.filter(function (p) { return p.status === 'active'; }).sort(function (a, b) { return minsLeft(a) - minsLeft(b); });
      var soon = active.filter(function (p) { return minsLeft(p) <= 60; }).length;
      html += '<div class="cards">' +
        kpi(active.length, 'active now', 'work happening under these', active.length ? 'c-ok' : 'c-grey') +
        kpi(soon, 'expiring within 1h', 'requires attention soon', soon ? 'c-bad' : 'c-ok') +
        '</div>';
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="pm-q" placeholder="Search permits…" value="' + esc(permF.q) + '"></div>' +
        '<select id="pm-type"><option value="">All types</option>' + pTypeOpts + '</select>' +
        '<select id="pm-job"><option value="">All jobsites</option>' + pJobOpts + '</select></div>';
      function block(title, sub, list) {
        if (!list.length) return '';
        return '<div class="panel"><div class="panel-hd"><div><h3>' + esc(title) + '</h3>' +
          '<div class="sub">' + esc(sub) + '</div></div></div>' +
          '<div class="panel-bd flush">' + tableWrap(cols, rows(list)) + '</div></div>';
      }
      html += block('Active now', 'Work is happening under these right now.', active);
    }
    paint(html);
    wireSubtabs('pt', function (v) { permitTab = v; pgPermits(); });
    $$('[data-permarch]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation();
      var p = (B.permits || []).filter(function (x) { return x.id === b.dataset.permarch; })[0];
      if (p) p.archived = true; toast('Permit archived.'); pgPermits(); }; });
    $$('[data-permrestore]').forEach(function (b) { b.onclick = function () {
      var p = (B.permits || []).filter(function (x) { return x.id === b.dataset.permrestore; })[0];
      if (p) p.archived = false; toast('Permit restored.'); pgPermits(); }; });
    function pmBind(id, key) { var e = $('#' + id); if (e) e.oninput = e.onchange = function () { permF[key] = e.value; pgPermits(); }; }
    pmBind('pm-q', 'q'); pmBind('pm-type', 'type'); pmBind('pm-job', 'job');
    var _pmq = $('#pm-q'); if (_pmq && permF.q) { _pmq.focus(); try { _pmq.setSelectionRange(_pmq.value.length, _pmq.value.length); } catch (e) {} }
    if (permitTab === 'archive') wireSearch('pmarch-q', function (v) { subQ.permArch = v; pgPermits(); });
    if (permitTab === 'awaiting') {
      wireSearch('pmaw-q', function (v) { subQ.permAwait = v; pgPermits(); });
      $$('[data-permitsend]').forEach(function (r) { r.onclick = function () { openPermitSend(r.dataset.permitsend); }; });
    }
    if (permitTab === 'log') {
      wireSearch('permlog-q', function (v) { permLogF.q = v; pgPermits(); });
      function plBind(id, key) { var e = $('#' + id); if (e) e.onchange = function () { permLogF[key] = e.value; pgPermits(); }; }
      plBind('permlog-type', 'type'); plBind('permlog-job', 'job'); plBind('permlog-status', 'status'); plBind('permlog-range', 'range');
    }
  }

  /* ====================== INCIDENTS ===================================== */
  var CLASS = { recordable: 'OSHA recordable', first_aid: 'First aid',
                near_miss: 'Near miss', property: 'Property damage' };
  var incF = { job: '', cls: '', status: '', range: '' };   // Incidents table filters
  var incTab = 'incidents';
  function pgIncidents() {
    var right = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">' +
      subtabs(incTab, [['incidents', 'Incidents'], ['reg', 'Regulatory Visits']], 'ic') +
      (incTab === 'incidents'
        ? '<button class="btn btn-gold" id="new-inc">Report incident</button>'
        : '<button class="btn btn-gold" id="new-reg">Log visit</button>') + '</div>';
    if (incTab === 'reg') { pgRegVisits(right); return; }
    // Near Misses have their own dedicated module — exclude near-miss-classified
    // records from Incidents (display/scope only; the records stay in the data).
    // Fictional demo_sample incidents are hidden here so they are never mistaken
    // for genuine Greiner history; the records remain in the data for the clearly
    // labeled Injury Analytics sample.
    var all = (B.incidents || []).filter(function (i) { return i.classification !== 'near_miss' && !i.demo_sample; });
    var rec = all.filter(function (i) { return i.osha_recordable; });
    var away = all.reduce(function (a, i) { return a + i.days_away; }, 0);
    var restricted = all.reduce(function (a, i) { return a + i.restricted_days; }, 0);
    var incOpenN = all.filter(function (i) { return i.status !== 'closed'; }).length;
    var caOpenN = all.reduce(function (n, i) {
      return n + (i.corrective || []).filter(function (x) { return x.status === 'open'; }).length; }, 0);

    var html = head('Incidents & Injuries',
      'Report, investigate, root cause, corrective action. Recordability is recorded as ' +
      'what the employer determined — this tool captures the determination, it does not make it.',
      right);

    html += '<div class="cards">' +
      kpi(all.length, 'incidents this year', 'incident and injury records', 'c-grey') +
      kpi(rec.length, 'recordable', 'as determined by the employer', rec.length ? 'c-bad' : 'c-ok') +
      kpi(incOpenN, 'under investigation', caOpenN + ' corrective action' + (caOpenN === 1 ? '' : 's') + ' open', incOpenN ? 'c-warn' : 'c-ok') +
      kpi(away + restricted, 'away + restricted days', away + ' away · ' + restricted + ' restricted', 'c-grey') +
      '</div>';

    // filters: search (existing) + jobsite + classification + status + date
    var incJobSet = {}, incClsSet = {};
    all.forEach(function (i) { if (i.job_id) incJobSet[i.job_id] = 1; if (i.classification) incClsSet[i.classification] = 1; });
    var incJobOpts = Object.keys(incJobSet).map(function (id) {
      return '<option value="' + esc(id) + '"' + (incF.job === id ? ' selected' : '') + '>' + esc(jobName(id)) + '</option>'; }).join('');
    var incClsOpts = Object.keys(incClsSet).map(function (cl) {
      return '<option value="' + esc(cl) + '"' + (incF.cls === cl ? ' selected' : '') + '>' + esc(CLASS[cl] || cl) + '</option>'; }).join('');
    var incStatOpts = [['', 'Any status'], ['investigating', 'Investigating'], ['closed', 'Closed']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (incF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    var incRangeOpts = [['', 'Any date'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (incF.range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    html += '<div class="fbar">' +
      '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<input id="inc-q" placeholder="Search incidents…" value="' + esc(subQ.incMain || '') + '"></div>' +
      '<select id="inc-job"><option value="">All jobsites</option>' + incJobOpts + '</select>' +
      '<select id="inc-cls"><option value="">Any classification</option>' + incClsOpts + '</select>' +
      '<select id="inc-status">' + incStatOpts + '</select>' +
      '<select id="inc-range">' + incRangeOpts + '</select></div>';

    var iq = (subQ.incMain || '').toLowerCase();
    var icut = incF.range ? new Date(Date.now() - (+incF.range) * 86400000) : null;
    var shownInc = all.filter(function (i) {
      if (incF.job && i.job_id !== incF.job) return false;
      if (incF.cls && i.classification !== incF.cls) return false;
      if (incF.status && i.status !== incF.status) return false;
      if (icut && new Date(i.date + 'T00:00:00') < icut) return false;
      return has((CLASS[i.classification] || '') + ' ' + (i.injured || '') + ' ' + jobName(i.job_id) + ' ' + subName(i.sub_id), iq); });
    // Investigating (unresolved) first, then closed — newest first within each group.
    shownInc.sort(function (a, b) {
      var ac = a.status === 'closed', bc = b.status === 'closed';
      if (ac !== bc) return ac ? 1 : -1;
      return new Date(b.date) - new Date(a.date);
    });

    var rows = shownInc.map(function (i) {
      var openCa = i.corrective.filter(function (x) { return x.status === 'open'; }).length;
      return '<tr class="click" data-inc="' + esc(i.id) + '">' +
        '<td><span class="t-main">' + esc(CLASS[i.classification]) + '</span>' +
          '<div class="t-sub">' + esc(i.injured || 'No injury') + '</div></td>' +
        '<td>' + esc(fmtDate(i.date)) + '<div class="t-sub">' + esc(i.time) + '</div></td>' +
        '<td>' + esc(jobName(i.job_id)) + '<div class="t-sub">' + esc(subName(i.sub_id)) + '</div></td>' +
        '<td>' + (i.osha_recordable ? pill('p-bad', 'Recordable') : pill('p-grey', 'Not recordable')) + '</td>' +
        '<td class="r num">' + (openCa ? '<span class="c-warn">' + openCa + ' open</span>' : '—') + '</td>' +
        '<td class="r">' + (i.status === 'closed' ? pill('p-ok', 'Closed') : pill('p-warn', 'Investigating')) + '</td>' +
        '</tr>';
    });
    html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Classification' }, { t: 'When' }, { t: 'Site / sub' }, { t: 'OSHA' },
       { t: 'Corrective', r: 1 }, { t: 'Status', r: 1 }], rows,
      all.length ? 'No incidents match these filters.' : 'No Greiner incidents recorded in this demo dataset.') +
      '</div></div>';
    paint(html);
    wireSubtabs('ic', function (v) { incTab = v; pgIncidents(); });
    wireSearch('inc-q', function (v) { subQ.incMain = v; pgIncidents(); });
    function incBind(id, key) { var e = $('#' + id); if (e) e.onchange = function () { incF[key] = e.value; pgIncidents(); }; }
    incBind('inc-job', 'job'); incBind('inc-cls', 'cls'); incBind('inc-status', 'status'); incBind('inc-range', 'range');
    var nb = $('#new-inc');
    if (nb) nb.onclick = openNewIncident;
  }

  /* Regulatory visits: a log, not a module. The day OSHA shows up is rare,
     but it is the day this screen earns the product's keep. Abatement items
     ARE corrective actions — same editor, same queue. */
  function pgRegVisits(right) {
    var all = B.reg_visits || [];
    var openAb = all.reduce(function (a, v) {
      return a + v.abatement.filter(function (x) { return x.status === 'open'; }).length; }, 0);
    var html = head('Regulatory Visits',
      'Who came, what they looked at, what they cited, and where abatement stands. ' +
      'Citations file into Documents; abatement items live in the same corrective-action ' +
      'queue as everything else.', right);
    html += '<div class="cards">' +
      kpi(all.length, 'visits on record', 'all agencies', 'c-grey') +
      kpi(all.reduce(function (a, v) { return a + v.citations.length; }, 0), 'citations',
          'across all visits', 'c-grey') +
      kpi(openAb, 'abatement items open', openAb ? 'deadlines in Needs Attention' : 'all closed',
          openAb ? 'c-bad' : 'c-ok') +
      '</div>';
    html += fbarSearch('reg-q', subQ.regMain, 'Search regulatory visits…');
    var rq = (subQ.regMain || '').toLowerCase();
    var shownReg = all.filter(function (v) {
      return has((v.agency || '') + ' ' + (v.inspector || '') + ' ' + (v.reason || '') + ' ' + jobName(v.job_id), rq); });
    var rows = shownReg.map(function (v) {
      return '<tr class="click" data-reg="' + esc(v.id) + '">' +
        '<td><span class="t-main">' + esc(v.agency) + ' · ' + esc(v.inspector) + '</span>' +
        '<div class="t-sub">' + esc(v.reason) + '</div></td>' +
        '<td>' + esc(fmtDate(v.date)) + '</td>' +
        '<td>' + esc(jobName(v.job_id)) + '</td>' +
        '<td class="r num">' + (v.citations.length || '—') + '</td>' +
        '<td class="r">' + (v.status === 'closed' ? pill('p-ok', 'Closed')
          : v.status === 'abatement' ? pill('p-warn', 'Abatement open')
          : pill('p-warn', 'Open')) + '</td></tr>';
    });
    html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Visit' }, { t: 'Date' }, { t: 'Site' }, { t: 'Citations', r: 1 },
       { t: 'Status', r: 1 }], rows, 'No regulatory visits on record.') + '</div></div>';
    paint(html);
    wireSubtabs('ic', function (v) { incTab = v; pgIncidents(); });
    wireSearch('reg-q', function (v) { subQ.regMain = v; pgIncidents(); });
    $$('[data-reg]').forEach(function (tr) {
      tr.onclick = function () { openRegVisit(tr.dataset.reg); };
    });
    var nb = $('#new-reg');
    if (nb) nb.onclick = openNewRegVisit;
  }

  // Everything a regulator visit generates — seeded once, then keep adding.
  function seedRegVisitDocs(v) {
    var out = [{ name: v.agency + ' Visit Notes — ' + v.id + '.pdf', added: v.date }];
    (v.citations || []).forEach(function (ct, i) {
      out.push({ name: 'Citation ' + (i + 1) + ' — ' + ct.standard + '.pdf', added: v.date });
    });
    if ((v.citations || []).length) out.push({ name: 'Notice of Penalty.pdf', added: v.date });
    return out;
  }

  function openRegVisit(id) {
    var v = (B.reg_visits || []).filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    var h = pdfBtn('dl-reg');
    h += '<div class="sec-h">Visit</div>' +
      kv('Agency', v.agency) + kv('Inspector', v.inspector) +
      kv('Date', fmtDate(v.date)) + kv('Site', jobName(v.job_id)) +
      kv('Reason', v.reason);
    if (v.areas.length) h += '<div class="sec-h">Areas reviewed</div>' +
      v.areas.map(function (a) {
        return '<div class="bullet"><span class="m d">•</span><span>' + esc(a) + '</span></div>';
      }).join('');
    if (v.interviewed.length) h += '<div class="sec-h">Employees interviewed</div>' +
      '<div class="small">' + esc(v.interviewed.join(', ')) + '</div>';
    if (v.docs_requested.length) h += '<div class="sec-h">Documents requested</div>' +
      v.docs_requested.map(function (a) {
        return '<div class="bullet"><span class="m d">•</span><span>' + esc(a) + '</span></div>';
      }).join('');
    if (v.findings) h += '<div class="sec-h">Findings</div><div class="small">' + esc(v.findings) + '</div>';
    if (v.citations.length) {
      h += '<div class="sec-h">Citations</div>';
      v.citations.forEach(function (ct) {
        h += '<div class="alert"><strong>' + esc(ct.standard) + '</strong> — ' + esc(ct.description) +
          '<div class="small muted" style="margin-top:.3rem">Penalty $' + ct.penalty.toLocaleString() +
          ' · abatement due ' + esc(fmtDate(ct.abatement_due)) +
          ' · citation PDF filed under Documents → OSHA Recordkeeping</div></div>';
      });
    }
    if (v.abatement.length) {
      h += '<div class="sec-h">Abatement</div>';
      v.abatement.forEach(function (ab, ix) {
        h += '<div class="fixbox"><div>' + esc(ab.action) + '</div>' +
          '<div class="who">' + esc(ab.owner) + ' · due ' + esc(fmtDate(ab.due)) + ' · ' +
          (ab.status === 'open' ? '<span style="color:var(--warn);font-weight:700">Open</span>' : 'Closed') +
          ' &nbsp;<button class="linklike" data-editca="reg|' + esc(v.id) + '|' + ix + '">Edit</button>' +
          '</div></div>';
      });
    }
    // Document file — store every document that comes from this visit.
    if (!v.docs) v.docs = seedRegVisitDocs(v);
    h += '<div class="sec-h">Documents <span class="small muted" style="font-weight:400">· ' +
      v.docs.length + ' on file</span></div>' +
      '<div id="reg-docs">' + (v.docs.length ? v.docs.map(function (d, ix) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px">' +
          '<span style="font-size:16px;flex-shrink:0">' + docIcon(d.name) + '</span>' +
          '<div style="flex:1;min-width:0"><div class="t-main" style="font-size:13px;word-break:break-word">' + esc(d.name) + '</div>' +
          (d.added ? '<div class="t-sub">Added ' + fmtDate(d.added) + '</div>' : '') + '</div>' +
          '<button class="linklike" data-rmregdoc="' + ix + '" style="color:var(--fail)">Remove</button></div>';
      }).join('') : '<div class="small muted" style="margin-bottom:6px">No documents yet.</div>') + '</div>' +
      '<input type="file" id="reg-files" multiple style="margin-top:4px;font-size:12.5px">' +
      '<button class="btn btn-gold btn-sm" id="reg-add" style="margin-top:8px">Add documents</button>' +
      '<p class="small muted" style="margin-top:.5rem">Citations, notes, correspondence, abatement ' +
      'proof — every document from this visit lives here.</p>';

    drawer(v.agency + ' visit', fmtDate(v.date) + ' · ' + jobName(v.job_id), h);
    $$('.drawer [data-editca]').forEach(function (b) {
      b.onclick = function () { openCA(b.dataset.editca); };
    });
    var regAdd = $('#reg-add');
    if (regAdd) regAdd.onclick = function () {
      var files = ($('#reg-files') || {}).files;
      if (!files || !files.length) { toast('Choose a file to add first.'); return; }
      var today = new Date().toISOString().slice(0, 10);
      Array.prototype.forEach.call(files, function (f) { v.docs.push({ name: f.name, added: today }); });
      toast(files.length + ' document' + (files.length === 1 ? '' : 's') + ' added.');
      openRegVisit(id);
    };
    $$('.drawer [data-rmregdoc]').forEach(function (b) {
      b.onclick = function () { v.docs.splice(+b.dataset.rmregdoc, 1); openRegVisit(id); };
    });
    $('#dl-reg').onclick = function () {
      printRecord(v.agency + ' Visit Record', fmtDate(v.date) + ' · ' + jobName(v.job_id) +
        ' · ' + v.inspector,
        '<div class="sec">Reason</div><div style="font-size:12.5px">' + esc(v.reason) + '</div>' +
        (v.findings ? '<div class="sec">Findings</div><div style="font-size:12.5px">' + esc(v.findings) + '</div>' : '') +
        v.citations.map(function (ct) {
          return '<div class="fix">' + esc(ct.standard) + ' — ' + esc(ct.description) +
            '<div class="who">$' + ct.penalty.toLocaleString() + ' · abatement due ' +
            esc(fmtDate(ct.abatement_due)) + '</div></div>';
        }).join(''));
    };
  }

  function openNewRegVisit() {
    var todayStr = new Date().toISOString().slice(0, 10);
    var h = '<div class="f"><label for="rg-agency">Agency</label>' +
      '<input type="text" id="rg-agency" value="IOSHA"></div>' +
      '<div class="f"><label for="rg-date">Date of visit</label>' +
      '<input type="date" id="rg-date" value="' + todayStr + '"></div>' +
      '<div class="f"><label for="rg-insp">Inspector</label>' +
      '<input type="text" id="rg-insp" placeholder="Name shown on credentials"></div>' +
      '<div class="f"><label for="rg-job">Site</label><select id="rg-job">' +
      (B.jobs || []).map(function (j) {
        return '<option value="' + esc(j.id) + '">' + esc(j.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="f"><label for="rg-reason">Reason for visit</label>' +
      '<textarea id="rg-reason" rows="2" style="width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px"></textarea></div>' +
      '<p class="small" id="rg-err" style="color:var(--fail);min-height:1em"></p>' +
      '<button class="btn btn-gold" id="rg-save" style="width:100%;justify-content:center">Log the visit</button>' +
      '<p class="small muted" style="margin-top:.7rem">Log it while they are on site. Areas ' +
      'reviewed, citations and abatement get added to the record as they arrive.</p>';
    drawer('Log regulatory visit', 'The five-minute version, expandable later', h);
    $('#rg-save').onclick = function () {
      var reason = $('#rg-reason').value.trim();
      if (!reason) { $('#rg-err').textContent = 'Why are they here?'; return; }
      post('cs_portal_add_reg_visit', { p_agency: $('#rg-agency').value.trim(),
        p_date: $('#rg-date').value || null,
        p_inspector: $('#rg-insp').value.trim(), p_job_id: $('#rg-job').value,
        p_reason: reason })
        .then(function () {
          closeDrawer(); toast('Visit logged');
          refreshBundle().then(pgIncidents);
        });
    };
  }

  /* Intake takes a minute; investigation comes after. The form asks only what
     is knowable in the first hour — classification, who, where, what happened,
     what was done. Root cause is deliberately NOT on this form. */
  function openNewIncident() {
    var todayStr = new Date().toISOString().slice(0, 10);
    var h = '<div class="f"><label for="in-class">Classification</label>' +
      '<select id="in-class">' +
      '<option value="first_aid">First aid</option>' +
      '<option value="recordable">Recordable (as determined by the employer)</option>' +
      '<option value="property">Property damage</option></select></div>' +
      '<div class="f"><label for="in-date">Date it happened</label>' +
      '<input type="date" id="in-date" value="' + todayStr + '"></div>' +
      '<div class="f"><label for="in-job">Site</label><select id="in-job">' +
      (B.jobs || []).map(function (j) {
        return '<option value="' + esc(j.id) + '">' + esc(j.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="f"><label for="in-sub">Involved crew</label><select id="in-sub">' +
      '<option value="">Our own workforce</option>' +
      (B.subs || []).map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="f" id="in-injwrap"><label for="in-injured">Injured person</label>' +
      '<input type="text" id="in-injured" autocomplete="off" placeholder="Name"></div>' +
      '<div class="f"><label for="in-body">Body part / nature</label>' +
      '<input type="text" id="in-body" placeholder="e.g. Left forearm — laceration"></div>' +
      '<div class="f"><label for="in-desc">What happened</label>' +
      '<textarea id="in-desc" rows="3" style="width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px"></textarea></div>' +
      '<div class="f"><label for="in-act">Immediate action taken</label>' +
      '<textarea id="in-act" rows="2" style="width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px"></textarea></div>' +
      '<p class="small" id="in-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
      '<button class="btn btn-gold" id="in-save" style="width:100%;justify-content:center">Log incident</button>' +
      '<p class="small muted" style="margin-top:.7rem">Opens as “investigating,” assigned to you. ' +
      'Root cause and corrective actions are added from the incident record, not here.</p>';
    drawer('Report incident', 'First-hour intake', h);
    $('#in-save').onclick = function () {
      var desc = $('#in-desc').value.trim();
      if (!desc) { $('#in-err').textContent = 'Describe what happened.'; return; }
      var body = $('#in-body').value.trim();
      var parts = body.split(/\s*[—-]\s*/);
      var sess = getSession() || {};
      post('cs_portal_add_incident', {
        p_classification: $('#in-class').value,
        p_date: $('#in-date').value || null,
        p_job_id: $('#in-job').value,
        p_sub_id: $('#in-sub').value || null,
        p_injured: $('#in-injured').value.trim() || null,
        p_body_part: parts[0] || null, p_nature: parts[1] || null,
        p_description: desc,
        p_immediate_action: $('#in-act').value.trim(),
        p_investigator: sess.user || 'Safety'
      }).then(function () {
        closeDrawer();
        toast('Incident logged — investigation open');
        refreshBundle().then(pgIncidents);
      }).catch(function (e) { $('#in-err').textContent = e.message; });
    };
  }

  /* ====================== NEAR MISSES =================================== */
  var NM_SEVP = { high: ['p-bad', 'High potential'], medium: ['p-warn', 'Medium potential'], low: ['p-grey', 'Low potential'] };
  function nmSevPill(s) { var m = NM_SEVP[s] || ['p-grey', s]; return pill(m[0], m[1]); }
  function nmStatusPill(s) { return s === 'closed' ? pill('p-ok', 'Closed') : s === 'reviewed' ? pill('p-grey', 'Reviewed') : pill('p-warn', 'Open'); }
  var nmF = { job: '', sev: '', status: '', range: '' };   // Near Miss table filters
  function pgNearMiss() {
    var all = B.near_misses || [];
    var open = all.filter(function (n) { return n.status !== 'closed'; }).length;   // open + reviewed = not yet closed
    var high = all.filter(function (n) { return n.severity === 'high'; }).length;
    var html = head('Near Misses',
      'Close calls with no injury — the early warning. Reported from the field, reviewed and ' +
      'closed here. A near miss caught today is the incident that never happens.',
      '<button class="btn btn-gold" id="new-nm">Report near miss</button>');
    html += '<div class="cards">' +
      kpi(all.length, 'reported this year', 'all sites', 'c-grey') +
      kpi(open, 'open / under review', open ? 'not yet closed' : 'all closed', open ? 'c-warn' : 'c-ok') +
      kpi(high, 'high potential', 'serious or fatal potential', high ? 'c-bad' : 'c-ok') +
      '</div>';
    // filters: search (existing) + jobsite + potential + status + date
    var nmJobSet = {}; all.forEach(function (n) { if (n.job_id) nmJobSet[n.job_id] = 1; });
    var nmJobOpts = Object.keys(nmJobSet).map(function (id) {
      return '<option value="' + esc(id) + '"' + (nmF.job === id ? ' selected' : '') + '>' + esc(jobName(id)) + '</option>'; }).join('');
    var nmSevOpts = [['', 'Any potential'], ['high', 'High potential'], ['medium', 'Medium potential'], ['low', 'Low potential']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (nmF.sev === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    var nmStatOpts = [['', 'Any status'], ['open', 'Open'], ['reviewed', 'Reviewed'], ['closed', 'Closed']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (nmF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    var nmRangeOpts = [['', 'Any date'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (nmF.range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    html += '<div class="fbar">' +
      '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<input id="nm-q" placeholder="Search near misses…" value="' + esc(subQ.nearMain || '') + '"></div>' +
      '<select id="nm-job"><option value="">All jobsites</option>' + nmJobOpts + '</select>' +
      '<select id="nm-sev">' + nmSevOpts + '</select>' +
      '<select id="nm-status">' + nmStatOpts + '</select>' +
      '<select id="nm-range">' + nmRangeOpts + '</select></div>';
    var nq = (subQ.nearMain || '').toLowerCase();
    var ncut = nmF.range ? new Date(Date.now() - (+nmF.range) * 86400000) : null;
    var shownNm = all.filter(function (n) {
      if (nmF.job && n.job_id !== nmF.job) return false;
      if (nmF.sev && n.severity !== nmF.sev) return false;
      if (nmF.status && n.status !== nmF.status) return false;
      if (ncut && new Date(n.date + 'T00:00:00') < ncut) return false;
      return has((n.description || '') + ' ' + (n.potential || '') + ' ' + jobName(n.job_id) + ' ' + subName(n.sub_id) + ' ' + (n.reported_by || ''), nq); });
    // Priority: high-potential open → other open → reviewed → closed; newest first within each group.
    shownNm.sort(function (a, b) {
      function rank(n) { return n.status === 'open' ? (n.severity === 'high' ? 0 : 1) : n.status === 'reviewed' ? 2 : 3; }
      var ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return new Date(b.date) - new Date(a.date);
    });
    var rows = shownNm.map(function (n) {
      return '<tr data-nm="' + esc(n.id) + '" style="cursor:pointer">' +
        '<td><span class="t-main">' + esc(n.description.length > 70 ? n.description.slice(0, 70) + '…' : n.description) + '</span>' +
          '<div class="t-sub">' + esc(n.potential || '') + '</div></td>' +
        '<td>' + esc(fmtDate(n.date)) + '<div class="t-sub">' + esc(n.time || '') + '</div></td>' +
        '<td>' + esc(jobName(n.job_id)) + '<div class="t-sub">' + esc(subName(n.sub_id)) + '</div></td>' +
        '<td>' + nmSevPill(n.severity) + '</td>' +
        '<td class="r">' + (n.status === 'closed' ? pill('p-ok', 'Closed')
          : n.status === 'reviewed' ? pill('p-grey', 'Reviewed') : pill('p-warn', 'Open')) + '</td></tr>';
    });
    html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Near miss' }, { t: 'When' }, { t: 'Site / crew' }, { t: 'Potential' }, { t: 'Status', r: 1 }],
      rows, 'No near misses match these filters.') + '</div></div>';
    paint(html);
    wireSearch('nm-q', function (v) { subQ.nearMain = v; pgNearMiss(); });
    function nmBind(id, key) { var e = $('#' + id); if (e) e.onchange = function () { nmF[key] = e.value; pgNearMiss(); }; }
    nmBind('nm-job', 'job'); nmBind('nm-sev', 'sev'); nmBind('nm-status', 'status'); nmBind('nm-range', 'range');
    var nb = $('#new-nm'); if (nb) nb.onclick = openNewNearMiss;
    $$('[data-nm]').forEach(function (tr) { tr.onclick = function () { openNearMiss(tr.dataset.nm); }; });
  }

  function openNearMiss(id) {
    var n = (B.near_misses || []).filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    var h = '<button class="btn btn-gold btn-sm" id="nm-edit" style="margin-bottom:12px">Edit / add details</button>';
    h += '<div class="sec-h">What happened</div><div class="small">' + esc(n.description) + '</div>';
    h += '<div class="sec-h">What could have happened</div><div class="small">' + esc(n.potential || '—') + '</div>';
    h += '<div class="sec-h">Detail</div>' +
      kv('Potential severity', (NM_SEVP[n.severity] || ['', n.severity])[1]) +
      kv('Site', jobName(n.job_id)) + kv('Crew', subName(n.sub_id)) +
      kv('When', fmtDate(n.date) + ' ' + (n.time || '')) +
      kv('Reported by', n.reported_by) +
      '<div class="kv"><span class="k">Status</span><span class="v">' + nmStatusPill(n.status) + '</span></div>';
    h += '<div class="sec-h">Immediate action</div><div class="small">' + esc(n.immediate_action || '—') + '</div>';
    if ((n.corrective || []).length) {
      h += '<div class="sec-h">Corrective actions</div>' + n.corrective.map(function (c) {
        return '<div class="ca"><div><div>' + esc(c.action) + '</div>' +
          '<div class="small muted">' + esc(c.owner || '') + (c.due ? ' · due ' + esc(fmtDate(c.due)) : '') + '</div></div>' +
          (c.status === 'closed' ? pill('p-ok', 'Closed') : pill('p-warn', 'Open')) + '</div>';
      }).join('');
    }
    // Documents — keep any files tied to the near miss.
    if (!n.docs) n.docs = [];
    h += '<div class="sec-h">Documents <span class="small muted" style="font-weight:400">· ' + n.docs.length + ' on file</span></div>' +
      '<div id="nm-docs">' + (n.docs.length ? n.docs.map(function (d, ix) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px">' +
          '<span style="font-size:16px;flex-shrink:0">' + docIcon(d.name) + '</span>' +
          '<div style="flex:1;min-width:0"><div class="t-main" style="font-size:13px;word-break:break-word">' + esc(d.name) + '</div>' +
          (d.added ? '<div class="t-sub">Added ' + fmtDate(d.added) + '</div>' : '') + '</div>' +
          '<button class="linklike" data-rmnmdoc="' + ix + '" style="color:var(--fail)">Remove</button></div>';
      }).join('') : '<div class="small muted" style="margin-bottom:6px">No documents yet.</div>') + '</div>' +
      '<input type="file" id="nm-files" multiple style="margin-top:4px;font-size:12.5px">' +
      '<button class="btn btn-gold btn-sm" id="nm-add" style="margin-top:8px">Add documents</button>';
    drawer('Near miss', fmtDate(n.date) + ' · ' + jobName(n.job_id), h);
    var ed = $('#nm-edit'); if (ed) ed.onclick = function () { openEditNearMiss(id); };
    var addB = $('#nm-add');
    if (addB) addB.onclick = function () {
      var files = ($('#nm-files') || {}).files;
      if (!files || !files.length) { toast('Choose a file to add first.'); return; }
      var today = new Date().toISOString().slice(0, 10);
      Array.prototype.forEach.call(files, function (f) { n.docs.push({ name: f.name, added: today }); });
      toast(files.length + ' document' + (files.length === 1 ? '' : 's') + ' added.'); openNearMiss(id);
    };
    $$('.drawer [data-rmnmdoc]').forEach(function (b) {
      b.onclick = function () { n.docs.splice(+b.dataset.rmnmdoc, 1); openNearMiss(id); };
    });
  }

  function openEditNearMiss(id) {
    var n = (B.near_misses || []).filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    n.corrective = n.corrective || [];
    var ta = 'width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px';
    function render() {
      var h = '<div class="f"><label for="en-desc">What happened</label><textarea id="en-desc" rows="3" style="' + ta + '">' + esc(n.description || '') + '</textarea></div>' +
        '<div class="f"><label for="en-pot">What could have happened</label><textarea id="en-pot" rows="2" style="' + ta + '">' + esc(n.potential || '') + '</textarea></div>' +
        '<div class="f"><label for="en-sev">Potential severity</label><select id="en-sev">' +
          [['low', 'Low potential'], ['medium', 'Medium potential'], ['high', 'High potential — serious or fatal']]
            .map(function (o) { return '<option value="' + o[0] + '"' + (n.severity === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="en-act">Immediate action</label><textarea id="en-act" rows="2" style="' + ta + '">' + esc(n.immediate_action || '') + '</textarea></div>' +
        '<div class="f"><label for="en-by">Reported by</label><input id="en-by" value="' + esc(n.reported_by || '') + '"></div>' +
        '<div class="f"><label for="en-status">Status</label><select id="en-status">' +
          [['open', 'Open'], ['reviewed', 'Reviewed'], ['closed', 'Closed']]
            .map(function (o) { return '<option value="' + o[0] + '"' + (n.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
      h += '<div class="sec-h">Corrective actions</div><div id="en-ca">';
      n.corrective.forEach(function (c, ix) {
        h += '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px">' +
          '<textarea class="en-caact" data-i="' + ix + '" rows="2" placeholder="Corrective action" style="' + ta + '">' + esc(c.action || '') + '</textarea>' +
          '<div style="display:flex;gap:8px;margin-top:6px"><input class="en-caown" data-i="' + ix + '" placeholder="Owner" value="' + esc(c.owner || '') + '" style="flex:1">' +
          '<input type="date" class="en-cadue" data-i="' + ix + '" value="' + esc(c.due || '') + '" style="flex:1">' +
          '<select class="en-castat" data-i="' + ix + '"><option value="open"' + (c.status !== 'closed' ? ' selected' : '') + '>Open</option><option value="closed"' + (c.status === 'closed' ? ' selected' : '') + '>Closed</option></select>' +
          '<button class="linklike" data-rmenca="' + ix + '" style="color:var(--fail)">×</button></div></div>';
      });
      h += '</div><button class="btn btn-sm" id="en-addca">+ Add corrective action</button>';
      h += '<div style="margin-top:16px"><button class="btn btn-gold" id="en-save" style="width:100%;justify-content:center">Save details</button>' +
        '<button class="btn" id="en-back" style="width:100%;justify-content:center;margin-top:8px">Cancel</button></div>';
      drawer('Edit near miss', fmtDate(n.date) + ' · ' + jobName(n.job_id), h);
      wire();
    }
    function wire() {
      function bind(elId, fn) { var e = $('#' + elId); if (e) e.oninput = e.onchange = function () { fn(e.value); }; }
      bind('en-desc', function (v) { n.description = v; });
      bind('en-pot', function (v) { n.potential = v; });
      bind('en-sev', function (v) { n.severity = v; });
      bind('en-act', function (v) { n.immediate_action = v; });
      bind('en-by', function (v) { n.reported_by = v; });
      bind('en-status', function (v) { n.status = v; });
      $$('.en-caact').forEach(function (e) { e.oninput = function () { n.corrective[+e.dataset.i].action = e.value; }; });
      $$('.en-caown').forEach(function (e) { e.oninput = function () { n.corrective[+e.dataset.i].owner = e.value; }; });
      $$('.en-cadue').forEach(function (e) { e.onchange = function () { n.corrective[+e.dataset.i].due = e.value; }; });
      $$('.en-castat').forEach(function (e) { e.onchange = function () { n.corrective[+e.dataset.i].status = e.value; }; });
      $$('[data-rmenca]').forEach(function (b) { b.onclick = function () { n.corrective.splice(+b.dataset.rmenca, 1); render(); }; });
      var ac = $('#en-addca'); if (ac) ac.onclick = function () { n.corrective.push({ action: '', owner: '', due: new Date().toISOString().slice(0, 10), status: 'open' }); render(); };
      var bk = $('#en-back'); if (bk) bk.onclick = function () { openNearMiss(id); };
      var sv = $('#en-save'); if (sv) sv.onclick = function () { toast('Near miss saved.'); openNearMiss(id); };
    }
    render();
  }

  function openNewNearMiss() {
    var todayStr = new Date().toISOString().slice(0, 10);
    var h = '<div class="f"><label for="nn-date">Date it happened</label>' +
      '<input type="date" id="nn-date" value="' + todayStr + '"></div>' +
      '<div class="f"><label for="nn-job">Site</label><select id="nn-job">' +
      (B.jobs || []).map(function (j) { return '<option value="' + esc(j.id) + '">' + esc(j.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="f"><label for="nn-sub">Involved crew</label><select id="nn-sub"><option value="">Our own workforce</option>' +
      (B.subs || []).map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="f"><label for="nn-desc">What happened</label>' +
      '<textarea id="nn-desc" rows="3" style="width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px"></textarea></div>' +
      '<div class="f"><label for="nn-pot">What could have happened</label>' +
      '<textarea id="nn-pot" rows="2" style="width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px"></textarea></div>' +
      '<div class="f"><label for="nn-sev">Potential severity</label><select id="nn-sev">' +
      '<option value="low">Low potential</option><option value="medium" selected>Medium potential</option>' +
      '<option value="high">High potential — serious or fatal</option></select></div>' +
      '<div class="f"><label for="nn-act">Immediate action taken</label>' +
      '<textarea id="nn-act" rows="2" style="width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px"></textarea></div>' +
      '<p class="small" id="nn-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
      '<button class="btn btn-gold" id="nn-save" style="width:100%;justify-content:center">Report near miss</button>';
    drawer('Report near miss', 'Close call, no injury', h);
    $('#nn-save').onclick = function () {
      var desc = $('#nn-desc').value.trim();
      if (!desc) { $('#nn-err').textContent = 'Describe what happened.'; return; }
      var sess = getSession() || {};
      (B.near_misses || (B.near_misses = [])).unshift({ id: 'nm' + Date.now(),
        job_id: $('#nn-job').value, sub_id: $('#nn-sub').value || null,
        date: $('#nn-date').value || new Date().toISOString().slice(0, 10), time: new Date().toTimeString().slice(0, 5),
        description: desc, potential: $('#nn-pot').value.trim(), severity: $('#nn-sev').value,
        immediate_action: $('#nn-act').value.trim(), reported_by: sess.user || 'Safety',
        status: 'open', corrective: [], docs: null });
      closeDrawer(); toast('Near miss reported'); pgNearMiss();
    };
  }

  function refreshBundle() {
    var sess = getSession();
    var tok = sess && sess.session;
    return Promise.all([
      post('cs_portal_bundle', { p_token: tok }),
      post('cs_portal_field_inspections', { p_token: tok }).catch(function () { return []; }),
      post('cs_portal_findings', { p_token: tok }).catch(function () { return []; }),
      post('cs_portal_incidents', { p_token: tok }).catch(function () { return []; })
    ]).then(function (res) {
      B = normalizeBundle(res[0], res[2], res[3]);
      CREW = crewFromField(res[1]);
      renderNav();
      return B;
    });
  }

  /* ====================== SUBCONTRACTORS ================================ */
  var subsTab = 'directory';
  var subEmpF = { q: '', sub: '', job: '', status: '' };   // Employees filters
  var subJobF = '';   // By Job: selected jobsite id ('' = all). Display filter only.
  // Worst training status across an employee's certs — drives the pill + filter.
  function empTrainStatus(emp) {
    if (!(emp.certs || []).length) return { k: 'none', cls: 'p-bad', label: 'No training' };
    // Certs with no expiry date are non-expiring — they don't drive the worst-case.
    var dated = emp.certs.filter(function (c) { return c.exp; });
    if (!dated.length) return { k: 'ok', cls: 'p-ok', label: 'Current' };
    var worst = Math.min.apply(null, dated.map(function (c) { return certDays(c.exp); }));
    if (worst < 0)  return { k: 'expired',  cls: 'p-bad',  label: 'Expired' };
    if (worst <= 60) return { k: 'expiring', cls: 'p-warn', label: 'Expiring ' + worst + 'd' };
    return { k: 'ok', cls: 'p-ok', label: 'Current' };
  }
  // Employee-level site orientation, from the boot-derived oriented / orient_expires
  // fields (null = never oriented). Display only — no new qualification model.
  function empOrientStatus(emp) {
    if (!emp.orient_expires) return { cls: 'p-bad', label: 'Not on file' };
    return new Date(emp.orient_expires) < new Date()
      ? { cls: 'p-warn', label: 'Lapsed' }
      : { cls: 'p-ok', label: 'Current' };
  }
  // Full gate names, shared by the scorecard tooltip and the detail view.
  var GATE_LABELS = { program: 'Written Safety Program', emr: 'EMR',
                      training: 'Crew Training', competent: 'Competent Persons' };
  var GATE_ORDER = ['program', 'emr', 'training', 'competent'];
  // Presentation sort: not-cleared first, then cleared-with-open-findings, then
  // the rest — preserving each group's existing order (stable). Never touches
  // clearance itself; only the display order of a copied list.
  function subAttentionSort(list) {
    function rank(x) { return !x.cleared ? 0 : (x.open ? 1 : 2); }
    return list.slice().sort(function (a, b) { return rank(a) - rank(b); });
  }
  function subScoreRows(sc) {
    return sc.map(function (x) {
      var s = x.sub;
      var passed = GATE_ORDER.filter(function (g) { return x.gates[g]; }).length;
      var dots = GATE_ORDER.map(function (g) {
        return '<span class="dot" title="' + GATE_LABELS[g] + ' — ' +
          (x.gates[g] ? 'passed' : 'not met') + '" style="background:' +
          (x.gates[g] ? 'var(--ok)' : 'var(--bad)') + '"></span>';
      }).join('');
      var gates = '<span style="display:inline-flex;align-items:center;white-space:nowrap">' + dots +
        '<span class="t-sub"' + (passed < 4 ? ' style="color:var(--fail);font-weight:600"' : '') +
        '>' + passed + ' / 4</span></span>';
      return '<tr class="click" data-sub="' + esc(s.id) + '">' +
        '<td><span class="t-main">' + esc(s.name) + '</span>' +
          '<div class="t-sub">' + esc(s.trade) + '</div></td>' +
        '<td class="r num">' + s.workers_on_site + '</td>' +
        '<td>' + gates + '</td>' +
        '<td class="r num' + (x.gates.emr ? '' : ' c-bad') + '">' + (s.emr == null ? '—' : s.emr.toFixed(2)) + '</td>' +
        '<td class="r num">' + (x.trir === null ? '—' : x.trir.toFixed(2)) + '</td>' +
        '<td class="r num">' + (x.open ? '<span class="c-warn">' + x.open + '</span>' : '—') +
          '<span class="t-sub"> / ' + x.findings + '</span></td>' +
        '<td class="r">' + (x.cleared ? pill('p-ok', 'Cleared') : pill('p-bad', 'Not cleared')) + '</td>' +
        '</tr>';
    });
  }
  var SUB_COLS = [{ t: 'Subcontractor' }, { t: 'On site', r: 1 }, { t: 'Gates' },
    { t: 'EMR', r: 1 }, { t: 'TRIR', r: 1 }, { t: 'Findings open', r: 1 }, { t: 'Status', r: 1 }];

  function pgSubs() {
    var sc = B.scorecard || [];
    var right = subtabs(subsTab, [['directory', 'Scorecard'], ['employees', 'Employees'],
      ['byjob', 'By Job'], ['hours', 'Hours']], 'st');
    var html;
    if (subsTab === 'hours') {
      html = head('Subcontractors',
        'One number per sub per month — the denominator under every rate this system ' +
        'shows. Type it or import it; never timesheets, never payroll.', right);
      var months = [];
      var sh = B.sub_hours || {};
      var first = sh[Object.keys(sh)[0]] || [];
      first.forEach(function (m) { months.push(m.month); });
      var totalRow = months.map(function () { return 0; });
      var rowsH = sc.map(function (x) {
        var s = x.sub;
        var cells = (sh[s.id] || []).map(function (m, i) {
          totalRow[i] += m.hours;
          return '<td class="r"><input type="number" class="hrs num" data-hsub="' + esc(s.id) +
            '" data-hmonth="' + esc(m.month) + '" value="' + m.hours + '"></td>';
        }).join('');
        return '<tr><td><span class="t-main">' + esc(s.name) + '</span>' +
          '<div class="t-sub">' + esc(s.trade) + '</div></td>' + cells +
          '<td class="r num">' + s.hours_12mo.toLocaleString() + '</td>' +
          '<td class="r num">' + (x.trir === null ? '—' : x.trir.toFixed(2)) + '</td></tr>';
      });
      rowsH.push('<tr style="background:#fafbfc"><td class="t-main">All subs</td>' +
        totalRow.map(function (t) { return '<td class="r num t-main">' + t.toLocaleString() + '</td>'; }).join('') +
        '<td class="r num t-main">' + sc.reduce(function (a, x) { return a + x.sub.hours_12mo; }, 0).toLocaleString() +
        '</td><td></td></tr>');
      var monthCols = months.map(function (m) {
        return { t: new Date(m + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), r: 1 };
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>Hours worked</h3>' +
        '<div class="sub">Edit a cell and it saves. CSV import and a Procore feed are the ' +
        'live-build options; typing stays the fallback.</div></div>' +
        '<button class="btn btn-sm" id="hrs-import">Import CSV</button></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: 'Subcontractor' }].concat(monthCols,
          [{ t: '12-mo total', r: 1 }, { t: 'TRIR', r: 1 }]), rowsH) + '</div></div>';
      paint(html);
      wireSubtabs('st', function (v) { subsTab = v; pgSubs(); });
      $$('.hrs').forEach(function (inp) {
        inp.onchange = function () {
          post('cs_portal_set_hours', { p_sub_id: inp.dataset.hsub,
            p_month: inp.dataset.hmonth, p_hours: inp.value })
            .then(function () { toast('Hours saved'); });
        };
      });
      $('#hrs-import').onclick = function () {
        toast('Demo build — CSV import lands with the live backend.');
      };
      return;
    }
    if (subsTab === 'directory') {
      var blocked = sc.filter(function (x) { return !x.cleared; }).length;
      var workers = sc.reduce(function (a, x) { return a + x.sub.workers_on_site; }, 0);
      var openF = sc.reduce(function (a, x) { return a + x.open; }, 0);
      html = head('Subcontractors',
        'Which subcontractors are cleared to work, and which need attention. Not cleared ' +
        'first, then cleared with open findings. Click a subcontractor for its crew, their ' +
        'training, and what has been sent to them. A subcontractor is cleared only when ' +
        'written program, EMR, crew training and competent persons all pass.', right);
      html += '<div class="cards">' +
        kpi(blocked, 'not cleared', 'of ' + sc.length + ' subcontractors', blocked ? 'c-bad' : 'c-ok') +
        kpi(openF, 'open findings', 'assigned to subcontractors', openF ? 'c-warn' : 'c-ok') +
        kpi(workers, 'workers on site', 'across all subcontractors', 'c-grey') +
        kpi(sc.reduce(function (a, x) { return a + x.sub.recordables_12mo; }, 0),
            'sub recordables', 'trailing 12 months', 'c-grey') +
        '</div>';
      html += '<div class="panel"><div class="panel-hd"><div><h3>Scorecard</h3>' +
        '<div class="sub">The four gate dots are the prequal gates: Written Safety Program · EMR · ' +
        'Crew Training · Competent Persons. The count shows how many of the four pass.</div></div>' +
        '<button class="btn btn-sm" id="sub-add-new">+ Add subcontractor</button></div>' +
        '<div class="panel-bd flush">' +
        tableWrap(SUB_COLS, subScoreRows(subAttentionSort(sc))) + '</div></div>';
    } else if (subsTab === 'employees') {
      html = head('Subcontractors',
        'Every subcontractor employee, grouped by company — their role, training status, and ' +
        'site orientation. Click a name for the full record.', right);

      // flatten every employee with its company
      var allEmp = [];
      sc.forEach(function (x) {
        (x.sub.crew || []).forEach(function (emp) { allEmp.push({ sub: x.sub, emp: emp, st: empTrainStatus(emp) }); });
      });
      var expiredN = allEmp.filter(function (e) { return e.st.k === 'expired'; }).length;
      var expiringN = allEmp.filter(function (e) { return e.st.k === 'expiring'; }).length;
      var noneN = allEmp.filter(function (e) { return e.st.k === 'none'; }).length;
      html += '<div class="cards">' +
        kpi(allEmp.length, 'employees', 'across ' + sc.length + ' subs', 'c-grey') +
        kpi(expiredN, 'expired training', expiredN ? 'not qualified' : 'none expired', expiredN ? 'c-bad' : 'c-ok') +
        kpi(expiringN, 'expiring in 60 days', 'renew soon', expiringN ? 'c-warn' : 'c-ok') +
        kpi(noneN, 'no training on file', noneN ? 'cannot verify' : 'all documented', noneN ? 'c-bad' : 'c-ok') +
        '</div>';

      html += '<div style="margin-bottom:12px"><button class="btn btn-sm" id="emp-add-new">+ Add employee</button></div>';

      // filter controls
      var subOpts = sc.map(function (x) {
        return '<option value="' + esc(x.sub.id) + '"' + (subEmpF.sub === x.sub.id ? ' selected' : '') + '>' + esc(x.sub.name) + '</option>'; }).join('');
      var empJobOpts = (B.jobs || []).map(function (j) {
        return '<option value="' + esc(j.id) + '"' + (subEmpF.job === j.id ? ' selected' : '') + '>' + esc(jobName(j.id)) + '</option>'; }).join('');
      var stOpts = [['', 'All training'], ['expired', 'Expired'], ['expiring', 'Expiring 60d'], ['none', 'No training'], ['ok', 'Current']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (subEmpF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="se-q" placeholder="Search name or role…" value="' + esc(subEmpF.q) + '"></div>' +
        '<select id="se-sub"><option value="">All companies</option>' + subOpts + '</select>' +
        '<select id="se-job"><option value="">All jobs</option>' + empJobOpts + '</select>' +
        '<select id="se-status">' + stOpts + '</select></div>';

      var seq = subEmpF.q.toLowerCase();
      var shown = 0;
      sc.forEach(function (x) {
        if (subEmpF.sub && x.sub.id !== subEmpF.sub) return;
        if (subEmpF.job && x.sub.jobs.indexOf(subEmpF.job) === -1) return;
        var crew = (x.sub.crew || []).filter(function (emp) {
          var st = empTrainStatus(emp);
          if (subEmpF.status && st.k !== subEmpF.status) return false;
          if (seq && (emp.name + ' ' + emp.role).toLowerCase().indexOf(seq) === -1) return false;
          return true;
        });
        if (!crew.length) return;
        shown += crew.length;
        var rows = crew.map(function (emp) {
          var st = empTrainStatus(emp);
          var ori = empOrientStatus(emp);
          var certTxt = (emp.certs || []).length ? (emp.certs.length + ' cert' + (emp.certs.length === 1 ? '' : 's')) : 'No training';
          return '<tr data-emp="' + esc(x.sub.id) + '|' + esc(emp.name) + '" style="cursor:pointer">' +
            '<td><span class="t-main">' + esc(emp.name) + '</span></td>' +
            '<td>' + esc(emp.role) + '</td>' +
            '<td>' + esc(certTxt) + '</td>' +
            '<td class="r">' + pill(ori.cls, ori.label) + '</td>' +
            '<td class="r">' + pill(st.cls, st.label) + '</td></tr>';
        });
        html += '<div class="panel"><div class="panel-hd"><div><h3>' + esc(x.sub.name) + '</h3>' +
          '<div class="sub">' + esc(x.sub.trade) + ' · ' + crew.length + ' shown</div></div>' +
          (x.cleared ? '' : pill('p-bad', 'Company not cleared')) + '</div>' +
          '<div class="panel-bd flush">' + tableWrap(
          [{ t: 'Employee' }, { t: 'Role' }, { t: 'Training' }, { t: 'Orientation', r: 1 }, { t: 'Status', r: 1 }],
          rows, 'No employees.') + '</div></div>';
      });
      if (!shown) html += '<div class="empty">No employees match your filters.</div>';
    } else {
      html = head('Subcontractors',
        'The same scorecard, cut per jobsite — who is on each job and whether they are ' +
        'cleared to be there.', right);
      // Jobsite filter — narrows the existing loaded groupings to one job.
      var jobOnly = (B.jobs || []).filter(function (j) {
        return sc.some(function (x) { return x.sub.jobs.indexOf(j.id) !== -1; });
      });
      var bjOpts = jobOnly.map(function (j) {
        return '<option value="' + esc(j.id) + '"' + (subJobF === j.id ? ' selected' : '') +
          '>' + esc(j.name) + '</option>'; }).join('');
      html += '<div class="fbar"><select id="bj-job"><option value="">All jobsites</option>' +
        bjOpts + '</select></div>';
      jobOnly.forEach(function (j) {
        if (subJobF && j.id !== subJobF) return;
        var onJob = sc.filter(function (x) { return x.sub.jobs.indexOf(j.id) !== -1; });
        if (!onJob.length) return;
        var blocked2 = onJob.filter(function (x) { return !x.cleared; }).length;
        html += '<div class="panel"><div class="panel-hd"><div><h3>' + esc(j.name) + '</h3>' +
          '<div class="sub">' + esc(j.job_number) + ' · ' + onJob.length + ' subs · ' +
          onJob.reduce(function (a, x) { return a + x.sub.workers_on_site; }, 0) + ' workers' +
          (blocked2 ? ' · <span style="color:var(--fail);font-weight:600">' + blocked2 +
            ' not cleared</span>' : '') + '</div></div></div>' +
          '<div class="panel-bd flush">' + tableWrap(SUB_COLS, subScoreRows(onJob)) + '</div></div>';
      });
    }
    paint(html);
    wireSubtabs('st', function (v) { subsTab = v; pgSubs(); });
    var _addSub = $('#sub-add-new'); if (_addSub) _addSub.onclick = function () { openSubForm(null); };
    var _addEmp = $('#emp-add-new'); if (_addEmp) _addEmp.onclick = function () { openEmpForm(subEmpF.sub || '', null); };
    if (subsTab === 'employees') {
      function seBind(id, key) { var e = $('#' + id); if (e) e.oninput = e.onchange = function () { subEmpF[key] = e.value; pgSubs(); }; }
      seBind('se-q', 'q'); seBind('se-sub', 'sub'); seBind('se-job', 'job'); seBind('se-status', 'status');
      var _seq = $('#se-q'); if (_seq && subEmpF.q) { _seq.focus(); try { _seq.setSelectionRange(_seq.value.length, _seq.value.length); } catch (e) {} }
      $$('[data-emp]').forEach(function (tr) {
        tr.onclick = function () { var p = tr.dataset.emp.split('|'); openEmployee(p[0], p[1]); };
      });
    }
    if (subsTab === 'byjob') {
      var bj = $('#bj-job');
      if (bj) bj.onchange = function () { subJobF = bj.value; pgSubs(); };
    }
  }

  // One subcontractor employee: their training (with expiry) and the JHAs /
  // inspections they personally submitted.
  function openEmployee(subId, name) {
    var s = (B.subs || []).filter(function (x) { return x.id === subId; })[0];
    var emp = s && (s.crew || []).filter(function (w) { return w.name === name; })[0];
    if (!emp) return;
    docReg = [];
    var st = empTrainStatus(emp);
    var h = '';
    if (st.k === 'expired' || st.k === 'none')
      h += '<div class="alert"><strong>' + (st.k === 'none' ? 'No training on file.' : 'Expired training.') +
        '</strong> This worker is not verified for their task.</div>';
    h += '<div style="margin-bottom:14px"><button class="btn btn-sm" id="emp-edit-btn">Edit employee</button></div>';
    h += '<div class="sec-h">Employee</div>' +
      kv('Company', s.name) + kv('Trade', s.trade) + kv('Role', emp.role) +
      (emp.phone ? kv('Phone', emp.phone) : '');

    h += '<div class="sec-h">Training &amp; Certifications</div>';
    h += '<div style="margin-bottom:10px"><button class="btn btn-sm" id="emp-addcert-btn">+ Add training / certification</button></div>';
    var certs = emp.certs || [];
    if (!certs.length) {
      h += '<div class="small" style="color:var(--fail);font-weight:600">Nothing on file.</div>';
    } else {
      var certRows = certs.map(function (c, i) {
        var dd = c.exp ? certDays(c.exp) : null;
        var stcell = c.exp == null ? pill('p-ok', 'No expiry')
          : dd < 0 ? pill('p-bad', 'Expired')
          : dd <= 60 ? pill('p-warn', 'Expiring ' + dd + 'd')
          : pill('p-ok', 'Current');
        return '<tr><td><span class="t-main">' + esc(c.t) + '</span></td>' +
          '<td>' + esc(fmtDate(c.completed)) + '</td>' +
          '<td>' + esc(fmtDate(c.exp)) + '</td>' +
          '<td>' + stcell + '</td>' +
          '<td>' + docCell(c.doc, 'Missing') + '</td>' +
          '<td class="r"><button class="linklike" data-editcert="' + i + '">Edit</button></td></tr>';
      });
      h += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Certification' }, { t: 'Completed' }, { t: 'Expires' }, { t: 'Status' }, { t: 'Document' }, { t: '', r: 1 }],
        certRows) + '</div></div>';
    }

    h += otherPdfsHtml(emp.id);

    h += '<div class="sec-h">JHAs & inspections submitted</div>';
    if (!(emp.insp || []).length) {
      h += '<div class="small muted">None on record.</div>';
    } else {
      emp.insp.forEach(function (r) {
        h += '<div class="kv"><span class="k">' + esc(r.form) +
          '<div class="small muted">' + fmtDate(r.date) + '</div></span>' +
          (r.defects ? pill('p-bad', r.defects + ' defect' + (r.defects === 1 ? '' : 's')) : pill('p-ok', 'Clear')) +
          '</div>';
      });
    }
    drawer(emp.name, emp.role + ' · ' + s.name, h);
    var wc = { kind: 'sub', subId: subId, empName: name, workerId: emp.id, workerName: emp.name,
      reopen: function () { pgSubs(); openEmployee(subId, name); } };
    $('#emp-edit-btn').onclick = function () { openEmpForm(subId, name); };
    $('#emp-addcert-btn').onclick = function () { openCertForm(wc, null); };
    $$('[data-editcert]').forEach(function (b) {
      b.onclick = function () { var i = +b.dataset.editcert; openCertForm(wc, { id: i, cert: certs[i] }); };
    });
    wireOtherPdfs(wc);
    wireDocLinks();
  }

  /* ---- Subcontractor / employee / training editors (demo-only) ----------
     Users edit source data only. Clearance, gates, TRIR, training %, findings
     and competent persons stay derived — recomputed by the bundle after each
     save. Cancel restores the prior view; Save writes only on valid input.  */
  var CERT_TYPES = ['OSHA 10', 'OSHA 30', 'Fall Protection', 'Excavation Competent Person',
    'Confined Space Competent Person', 'First Aid / CPR', 'Rigging / Signal Person',
    'Aerial Lift', 'Silica Awareness', 'Hot Work', 'NFPA 70E'];
  function subJobChecks(selected) {
    var jobs = B.jobs || [];
    if (!jobs.length) return '<div class="small muted">No jobsites available.</div>';
    return jobs.map(function (j) {
      return '<label class="check"><input type="checkbox" class="jobck" value="' + esc(j.id) + '"' +
        (selected.indexOf(j.id) !== -1 ? ' checked' : '') + '>' + esc(j.name) + '</label>';
    }).join('');
  }
  function openSubForm(id) {
    var editing = !!id;
    var s = editing ? (B.subs || []).filter(function (x) { return x.id === id; })[0] : null;
    if (editing && !s) return;
    var progOn = s ? !!s.program_on_file : false;
    var h = '<div class="f"><label for="sf-name">Company name</label>' +
        '<input type="text" id="sf-name" value="' + (s ? esc(s.name) : '') + '" placeholder="Company name"></div>' +
      '<div class="f"><label for="sf-trade">Trade / scope</label>' +
        '<input type="text" id="sf-trade" value="' + (s ? esc(s.trade) : '') + '" placeholder="e.g. Electrical, Roofing, Sitework"></div>' +
      '<div class="f"><label for="sf-contact">Primary contact</label>' +
        '<input type="text" id="sf-contact" value="' + (s ? esc(s.contact_name) : '') + '" placeholder="Name"></div>' +
      '<div class="f"><label for="sf-phone">Phone</label>' +
        '<input type="tel" id="sf-phone" value="' + (s ? esc(s.contact_phone) : '') + '" placeholder="317-555-0100"></div>' +
      '<div class="f"><label for="sf-email">Email</label>' +
        '<input type="email" id="sf-email" value="' + (s ? esc(s.contact_email) : '') + '" placeholder="name@example.com"></div>' +
      '<div class="f"><label for="sf-emr">EMR <span class="small muted" style="text-transform:none;font-weight:400;letter-spacing:0">· optional, numeric</span></label>' +
        '<input type="text" inputmode="decimal" id="sf-emr" value="' + (s && s.emr != null ? s.emr : '') + '" placeholder="e.g. 0.95"></div>' +
      '<div class="f"><label for="sf-prog">Written safety program</label><select id="sf-prog">' +
        '<option value="no"' + (progOn ? '' : ' selected') + '>Not received</option>' +
        '<option value="yes"' + (progOn ? ' selected' : '') + '>On file</option></select></div>' +
      '<div class="f"><label>Assigned jobsites</label>' + subJobChecks(s ? s.jobs.slice() : []) + '</div>' +
      '<p class="small" id="sf-err" style="color:var(--fail);min-height:1em"></p>' +
      '<div style="display:flex;gap:.5rem">' +
        '<button class="btn btn-gold" id="sf-save" style="flex:1;justify-content:center">' + (editing ? 'Save changes' : 'Add subcontractor') + '</button>' +
        '<button class="btn btn-out" id="sf-cancel" style="flex:0 0 auto">Cancel</button></div>' +
      '<p class="small muted" style="margin-top:.7rem">Clearance, gates, EMR pass/fail, TRIR, training % and ' +
        'findings are derived from this and the crew’s records — never entered here.</p>';
    drawer(editing ? 'Edit subcontractor' : 'Add subcontractor', editing ? s.name : 'New subcontractor', h);
    $('#sf-cancel').onclick = function () { if (editing) openSub(id); else closeDrawer(); };
    $('#sf-save').onclick = function () {
      var name = $('#sf-name').value.trim();
      if (!name) { $('#sf-err').textContent = 'Company name is required.'; return; }
      var emrRaw = $('#sf-emr').value.trim();
      if (emrRaw && isNaN(+emrRaw)) { $('#sf-err').textContent = 'EMR must be a number.'; return; }
      var email = $('#sf-email').value.trim();
      if (email && email.indexOf('@') === -1) { $('#sf-err').textContent = 'Enter a valid email, or leave it blank.'; return; }
      var jobs = $$('.jobck').filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      var payload = { p_name: name, p_trade: $('#sf-trade').value.trim(),
        p_contact_name: $('#sf-contact').value.trim(), p_contact_phone: $('#sf-phone').value.trim(),
        p_contact_email: email, p_emr: emrRaw, p_program_on_file: $('#sf-prog').value === 'yes',
        p_jobs: jobs };
      if (editing) {
        payload.p_id = id;
        post('cs_portal_update_sub', payload).then(refreshBundle).then(function () {
          toast('Subcontractor updated'); pgSubs(); openSub(id);
        });
      } else {
        post('cs_portal_add_sub', payload).then(function (r) {
          return refreshBundle().then(function () {
            toast('Subcontractor added'); pgSubs();
            if (r && r.sub_id) openSub(r.sub_id);
          });
        });
      }
    };
  }
  function openEmpForm(subId, empName) {
    var editing = !!empName;
    var s = subId ? (B.subs || []).filter(function (x) { return x.id === subId; })[0] : null;
    var emp = editing && s ? (s.crew || []).filter(function (w) { return w.name === empName; })[0] : null;
    if (editing && !emp) return;
    var curSub = subId || ((B.subs || [])[0] && (B.subs || [])[0].id) || '';
    var subOpts = (B.subs || []).map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === curSub ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
    var h = '<div class="f"><label for="ef-name">Name</label>' +
        '<input type="text" id="ef-name" value="' + (emp ? esc(emp.name) : '') + '" placeholder="Full name"></div>' +
      '<div class="f"><label for="ef-role">Role</label>' +
        '<input type="text" id="ef-role" value="' + (emp ? esc(emp.role) : '') + '" placeholder="e.g. Foreman, Operator, Laborer"></div>' +
      '<div class="f"><label for="ef-sub">Subcontractor</label><select id="ef-sub">' + subOpts + '</select></div>' +
      '<div class="f"><label for="ef-phone">Phone <span class="small muted" style="text-transform:none;font-weight:400;letter-spacing:0">· optional</span></label>' +
        '<input type="tel" id="ef-phone" value="' + (emp && emp.phone ? esc(emp.phone) : '') + '" placeholder="317-555-0100"></div>' +
      '<p class="small" id="ef-err" style="color:var(--fail);min-height:1em"></p>' +
      '<div style="display:flex;gap:.5rem">' +
        '<button class="btn btn-gold" id="ef-save" style="flex:1;justify-content:center">' + (editing ? 'Save changes' : 'Add employee') + '</button>' +
        '<button class="btn btn-out" id="ef-cancel" style="flex:0 0 auto">Cancel</button></div>' +
      (editing ? '' : '<p class="small muted" style="margin-top:.7rem">Add training after creating the employee. ' +
        'With nothing on file they show as “No training,” derived automatically.</p>');
    drawer(editing ? 'Edit employee' : 'Add employee', editing ? (emp.role + ' · ' + s.name) : 'New crew member', h);
    $('#ef-cancel').onclick = function () { if (editing) openEmployee(subId, empName); else closeDrawer(); };
    $('#ef-save').onclick = function () {
      var nm = $('#ef-name').value.trim();
      if (!nm) { $('#ef-err').textContent = 'Name is required.'; return; }
      var newSub = $('#ef-sub').value;
      if (!newSub) { $('#ef-err').textContent = 'Choose a subcontractor.'; return; }
      var role = $('#ef-role').value.trim(), phone = $('#ef-phone').value.trim();
      if (editing) {
        post('cs_portal_update_emp', { p_sub_id: subId, p_name: empName,
          p_new_name: nm, p_role: role, p_phone: phone, p_new_sub_id: newSub })
          .then(function (r) { return refreshBundle().then(function () {
            toast('Employee updated'); pgSubs(); openEmployee((r && r.sub_id) || newSub, nm); }); });
      } else {
        post('cs_portal_add_emp', { p_sub_id: newSub, p_name: nm, p_role: role, p_phone: phone })
          .then(function () { return refreshBundle().then(function () {
            toast('Employee added'); pgSubs(); openEmployee(newSub, nm); }); });
      }
    };
  }
  /* ---- Worker documents (demo) -----------------------------------------
     Session uploads get a real object-URL so View/Download work; seed/metadata
     files fall back to a generated placeholder PDF. docReg is reset per detail
     render and lets row View/Download links resolve their document object.   */
  var docBlobs = {}, docSeq = 0, docReg = [];
  function fileToDoc(input) {
    var f = input && input.files && input.files[0];
    if (!f) return null;
    var key = 'db' + Date.now() + '_' + (docSeq++);
    try { docBlobs[key] = URL.createObjectURL(f); } catch (e) {}
    return { name: f.name, key: key };
  }
  function docUrl(doc) {
    if (doc && doc.key && docBlobs[doc.key]) return docBlobs[doc.key];
    var blob = new Blob(['Safety demo placeholder for: ' + ((doc && doc.name) || 'document') +
      '\n\nThis stands in for the real PDF in the demo build.'], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }
  function viewDoc(doc) { window.open(docUrl(doc), '_blank'); }
  function downloadDoc(doc) {
    var a = document.createElement('a'); a.href = docUrl(doc);
    a.download = (doc && doc.name) || 'document.pdf';
    document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 0);
  }
  function docCell(doc, emptyLabel) {
    if (!doc) return '<span class="muted">' + esc(emptyLabel || 'No document') + '</span>';
    var i = docReg.push(doc) - 1;
    return esc(doc.name) + ' <span class="small">· <a class="linklike" data-docview="' + i + '">View</a>' +
      ' · <a class="linklike" data-docdl="' + i + '">Download</a></span>';
  }
  function wireDocLinks() {
    $$('[data-docview]').forEach(function (a) { a.onclick = function (e) { e.stopPropagation(); viewDoc(docReg[+a.dataset.docview]); }; });
    $$('[data-docdl]').forEach(function (a) { a.onclick = function (e) { e.stopPropagation(); downloadDoc(docReg[+a.dataset.docdl]); }; });
  }

  // Unified add/edit training form for internal + subcontractor workers.
  // wc = { kind:'sub'|'internal', subId, empName, workerId, workerName, reopen }.
  // ref = null (add) or { id, cert } (edit; id is the sub cert index or internal cert id).
  function openCertForm(wc, ref) {
    var editing = !!ref, c = ref ? ref.cert : null;
    var curType = c ? (c.t || c.cert_type || '') : '';
    var curIssued = c ? (c.completed || c.issued || '') : '';
    var curExp = c ? (c.exp != null ? c.exp : (c.expires || '')) : '';
    var dl = CERT_TYPES.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');
    var optNote = ' <span class="small muted" style="text-transform:none;font-weight:400;letter-spacing:0">· optional</span>';
    var h = '<div class="f"><label for="cf-type">Training / certification</label>' +
        '<input type="text" id="cf-type" list="cf-types" value="' + esc(curType) + '" placeholder="e.g. OSHA 30, Fall Protection">' +
        '<datalist id="cf-types">' + dl + '</datalist></div>' +
      '<div class="f"><label for="cf-comp">Completed / issued' + optNote + '</label>' +
        '<input type="date" id="cf-comp" value="' + esc(curIssued || '') + '"></div>' +
      '<div class="f"><label for="cf-exp">Expires <span class="small muted" style="text-transform:none;font-weight:400;letter-spacing:0">· optional, blank = does not expire</span></label>' +
        '<input type="date" id="cf-exp" value="' + esc(curExp || '') + '"></div>' +
      '<div class="f"><label for="cf-file">Supporting certificate (PDF)' + optNote +
        (editing && c && c.doc ? ' · leave blank to keep current' : '') + '</label>' +
        '<input type="file" id="cf-file" accept="application/pdf,image/*"></div>' +
      (editing && c && c.doc ? '<div class="small" style="margin:-6px 0 12px">Current: ' + docCell(c.doc, '') + '</div>' : '') +
      '<p class="small" id="cf-err" style="color:var(--fail);min-height:1em"></p>' +
      '<div style="display:flex;gap:.5rem">' +
        '<button class="btn btn-gold" id="cf-save" style="flex:1;justify-content:center">' + (editing ? 'Save changes' : 'Add training') + '</button>' +
        '<button class="btn btn-out" id="cf-cancel" style="flex:0 0 auto">Cancel</button></div>' +
      '<p class="small muted" style="margin-top:.7rem">Current / Expiring / Expired is derived from the expiration date, not entered.</p>';
    drawer(editing ? 'Edit training' : 'Add training / certification', wc.workerName, h);
    wireDocLinks();
    $('#cf-cancel').onclick = wc.reopen;
    $('#cf-save').onclick = function () {
      var type = $('#cf-type').value.trim();
      if (!type) { $('#cf-err').textContent = 'Enter the training or certification type.'; return; }
      var doc = fileToDoc($('#cf-file'));
      var issued = $('#cf-comp').value || null, exp = $('#cf-exp').value || null;
      var fn, payload;
      if (wc.kind === 'internal') {
        payload = { p_type: type, p_issued: issued, p_exp: exp,
          p_doc_name: doc ? doc.name : null, p_doc_key: doc ? doc.key : null };
        if (editing) { fn = 'cs_portal_int_cert_update'; payload.p_cert_id = ref.id; }
        else { fn = 'cs_portal_int_cert_add'; payload.p_worker_id = wc.workerId; payload.p_worker_name = wc.workerName; }
      } else {
        payload = { p_sub_id: wc.subId, p_name: wc.empName, p_type: type,
          p_completed: issued, p_exp: exp, p_doc_name: doc ? doc.name : null, p_doc_key: doc ? doc.key : null };
        if (editing) { fn = 'cs_portal_update_cert'; payload.p_cert_index = ref.id; }
        else { fn = 'cs_portal_add_cert'; }
      }
      post(fn, payload).then(refreshBundle).then(function () {
        toast(editing ? 'Training updated' : 'Training added'); wc.reopen();
      });
    };
  }

  // Worker "Other PDFs" — miscellaneous worker documents, kept out of badges,
  // rosters, Orientation and the general Documents module.
  var PDF_CATS = ['Medical Clearance', 'Return to Work', 'Physical Exam', 'Clinic / Hospital Documentation',
    'Lab / Bloodwork', 'Workers’ Compensation', 'Medical Restriction', 'Doctor’s Note', 'Other'];
  function otherPdfsHtml(workerId) {
    var list = (B.worker_pdfs || []).filter(function (p) { return p.worker_id === workerId; });
    var h = '<div class="sec-h">Other PDFs <span class="small muted" style="font-weight:400">· worker-only, not on badges or Documents</span></div>';
    h += '<div style="margin-bottom:10px"><button class="btn btn-sm" id="wp-add">+ Upload PDF</button></div>';
    if (!list.length) { h += '<div class="small muted">No other documents on file.</div>'; return h; }
    var rows = list.map(function (p) {
      return '<tr><td><span class="t-main">' + esc(p.name) + '</span>' +
          (p.note ? '<div class="t-sub">' + esc(p.note) + '</div>' : '') + '</td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td>' + esc(fmtDate(p.doc_date)) + '</td>' +
        '<td>' + (p.expires ? esc(fmtDate(p.expires)) : '—') + '</td>' +
        '<td class="r">' + docCell(p.file, 'No file') +
          ' <button class="linklike" data-pdfedit="' + esc(p.id) + '">Edit</button></td></tr>';
    });
    h += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Document' }, { t: 'Category' }, { t: 'Date' }, { t: 'Expires' }, { t: 'Action', r: 1 }], rows) + '</div></div>';
    return h;
  }
  function wireOtherPdfs(wc) {
    var add = $('#wp-add'); if (add) add.onclick = function () { openPdfForm(wc, null); };
    $$('[data-pdfedit]').forEach(function (b) { b.onclick = function () { openPdfForm(wc, b.dataset.pdfedit); }; });
  }
  function openPdfForm(wc, pdfId) {
    var editing = !!pdfId;
    var rec = editing ? (B.worker_pdfs || []).filter(function (p) { return p.id === pdfId; })[0] : null;
    if (editing && !rec) return;
    docReg = [];
    var catOpts = PDF_CATS.map(function (c) {
      return '<option value="' + esc(c) + '"' + (rec && rec.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var optNote = ' <span class="small muted" style="text-transform:none;font-weight:400;letter-spacing:0">· optional</span>';
    var h = '<div class="f"><label for="wpf-name">Document name</label>' +
        '<input type="text" id="wpf-name" value="' + (rec ? esc(rec.name) : '') + '" placeholder="e.g. Respirator Medical Clearance"></div>' +
      '<div class="f"><label for="wpf-cat">Category</label><select id="wpf-cat">' + catOpts + '</select></div>' +
      '<div class="f"><label for="wpf-date">Document date' + optNote + '</label>' +
        '<input type="date" id="wpf-date" value="' + (rec && rec.doc_date ? esc(rec.doc_date) : '') + '"></div>' +
      '<div class="f"><label for="wpf-exp">Expiration' + optNote + '</label>' +
        '<input type="date" id="wpf-exp" value="' + (rec && rec.expires ? esc(rec.expires) : '') + '"></div>' +
      '<div class="f"><label for="wpf-file">PDF / file' + (editing ? optNote + (rec.file ? ' · leave blank to keep current' : '') : '') + '</label>' +
        '<input type="file" id="wpf-file" accept="application/pdf,image/*"></div>' +
      (editing && rec.file ? '<div class="small" style="margin:-6px 0 12px">Current: ' + docCell(rec.file, '') + '</div>' : '') +
      '<div class="f"><label for="wpf-note">Note' + optNote + '</label>' +
        '<input type="text" id="wpf-note" value="' + (rec ? esc(rec.note || '') : '') + '"></div>' +
      '<p class="small" id="wpf-err" style="color:var(--fail);min-height:1em"></p>' +
      '<div style="display:flex;gap:.5rem">' +
        '<button class="btn btn-gold" id="wpf-save" style="flex:1;justify-content:center">' + (editing ? 'Save changes' : 'Upload PDF') + '</button>' +
        '<button class="btn btn-out" id="wpf-cancel" style="flex:0 0 auto">Cancel</button></div>';
    drawer(editing ? 'Edit document' : 'Upload PDF', wc.workerName, h);
    wireDocLinks();
    $('#wpf-cancel').onclick = wc.reopen;
    $('#wpf-save').onclick = function () {
      var nm = $('#wpf-name').value.trim();
      if (!nm) { $('#wpf-err').textContent = 'Document name is required.'; return; }
      var f = fileToDoc($('#wpf-file'));
      if (!editing && !f) { $('#wpf-err').textContent = 'Choose a PDF to upload.'; return; }
      var payload = { p_name: nm, p_category: $('#wpf-cat').value,
        p_doc_date: $('#wpf-date').value || null, p_expires: $('#wpf-exp').value || null,
        p_note: $('#wpf-note').value.trim(), p_file_name: f ? f.name : null, p_file_key: f ? f.key : null };
      var fn;
      if (editing) { fn = 'cs_portal_worker_pdf_update'; payload.p_id = pdfId; }
      else { fn = 'cs_portal_worker_pdf_add'; payload.p_worker_id = wc.workerId; }
      post(fn, payload).then(refreshBundle).then(function () {
        toast(editing ? 'Document updated' : 'Document uploaded'); wc.reopen();
      });
    };
  }

  /* ====================== TOOLBOX TALKS ================================= */
  var talkTab = 'log';
  var talkF = { q: '', job: '' };
  function pgTalks() {
    var right = subtabs(talkTab, [['log', 'Log'], ['awaiting', 'Awaiting Submission'], ['archive', 'Archive']], 'tt');
    var allTalks = B.talks || [];
    var today = new Date().toISOString().slice(0, 10);
    var html;

    if (talkTab === 'awaiting') {
      // Digitally sent toolbox talks not yet submitted (submitted ones live in
      // the Log). Reads the demo delivery dataset; excludes anything submitted.
      html = head('Toolbox Talks',
        'Digitally sent toolbox talks still awaiting completion — sent but not opened, or ' +
        'opened but not yet submitted. Once submitted, a talk appears in the Log.', right);
      var awq = (subQ.talkAwait || '').toLowerCase();
      html += fbarSearch('tkaw-q', subQ.talkAwait, 'Search awaiting submission…');
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Sent To' }, { t: 'Toolbox talk' }, { t: 'Site' }, { t: 'Sent' }, { t: 'Opened' }, { t: 'Status', r: 1 }],
        awaitingRows(B.talk_sends, 'toolbox', function (s) { return s.topic || '—'; }, awq),
        'Nothing awaiting submission.') + '</div></div>';
    } else if (talkTab === 'archive') {
      html = head('Toolbox Talks', 'Talks moved out of the log. Restore one to bring it back.', right);
      var taq = (subQ.talkArch || '').toLowerCase();
      var arch = allTalks.filter(function (t) {
        return t.archived && has((t.topic || '') + ' ' + jobName(t.job_id) + ' ' + (t.presented_by || ''), taq); });
      html += fbarSearch('tkarch-q', subQ.talkArch, 'Search archived talks…');
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Topic' }, { t: 'Date' }, { t: 'Site' }, { t: 'Presented by' }, { t: '', r: 1 }],
        arch.map(function (t) {
          return '<tr><td><span class="t-main">' + esc(t.topic) + '</span></td>' +
            '<td>' + esc(fmtDate(t.date)) + '</td>' +
            '<td>' + esc(jobName(t.job_id)) + '</td>' +
            '<td>' + esc(t.presented_by) + '</td>' +
            '<td class="r"><button class="btn btn-sm" data-talkrestore="' + esc(t.id) + '">Restore</button></td></tr>';
        }), 'Nothing archived.') + '</div></div>';
    } else {
      var all = allTalks.filter(function (t) { return !t.archived; });
      var t0 = all.filter(function (t) { return t.date === today; });
      var att = all.reduce(function (a, t) { return a + t.attendees; }, 0);
      // Unique sites among the talks actually held today (not the total job count).
      var t0Sites = Object.keys(t0.reduce(function (m, t) { if (t.job_id) m[t.job_id] = 1; return m; }, {})).length;
      html = head('Toolbox Talks',
        'Topic, crew and attendance. Talks triggered by findings or incidents remain tied to ' +
        'the original safety issue for a complete follow-up record.', right);
      html += '<div class="cards">' +
        kpi(t0.length, 'held today', 'across ' + t0Sites + ' site' + (t0Sites === 1 ? '' : 's'), t0.length ? 'c-ok' : 'c-warn') +
        kpi(all.length, 'in the last 30 days', 'all sites', 'c-grey') +
        kpi(att, 'total attendance', 'worker-sessions', 'c-grey') +
        kpi(all.filter(function (t) { return t.note; }).length, 'finding / incident follow-ups', 'documented follow-up talks', 'c-grey') +
        '</div>';
      var tJobSet = {}; all.forEach(function (t) { if (t.job_id) tJobSet[t.job_id] = 1; });
      var tJobOpts = Object.keys(tJobSet).map(function (id) {
        return '<option value="' + esc(id) + '"' + (talkF.job === id ? ' selected' : '') + '>' + esc(jobName(id)) + '</option>'; }).join('');
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="tk-q" placeholder="Search talks…" value="' + esc(talkF.q) + '"></div>' +
        '<select id="tk-job"><option value="">All jobsites</option>' + tJobOpts + '</select></div>';
      var tq = talkF.q.toLowerCase();
      var shown = all.filter(function (t) {
        if (talkF.job && t.job_id !== talkF.job) return false;
        if (tq && (t.topic + ' ' + jobName(t.job_id) + ' ' + (t.presented_by || '') + ' ' + (t.note || '')).toLowerCase().indexOf(tq) === -1) return false;
        return true;
      });
      var rows = shown.map(function (t) {
        return '<tr class="click" data-talk="' + esc(t.id) + '">' +
          '<td><span class="t-main">' + esc(t.topic) + '</span>' +
            (t.note ? '<div class="t-sub" style="color:var(--warn)">' + esc(t.note) + '</div>' : '') + '</td>' +
          '<td>' + esc(fmtDate(t.date)) + '</td>' +
          '<td>' + esc(jobName(t.job_id)) + '<div class="t-sub">' + esc(jobNum(t.job_id)) + '</div></td>' +
          '<td>' + esc(t.presented_by) + '</td>' +
          '<td>' + esc((t.subs || []).map(subName).join(', ')) + '</td>' +
          '<td class="r num">' + t.minutes + ' min</td>' +
          '<td class="r num">' + t.attendees + '</td>' +
          '<td class="r"><button class="btn btn-sm" data-talkarch="' + esc(t.id) + '">Archive</button></td></tr>';
      });
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Topic' }, { t: 'Date' }, { t: 'Site' }, { t: 'Presented by' },
         { t: 'Subs present' }, { t: 'Length', r: 1 }, { t: 'Attended', r: 1 }, { t: '', r: 1 }], rows,
        'No toolbox talks logged.') + '</div></div>';
    }

    paint(html);
    wireSubtabs('tt', function (v) { talkTab = v; pgTalks(); });
    $$('[data-talkarch]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation();
      var t = (B.talks || []).filter(function (x) { return x.id === b.dataset.talkarch; })[0];
      if (t) t.archived = true; toast('Toolbox talk archived.'); pgTalks(); }; });
    $$('[data-talkrestore]').forEach(function (b) { b.onclick = function () {
      var t = (B.talks || []).filter(function (x) { return x.id === b.dataset.talkrestore; })[0];
      if (t) t.archived = false; toast('Toolbox talk restored.'); pgTalks(); }; });
    function tkBind(id, key) { var e = $('#' + id); if (e) e.oninput = e.onchange = function () { talkF[key] = e.value; pgTalks(); }; }
    tkBind('tk-q', 'q'); tkBind('tk-job', 'job');
    if (talkTab === 'archive') wireSearch('tkarch-q', function (v) { subQ.talkArch = v; pgTalks(); });
    if (talkTab === 'awaiting') {
      wireSearch('tkaw-q', function (v) { subQ.talkAwait = v; pgTalks(); });
      $$('[data-talksend]').forEach(function (r) { r.onclick = function () { openTalkSend(r.dataset.talksend); }; });
    }
    var _tkq = $('#tk-q'); if (_tkq && talkF.q) { _tkq.focus(); try { _tkq.setSelectionRange(_tkq.value.length, _tkq.value.length); } catch (e) {} }
  }

  /* Text a prepared toolbox talk to a foreman — same link workflow as inspections. */
  function openSendTalk(preId) {
    var tpls = B.talk_templates || [];
    var people = (B.people || []).map(function (p) { return { name: p.name, phone: p.phone, tag: p.title }; })
      .concat((B.subs || []).map(function (s) { return { name: s.contact_name, phone: s.contact_phone, tag: s.name }; }));

    var tplOpts = tpls.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (t.id === preId ? ' selected' : '') + '>' +
        esc(t.topic) + ' (' + t.mins + ' min)</option>'; }).join('');
    var jobOpts = (B.jobs || []).map(function (j) {
      return '<option value="' + esc(j.id) + '">' + esc(jobName(j.id)) + '</option>'; }).join('');

    var h = '<div class="f"><label for="tk-tpl">Toolbox talk</label>' +
      '<select id="tk-tpl">' + tplOpts + '</select></div>' +
      '<div class="f"><label for="tk-who">Send to</label>' +
      '<select id="tk-who"><option value="">Type it in below…</option>' +
      '<optgroup label="Safety team">' +
      people.slice(0, (B.people || []).length).map(function (p, i) {
        return '<option value="' + i + '">' + esc(p.name) + ' — ' + esc(p.tag) + '</option>';
      }).join('') + '</optgroup><optgroup label="Subcontractor foremen">' +
      people.slice((B.people || []).length).map(function (p, i) {
        return '<option value="' + ((B.people || []).length + i) + '">' + esc(p.name) + ' — ' + esc(p.tag) + '</option>';
      }).join('') + '</optgroup></select></div>' +
      '<div class="f"><label for="tk-name">Name</label>' +
      '<input type="text" id="tk-name" autocomplete="off" placeholder="Foreman running the talk"></div>' +
      '<div class="f"><label for="tk-phone">Phone</label>' +
      '<input type="tel" id="tk-phone" inputmode="tel" placeholder="317-555-0100"></div>' +
      '<div class="f"><label for="tk-job">Jobsite</label>' +
      '<select id="tk-job">' + jobOpts + '</select></div>' +
      '<div class="f"><label>Message preview</label>' +
      '<div id="tk-preview" class="small" style="border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--bg);white-space:pre-wrap"></div></div>' +
      '<p class="err small" id="tk-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
      '<button class="btn btn-gold" id="tk-send" style="width:100%;justify-content:center">Text the talk</button>' +
      '<p class="small muted" style="margin-top:.7rem">They get a link with the full talk and a ' +
      'sign-in sheet. No app, no sign-in.</p>';

    drawer('Send toolbox talk', 'Text a prepared talk to a foreman', h);

    function talkMsg() {
      var t = tpls.filter(function (x) { return x.id === $('#tk-tpl').value; })[0] || tpls[0];
      return 'Toolbox Talk today: ' + t.topic + ' (' + t.mins + ' min). Tap to open the talk and ' +
        'sign-in sheet — run it with your crew before work and text back the headcount. — Safety';
    }
    function refresh() { var pv = $('#tk-preview'); if (pv) pv.textContent = talkMsg(); }
    refresh();
    $('#tk-tpl').onchange = refresh;
    $('#tk-who').onchange = function () {
      var p = people[this.value];
      $('#tk-name').value  = p ? p.name : '';
      $('#tk-phone').value = p ? p.phone : '';
    };
    $('#tk-send').onclick = function () {
      var name  = $('#tk-name').value.trim();
      var phone = $('#tk-phone').value.trim();
      var t = tpls.filter(function (x) { return x.id === $('#tk-tpl').value; })[0];
      var err = $('#tk-err');
      if (!t)     { err.textContent = 'Pick a toolbox talk.'; return; }
      if (!phone) { err.textContent = 'A phone number is required.'; return; }
      closeDrawer();
      toast('“' + t.topic + '” toolbox talk texted to ' + (name || phone) + '.');
    };
  }

  function openTalk(id) {
    var t = (B.talks || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var h = pdfBtn('dl-talk');
    if (t.note) h += '<div class="alert" style="background:var(--warn-tt);border-color:var(--warn-br)">' +
      esc(t.note) + '</div>';
    h += '<div class="sec-h">Details</div>' +
      kv('Site', jobName(t.job_id)) + kv('Date', fmtDate(t.date)) +
      kv('Presented by', t.presented_by) + kv('Length', t.minutes + ' minutes') +
      kv('Attendance', t.attendees + ' workers');
    if ((t.subs || []).length) h += kv('Crews present', t.subs.map(subName).join(', '));
    // Delivery Activity — only when this completed talk was digitally sent (a
    // submitted send links to it). Kept separate from presentation/attendance/sign-in.
    if (t.assignment_id) {
      h += assignmentDeliveryHtml('toolbox', t.assignment_id);
    } else {
      var tSend = (B.talk_sends || []).filter(function (s) { return s.submitted_at && s.talk_id === t.id; })[0];
      if (tSend) h += deliveryActivityHtml(tSend);
    }
    h += '<div class="sec-h">What was covered</div>' +
      (t.points || []).map(function (p) {
        return '<div class="bullet"><span class="m d">•</span><span>' + esc(p) + '</span></div>';
      }).join('');
    h += '<div class="sec-h">Sign-in</div><div class="small muted">' + t.attendees +
      ' signatures on file. The signed sheet ships with the record in the live build.</div>';
    drawer(t.topic, fmtDate(t.date) + ' · ' + jobName(t.job_id), h);
    $('#dl-talk').onclick = function () {
      var p = '<div class="sec">Covered</div>' + (t.points || []).map(function (pt) {
        return '<div class="row"><span>' + esc(pt) + '</span></div>';
      }).join('') +
      '<div class="sec">Attendance</div><div class="row"><span>Workers signed in</span>' +
      '<span class="chip ok">' + t.attendees + '</span></div>' +
      ((t.subs || []).length ? '<div class="row"><span>Crews present</span><span>' +
        esc(t.subs.map(subName).join(', ')) + '</span></div>' : '');
      printRecord('Toolbox Talk — ' + t.topic,
        fmtDate(t.date) + ' · ' + jobName(t.job_id) + ' · ' + t.presented_by, p);
    };
  }

  /* ====================== REPORTS ======================================= */
  var obsTab = 'reports';
  var obsF = { q: '', job: '', person: '', range: '' };   // Safety Reports filters — desk defaults to all time
  var obsCaF = { job: '', src: '', status: '' };   // Safety Inspections · Corrective Actions filters
  function subtabs(current, tabs, attr) {
    return '<div class="subtabs">' + tabs.map(function (t) {
      return '<button data-' + attr + '="' + t[0] + '"' +
        (current === t[0] ? ' class="on"' : '') + '>' + esc(t[1]) + '</button>';
    }).join('') + '</div>';
  }
  function wireSubtabs(attr, fn) {
    $$('[data-' + attr + ']').forEach(function (b) {
      b.onclick = function () { fn(b.dataset[attr.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })]); };
    });
  }
  // Search filters for the secondary subtabs (CA / archive / logs). Keyed store
  // so each subtab keeps its own query without a global per-page variable.
  var subQ = {};
  function fbarSearch(id, val, ph) {
    return '<div class="fbar"><div class="search">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
      '<input id="' + id + '" placeholder="' + esc(ph) + '" value="' + esc(val || '') + '"></div></div>';
  }
  function wireSearch(id, cb) {
    var e = $('#' + id); if (!e) return;
    e.oninput = function () { cb(e.value); };
    if (e.value) { e.focus(); try { e.setSelectionRange(e.value.length, e.value.length); } catch (x) {} }
  }
  function has(str, q) { return !q || String(str).toLowerCase().indexOf(q) !== -1; }

  /* Every corrective action in one place, whatever record it came from. */
  function allCorrective() {
    var out = [];
    (B.findings || []).forEach(function (f) {
      out.push({ text: f.corrective || (f.imported ? 'Open finding — corrective action pending' : f.description),
        detail: f.description,
        src: f.imported ? (f.source || 'Imported Safety 101') : 'Report finding',
        owner: f.imported ? '' : subName(f.sub_id), job: f.job_id,
        due: f.due, status: f.status, ref: 'find|' + f.id,
        photos: (f.photos_list || []).length });
    });
    (B.incidents || []).forEach(function (i) {
      (i.corrective || []).forEach(function (ca, ix) {
        out.push({ text: ca.action, src: 'Incident', owner: ca.owner,
          job: i.job_id, due: ca.due, status: ca.status,
          ref: 'inc|' + i.id + '|' + ix, photos: (ca.photos || []).length });
      });
    });
    (B.reports || []).forEach(function (r) {
      if (r.imported) return;   // imported failures are tracked via findings, not report fixes
      Object.keys(r.fixes || {}).forEach(function (k) {
        out.push({ text: r.fixes[k].action, src: 'Report ' + repDateDisp(r),
          owner: r.fixes[k].owner, job: r.job_id, due: r.report_date,
          status: r.fixes[k].status, ref: 'rfix|' + r.id + '|' + k,
          photos: (r.fixes[k].photos || []).length });
      });
    });
    return out.sort(function (a, b) {
      if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
      return new Date(b.due) - new Date(a.due);
    });
  }

  function reportPBody(r) {
    if (r.imported) {
      var ip = '<div class="sec">Imported Safety 101 source record</div>' +
        '<div class="row"><span>Report</span><span>' + esc(r.report_type || 'Safety Observation') + '</span></div>' +
        '<div class="row"><span>Reported location</span><span>' + esc(r.location || '—') + '</span></div>' +
        '<div class="row"><span>Performed by</span><span>' + esc(r.inspector_name || '—') + '</span></div>' +
        (r.counts ? '<div class="row"><span>Result</span><span>Pass ' + r.counts.pass + ' · Fail ' + r.counts.fail + ' · N/A ' + r.counts.na + ' (' + esc(r.counts.percent) + ')</span></div>' : '');
      var fl = [];
      (r.s101 || []).forEach(function (sec) { (sec.items || []).forEach(function (it) { if (it.result === 'FAIL') fl.push(sec.title + ': ' + it.q); }); });
      if (fl.length) { ip += '<div class="sec">Findings (open)</div>'; fl.forEach(function (q) { ip += '<div class="row"><span>' + esc(q) + '</span><span class="chip bad">FAIL</span></div>'; }); }
      ip += '<div class="sec">Source</div><div style="font-size:12px;color:#6b7280">Original Safety 101 PDF preserved with the record. Failed items are tracked as open corrective actions.</div>';
      return ip;
    }
    var p = '';
    ((r.fields || {}).sections || []).forEach(function (sec) {
      p += '<div class="sec">' + esc(sec.title) + '</div>';
      (sec.items || []).forEach(function (it) {
        var v = (r.items || {})[it.id];
        p += '<div class="row"><span>' + esc(it.label) + '</span><span class="chip ' +
          (v === 'yes' ? 'ok">YES' : v === 'no' ? 'bad">NO' : 'na">N/A') + '</span></div>';
        var fix = (r.fixes || {})[it.id];
        if (fix && fix.action) p += '<div class="fix">' + esc(fix.action) +
          '<div class="who">' + esc(fix.owner) + ' · ' + esc(fix.status) +
          ((fix.photos || []).length ? ' · ' + fix.photos.length + ' photo(s)' : '') + '</div></div>';
      });
    });
    if (r.notes) p += '<div class="sec">Notes</div><div style="font-size:12.5px">' + esc(r.notes) + '</div>';
    return p;
  }
  function crewPBody(r) {
    var p = '<div class="sec">Administrative</div>' +
      '<div class="row"><span>Form</span><span>' + esc(r.inspection_subtype || r.form_type || '—') + '</span></div>' +
      '<div class="row"><span>Job / site</span><span>' + esc(r.jobsite || '—') + '</span></div>' +
      (r.asset_id ? '<div class="row"><span>Asset / unit</span><span>' + esc(r.asset_id) + '</span></div>' : '') +
      '<div class="row"><span>Date</span><span>' + esc(fmtDate(r.inspection_date)) + '</span></div>' +
      '<div class="row"><span>Completed by</span><span>' + esc(r.inspector_name || '—') + '</span></div>' +
      '<div class="sec">Result</div><div class="row"><span>Items with defects</span>' +
      '<span class="chip ' + (r.has_defects ? 'bad">' + r.defect_count : 'ok">0') + '</span></div>';
    var defs = r.defects || [];
    if (defs.length) {
      p += '<div class="sec">Findings</div>';
      defs.forEach(function (dft) {
        p += '<div class="row"><span>' + esc(dft.label) + '</span><span class="chip bad">FLAGGED</span></div>' +
          (dft.action ? '<div class="fix">' + esc(dft.action) + '<div class="who">' + esc(dft.status || '') + '</div></div>' : '');
      });
    }
    // Seeded sample records store only summary data — say so rather than printing a near-empty page.
    if (!(r.fields && r.fields.sections)) {
      p += '<div class="sec">Demo sample</div><div style="font-size:12px;color:#6b7280">' +
        'Detailed per-item checklist responses are not stored in this sample record. ' +
        'Live field submissions capture every checklist item, response, note and photo.</div>';
    }
    return p;
  }
  function personPBody(name) {
    var list = certsByWorker()[name] || [];
    return '<div class="sec">Certifications</div>' + list.map(function (c) {
      var dd = certDays(c.expires);
      return '<div class="row"><span>' + esc(c.cert_type) +
        ' — issued ' + esc(fmtDate(c.issued)) + ', expires ' + esc(fmtDate(c.expires)) +
        '</span><span class="chip ' + (dd < 0 ? 'bad">EXPIRED' : dd <= 60 ? 'bad">' + dd + ' DAYS'
        : 'ok">CURRENT') + '</span></div>';
    }).join('');
  }

  function pgObs() {
    if (obsTab === 'template') obsTab = 'reports';
    var right = subtabs(obsTab, [['reports', 'Safety Inspections'], ['ca', 'Corrective actions'], ['archive', 'Archive']], 'ot');
    var html;
    if (obsTab === 'reports') {
      html = head('Safety Inspections',
        'Completed site safety inspections performed and signed by your safety team. ' +
        'Review findings, corrective actions, and resolution history.', right);

      var allReps = (B.reports || []).filter(function (r) { return !r.archived; });
      var jobIds = {}, people = {};
      allReps.forEach(function (r) { jobIds[r.job_id] = 1; if (r.inspector_name) people[r.inspector_name] = 1; });
      var jobOpts = Object.keys(jobIds).map(function (id) {
        return '<option value="' + esc(id) + '"' + (obsF.job === id ? ' selected' : '') + '>' + esc(jobName(id)) + '</option>'; }).join('');
      var personOpts = Object.keys(people).sort().map(function (p) {
        return '<option value="' + esc(p) + '"' + (obsF.person === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('');
      var rangeOpts = [['', 'Any date'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (obsF.range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="ob-q" placeholder="Search reports…" value="' + esc(obsF.q) + '"></div>' +
        '<select id="ob-job"><option value="">All jobsites</option>' + jobOpts + '</select>' +
        '<select id="ob-person"><option value="">All inspectors</option>' + personOpts + '</select>' +
        '<select id="ob-range">' + rangeOpts + '</select></div>';

      var cutR = obsF.range ? new Date(Date.now() - (+obsF.range) * 86400000) : null;
      var q = obsF.q.toLowerCase();
      var reps = allReps.filter(function (r) {
        if (obsF.job && r.job_id !== obsF.job) return false;
        if (obsF.person && r.inspector_name !== obsF.person) return false;
        if (cutR && new Date(repDay(r) + 'T00:00:00') < cutR) return false;
        if (q && ((r.notes || '') + ' ' + jobName(r.job_id) + ' ' + (r.inspector_name || '')).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
      var rows = reps.map(function (r) {
        var name = r.imported ? esc(r.report_type || 'Safety 101 Inspection') : 'Construction Job Site Safety Checklist';
        var badge = r.imported ? ' <span class="src-badge">Imported Safety 101</span>' : '';
        var sub = r.imported
          ? 'Original Safety 101 source record' + (r.counts ? ' · Pass ' + r.counts.pass + ' · Fail ' + r.counts.fail + ' · N/A ' + r.counts.na : '')
          : (r.notes || '');
        return '<tr class="click" data-report="' + esc(r.id) + '">' + selCell(r.id) +
          '<td><span class="t-main">' + name + badge + '</span>' +
            '<div class="t-sub">' + esc(sub) + '</div></td>' +
          '<td>' + esc(repDateDisp(r)) +
            (r.submitted_at ? '<div class="t-sub">' + esc(tzTime(r.submitted_at)) + '</div>' : '') + '</td>' +
          '<td>' + esc(jobName(r.job_id)) + '<div class="t-sub">' + esc(jobNum(r.job_id)) + '</div></td>' +
          '<td>' + esc(r.inspector_name) + '</td>' +
          '<td class="r">' + (r.defect_count
            ? pill('p-warn', r.defect_count + ' flagged') : pill('p-ok', 'Clear')) + '</td>' +
          '<td class="r"><button class="btn btn-sm" data-reparch="' + esc(r.id) + '">Archive</button></td></tr>';
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>Reports</h3>' +
        '<div class="sub">' + reps.length + ' of ' + allReps.length + ' shown</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: '' }, { t: 'Report' }, { t: 'Date' }, { t: 'Site' }, { t: 'Inspector' }, { t: 'Result', r: 1 }, { t: '', r: 1 }],
        rows, 'No reports match your filters.') + '</div></div>';
    } else if (obsTab === 'ca') {
      html = head('Safety Inspections',
        'Every corrective action across reports, findings and incidents — who owns it ' +
        'and whether it is closed.', right);
      var casAll = allCorrective();
      var openN = casAll.filter(function (c) { return c.status === 'open'; }).length;
      var overdueN = casAll.filter(caOverdue).length;   // open + due date in the past
      html += '<div class="cards">' +
        kpi(casAll.length, 'corrective actions', 'all sources', 'c-grey') +
        kpi(openN, 'still open', 'requires closeout', openN ? 'c-warn' : 'c-ok') +
        kpi(overdueN, 'overdue', 'past due date', overdueN ? 'c-bad' : 'c-ok') +
        '</div>';
      // filters: search (existing) + jobsite + source + status, populated from the data
      var caJobSet = {}, caSrcSet = {};
      casAll.forEach(function (c) { if (c.job) caJobSet[c.job] = 1; if (c.src) caSrcSet[c.src] = 1; });
      var caJobOpts = Object.keys(caJobSet).map(function (id) {
        return '<option value="' + esc(id) + '"' + (obsCaF.job === id ? ' selected' : '') + '>' + esc(jobName(id)) + '</option>'; }).join('');
      var caSrcOpts = Object.keys(caSrcSet).sort().map(function (nm) {
        return '<option value="' + esc(nm) + '"' + (obsCaF.src === nm ? ' selected' : '') + '>' + esc(nm) + '</option>'; }).join('');
      var caStatOpts = [['', 'Any status'], ['open', 'Open'], ['closed', 'Closed / Verified']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (obsCaF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="obsca-q" placeholder="Search corrective actions…" value="' + esc(subQ.obsCa || '') + '"></div>' +
        '<select id="obsca-job"><option value="">All jobsites</option>' + caJobOpts + '</select>' +
        '<select id="obsca-src"><option value="">Any source</option>' + caSrcOpts + '</select>' +
        '<select id="obsca-status">' + caStatOpts + '</select></div>';
      var caq = (subQ.obsCa || '').toLowerCase();
      var cas = casAll.filter(function (c) {
        if (obsCaF.job && c.job !== obsCaF.job) return false;
        if (obsCaF.src && c.src !== obsCaF.src) return false;
        if (obsCaF.status && c.status !== obsCaF.status) return false;
        return has((c.text || '') + ' ' + (c.owner || '') + ' ' + (c.src || '') + ' ' + jobName(c.job), caq); });
      // Priority: overdue-open → open by nearest due → other open → closed (recent due first).
      cas.sort(function (a, b) {
        var ao = a.status === 'open', bo = b.status === 'open';
        if (ao !== bo) return ao ? -1 : 1;
        if (ao) {
          var aov = caOverdue(a), bov = caOverdue(b);
          if (aov !== bov) return aov ? -1 : 1;
          var ad = a.due ? new Date(a.due) : new Date(8640000000000000);
          var bd = b.due ? new Date(b.due) : new Date(8640000000000000);
          return ad - bd;
        }
        return new Date(b.due || 0) - new Date(a.due || 0);
      });
      var rows2 = cas.map(function (c) {
        return '<tr class="click" data-editca="' + esc(c.ref) + '">' +
          '<td><span class="t-main">' + esc(c.text || '(no action recorded yet — click to add)') + '</span></td>' +
          '<td>' + esc(c.src) + '</td>' +
          '<td>' + esc(c.owner || '—') + '</td>' +
          '<td>' + esc(jobName(c.job)) + '</td>' +
          '<td>' + esc(fmtDate(c.due)) + '</td>' +
          '<td class="r num">' + (c.photos ? '📷 ' + c.photos : '—') + '</td>' +
          '<td class="r">' + (c.status === 'open' ? pill('p-warn', 'Open') : pill('p-ok', 'Closed')) +
          '</td></tr>';
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>All corrective actions</h3>' +
        '<div class="sub">Open corrective actions appear first, prioritized by due date.</div>' +
        '</div></div><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Corrective action' }, { t: 'Source' }, { t: 'Owner' }, { t: 'Site' }, { t: 'Due' },
         { t: 'Photos', r: 1 }, { t: 'Status', r: 1 }], rows2, 'No corrective actions match these filters.') +
        '</div></div>';
    } else {
      // ARCHIVE — reports moved out of the active list.
      html = head('Safety Inspections', 'Reports moved out of the active list. Restore one to bring it back.', right);
      var oaq = (subQ.obsArch || '').toLowerCase();
      var archR = (B.reports || []).filter(function (r) {
        return r.archived && has(jobName(r.job_id) + ' ' + (r.inspector_name || '') + ' ' + (r.notes || ''), oaq); });
      html += fbarSearch('obsarch-q', subQ.obsArch, 'Search archived reports…');
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Report' }, { t: 'Date' }, { t: 'Site' }, { t: 'Inspector' }, { t: '', r: 1 }],
        archR.map(function (r) {
          return '<tr><td><span class="t-main">Construction Job Site Safety Checklist</span></td>' +
            '<td>' + esc(repDateDisp(r)) + '</td>' +
            '<td>' + esc(jobName(r.job_id)) + '</td>' +
            '<td>' + esc(r.inspector_name) + '</td>' +
            '<td class="r"><button class="btn btn-sm" data-represtore="' + esc(r.id) + '">Restore</button></td></tr>';
        }), 'Nothing archived.') + '</div></div>';
    }
    paint(html);
    wireSubtabs('ot', function (v) { obsTab = v; pgObs(); });
    $$('[data-reparch]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation();
      var r = (B.reports || []).filter(function (x) { return x.id === b.dataset.reparch; })[0];
      if (r) r.archived = true; toast('Report archived.'); pgObs(); }; });
    $$('[data-represtore]').forEach(function (b) { b.onclick = function () {
      var r = (B.reports || []).filter(function (x) { return x.id === b.dataset.represtore; })[0];
      if (r) r.archived = false; toast('Report restored.'); pgObs(); }; });
    if (obsTab === 'ca') {
      wireSearch('obsca-q', function (v) { subQ.obsCa = v; pgObs(); });
      function obcaBind(id, key) { var e = $('#' + id); if (e) e.onchange = function () { obsCaF[key] = e.value; pgObs(); }; }
      obcaBind('obsca-job', 'job'); obcaBind('obsca-src', 'src'); obcaBind('obsca-status', 'status');
    }
    if (obsTab === 'archive') wireSearch('obsarch-q', function (v) { subQ.obsArch = v; pgObs(); });
    if (obsTab === 'reports') {
      function obBind(id, key) { var e = $('#' + id); if (e) e.oninput = e.onchange = function () { obsF[key] = e.value; pgObs(); }; }
      obBind('ob-q', 'q'); obBind('ob-job', 'job'); obBind('ob-person', 'person'); obBind('ob-range', 'range');
      var _obq = $('#ob-q'); if (_obq && obsF.q) { _obq.focus(); try { _obq.setSelectionRange(_obq.value.length, _obq.value.length); } catch (e) {} }
      massInit({ label: 'Download selected', run: function (ids) {
        combinedPrint('Site Safety Reports', ids.map(function (id) {
          var r = (B.reports || []).filter(function (x) { return x.id === id; })[0];
          return { title: 'Site Safety Report', body: reportPBody(r),
            sub: repDateDisp(r) + ' · ' + jobName(r.job_id) + ' · ' + r.inspector_name };
        }) );
      } });
    }
  }

  // ---- Construction Job Site Safety Checklist editor (Template subtab) ----
  function cjscEditorHtml(d) {
    return d.sections.map(function (s, si) {
      var body = s.items.map(function (it, ii) {
        return '<div style="display:flex;gap:8px;align-items:center;margin:5px 0">' +
          '<span class="dot" style="background:var(--ink-4);flex-shrink:0"></span>' +
          '<input class="cj-item" data-si="' + si + '" data-ii="' + ii + '" value="' + esc(it.label) + '" ' +
            'style="flex:1;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px">' +
          (it.type ? '<span class="pill p-grey" style="white-space:nowrap">' + esc(it.type) + '</span>' : '') +
          '<button class="cj-rmitem" data-si="' + si + '" data-ii="' + ii + '" title="Remove item" ' +
            'style="border:none;background:none;color:var(--fail);cursor:pointer;font-size:18px;line-height:1;padding:0 4px">&times;</button>' +
        '</div>';
      }).join('');
      return '<div class="cj-sec" style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
          '<input class="cj-title" data-si="' + si + '" value="' + esc(s.title) + '" ' +
            'style="flex:1;font-weight:700;font-size:14px;padding:6px 8px;border:1px solid var(--line);border-radius:6px">' +
          '<span class="muted small" style="white-space:nowrap">' + s.items.length + ' items</span>' +
          '<button class="btn btn-sm" data-rmsec="' + si + '" style="color:var(--fail)">Remove section</button>' +
        '</div>' + body +
        '<button class="btn btn-sm" data-additem="' + si + '" style="margin-top:8px">+ Add item</button>' +
      '</div>';
    }).join('') +
    '<button class="btn" id="cj-addsec" style="margin-top:4px">+ Add section</button>';
  }

  function wireCjscEditor() {
    var d = draftFor('insp_cjsc');
    $$('.cj-title').forEach(function (el) {
      el.oninput = function () { d.sections[+el.dataset.si].title = el.value; };
    });
    $$('.cj-item').forEach(function (el) {
      el.oninput = function () { d.sections[+el.dataset.si].items[+el.dataset.ii].label = el.value; };
    });
    $$('.cj-rmitem').forEach(function (b) {
      b.onclick = function () { d.sections[+b.dataset.si].items.splice(+b.dataset.ii, 1); pgObs(); };
    });
    $$('[data-additem]').forEach(function (b) {
      b.onclick = function () {
        d.sections[+b.dataset.additem].items.push({ id: 'i' + Date.now(), label: '' });
        pgObs();
      };
    });
    $$('[data-rmsec]').forEach(function (b) {
      b.onclick = function () {
        if (confirm('Remove this section and all of its items?')) { d.sections.splice(+b.dataset.rmsec, 1); pgObs(); }
      };
    });
    var as = $('#cj-addsec');
    if (as) as.onclick = function () {
      d.sections.push({ id: 's' + Date.now(), title: 'New Section', items: [{ id: 'i' + Date.now(), label: '' }] });
      pgObs();
    };
    var sv = $('#cj-save');
    if (sv) sv.onclick = function () { toast('Template saved for this session.'); };
  }

  function openReport(id) {
    var r = (B.reports || []).filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (r.imported) return openImportedReport(r);
    var h = pdfBtn('dl-rep');
    h += '<div class="sec-h">Details</div>' +
      kv('Site', jobName(r.job_id)) + kv('Inspection Date', repDateDisp(r)) +
      (r.submitted_at ? kv('Submitted', tzDateTime(r.submitted_at)) : '') +
      kv('Performed by', r.inspector_name) + kv('Signature', r.signature_typed) +
      kv('Result', r.defect_count ? r.defect_count + ' item' +
         (r.defect_count === 1 ? '' : 's') + ' flagged' : 'All items clear');
    ((r.fields || {}).sections || []).forEach(function (sec) {
      h += '<div class="sec-h">' + esc(sec.title) + '</div>';
      (sec.items || []).forEach(function (it) {
        var v = (r.items || {})[it.id];
        var chip = v === 'yes' ? '<span class="v" style="color:var(--ok)">YES</span>'
                 : v === 'no'  ? '<span class="v bad">NO</span>'
                 : '<span class="v" style="color:var(--ink-5)">N/A</span>';
        h += '<div class="kv"><span class="k" style="color:var(--ink-2)">' +
          esc(it.label) + '</span>' + chip + '</div>';
        var fix = (r.fixes || {})[it.id];
        if (fix) {
          h += '<div class="fixbox">' +
            '<div class="who" style="font-weight:700;color:var(--ink-3);margin-bottom:2px">Finding</div>' +
            '<div>' + esc(fix.action || 'No corrective action recorded yet.') + '</div>' +
            '<div class="who">' + esc(fix.owner) + ' &nbsp; ' +
            (fix.status === 'open' ? pill('p-warn', 'Open') : pill('p-ok', 'Closed')) +
            ((fix.photos || []).length ? ' &nbsp; 📷 ' + fix.photos.length : '') +
            ' &nbsp;<button class="linklike" data-editca="rfix|' + esc(r.id) + '|' + esc(it.id) +
            '">Edit</button></div></div>';
        } else if (v === 'no') {
          h += '<div class="fixbox" style="background:#fafbfc;border-color:var(--line-2)">' +
            '<button class="linklike" data-editca="rfix|' + esc(r.id) + '|' + esc(it.id) +
            '">+ Add corrective action</button></div>';
        }
      });
    });
    if (r.notes) h += '<div class="sec-h">Notes</div><div class="small">' + esc(r.notes) + '</div>';
    drawer('Site Safety Report', repDateDisp(r) + ' · ' + jobName(r.job_id), h);
    $$('.drawer [data-editca]').forEach(function (b) {
      b.onclick = function () { openCA(b.dataset.editca); };
    });
    $('#dl-rep').onclick = function () {
      printRecord('Site Safety Report',
        repDateDisp(r) + ' · ' + jobName(r.job_id) + ' · ' + r.inspector_name,
        reportPBody(r));
    };
  }

  // Imported Greiner Safety 101 record — a faithful view of the original source
  // inspection. Failed items are the source observations; their corrective
  // actions live in Corrective Actions (open until a real correction is added).
  function openImportedReport(r) {
    var h = (r.source_pdf
      ? '<button class="btn btn-sm" id="dl-rep" style="margin-bottom:14px">Download Safety 101 PDF</button>'
      : pdfBtn('dl-rep'));
    h += '<div class="src-badge" style="margin:0 0 12px">Imported Safety 101 Record</div>';
    h += '<div class="sec-h">Original Safety 101 source record</div>' +
      kv('Report type', r.report_type || 'Safety Observation') +
      kv('Job / site', jobName(r.job_id)) +
      (r.location ? kv('Reported location', r.location) : '') +
      kv('Performed by', r.inspector_name) +
      kv('Submitted', repDateDisp(r)) +
      (r.counts ? kv('Result', 'Pass ' + r.counts.pass + ' · Fail ' + r.counts.fail + ' · N/A ' + r.counts.na + '  (' + r.counts.percent + ')') : '');
    var fails = [];
    (r.s101 || []).forEach(function (sec) { (sec.items || []).forEach(function (it) { if (it.result === 'FAIL') fails.push({ sec: sec.title, q: it.q }); }); });
    if (fails.length) {
      h += '<div class="sec-h">Findings — failed items (' + fails.length + ')</div>';
      fails.forEach(function (f) {
        h += '<div class="fixbox">' +
          '<div class="who" style="font-weight:700;color:var(--ink-3);margin-bottom:2px">Source observation / finding · ' + esc(f.sec) + '</div>' +
          '<div>' + esc(f.q) + '</div>' +
          '<div class="who" style="margin-top:3px">Corrective action: <i>open — none recorded in source</i> &nbsp; ' + pill('p-warn', 'Open') + '</div></div>';
      });
      h += '<div class="small" style="color:var(--ink-4);margin-top:4px">These failed items are tracked as open corrective actions under Corrective Actions.</div>';
    } else {
      h += '<div class="sec-h">Findings</div><div class="small" style="color:var(--ok)">No failed items — full pass.</div>';
    }
    h += '<div class="sec-h">Full checklist (as inspected)</div>';
    (r.s101 || []).forEach(function (sec) {
      h += '<div class="who" style="font-weight:700;color:var(--ink-3);margin:8px 0 2px">' + esc(sec.title) + '</div>';
      (sec.items || []).forEach(function (it) {
        var chip = it.result === 'PASS' ? '<span class="v" style="color:var(--ok)">PASS</span>'
                 : it.result === 'FAIL' ? '<span class="v bad">FAIL</span>'
                 : '<span class="v" style="color:var(--ink-5)">N/A</span>';
        h += '<div class="kv"><span class="k" style="color:var(--ink-2)">' + esc(it.q) + '</span>' + chip + '</div>';
      });
    });
    if (r.source_pdf) {
      h += '<div class="sec-h">Source document</div>' +
        '<a class="btn btn-sm" href="' + esc(r.source_pdf) + '" target="_blank" rel="noopener">Open original Safety 101 PDF</a>';
    }
    drawer(r.report_type || 'Safety 101 Inspection', repDateDisp(r) + ' · ' + jobName(r.job_id) + ' · Imported', h);
    $('#dl-rep').onclick = function () {
      if (r.source_pdf) {
        // Download the ACTUAL imported Safety 101 source PDF, not an app-generated one.
        var a = document.createElement('a');
        a.href = r.source_pdf.split('/').map(encodeURIComponent).join('/');
        a.download = ('Safety 101 Inspection ' + (r.report_date || r.id) + '.pdf').replace(/[\/\\?%*:|"<>]/g, '-');
        document.body.appendChild(a); a.click(); a.remove();
        return;
      }
      printRecord(r.report_type || 'Safety Observation',
        repDateDisp(r) + ' · ' + jobName(r.job_id) + ' · ' + r.inspector_name, reportPBody(r), { imported: true });
    };
  }

  var inspTab = 'completed';
  var inspF = { q: '', job: '', person: '', range: '' };   // Inspections (Completed) filters — desk defaults to all time
  var inCaF = { job: '', status: '' };   // Inspections · Corrective Actions filters
  // Read-only detail for a Sent Link row. Reuses the existing drawer + kv + pill
  // pattern; surfaces only fields already on the invite object (no new data,
  // no resend/reminder/edit). No View Submission — the invite has no stored
  // relationship to a completed submission.
  function openSentLink(id) {
    var v = (B.invites || []).filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    var badge = v.status === 'completed' ? pill('p-ok', 'Submitted')
      : v.status === 'opened' ? pill('p-warn', 'Opened, not submitted')
      : pill('p-grey', 'Sent');
    var h = '<div class="sec-h">Form</div>' +
      '<div class="small">' + esc((v.templates || []).join(', ') || '—') + '</div>' +
      '<div class="sec-h">Sent to</div>' +
      kv('Name', v.name || '—') +
      (v.phone ? kv('Phone', v.phone) : '') +
      (v.sub_id ? kv('Company', subName(v.sub_id)) : '') +
      '<div class="sec-h">Delivery activity</div>' +
      kv('Sent', v.sent_at ? fmtWhen(v.sent_at) : 'Not yet') +
      kv('Opened', v.opened_at ? fmtWhen(v.opened_at) : 'Not yet') +
      kv('Submitted', v.submitted_at ? fmtWhen(v.submitted_at) : 'Not yet') +
      '<div class="sec-h">Status</div><div>' + badge + '</div>';
    drawer('Sent link', (v.name || '') + ((v.templates || []).length ? ' · ' + v.templates.join(', ') : ''), h);
  }

  // Shared Delivery Activity — one presentation for every send (talk/permit/…).
  // Used by the pending send drawers AND inside completed record details.
  function deliverySendStatus(s) {
    return s.submitted_at ? pill('p-ok', 'Submitted')
      : s.opened_at ? pill('p-warn', 'Opened, not submitted')
      : pill('p-grey', 'Sent');
  }
  function deliveryActivityHtml(s) {
    return '<div class="sec-h">Delivery Activity</div>' +
      kv('Sent', s.sent_at ? fmtWhen(s.sent_at) : 'Not yet') +
      kv('Opened', s.opened_at ? fmtWhen(s.opened_at) : 'Not yet') +
      kv('Submitted', s.submitted_at ? fmtWhen(s.submitted_at) : 'Not yet') +
      '<div class="kv"><span class="k">Status</span><span class="v">' + deliverySendStatus(s) + '</span></div>';
  }
  // Read-only detail for a pending Toolbox Talk send.
  function openTalkSend(id) {
    var s = (B.talk_sends || []).filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var h = '<div class="sec-h">Toolbox Talk</div>' +
      '<div class="small">' + esc(s.topic || '—') + '</div>' +
      '<div class="sec-h">Sent to</div>' +
      kv('Name', s.recipient || '—') +
      (s.phone ? kv('Phone', s.phone) : '') +
      (s.sub_id ? kv('Company', subName(s.sub_id)) : '') +
      (s.job_id ? kv('Site', jobName(s.job_id)) : '') +
      deliveryActivityHtml(s);
    drawer('Toolbox talk send', (s.recipient || '') + (s.topic ? ' · ' + s.topic : ''), h);
  }
  // Read-only detail for a pending Work Permit send.
  function openPermitSend(id) {
    var s = (B.permit_sends || []).filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var h = '<div class="sec-h">Permit</div>' +
      '<div class="small">' + esc(permitLabel(s.type)) + '</div>' +
      '<div class="sec-h">Sent to</div>' +
      kv('Name', s.recipient || '—') +
      (s.phone ? kv('Phone', s.phone) : '') +
      (s.sub_id ? kv('Company', subName(s.sub_id)) : '') +
      (s.job_id ? kv('Site', jobName(s.job_id)) : '') +
      deliveryActivityHtml(s);
    drawer('Permit send', (s.recipient || '') + ' · ' + permitLabel(s.type), h);
  }

  function pgInsp() {
    if (inspTab === 'template') inspTab = 'completed';
    var right = subtabs(inspTab, [['completed', 'Completed'], ['links', 'Awaiting Submission'],
      ['ca', 'Corrective actions'], ['archive', 'Archive']], 'it');
    var html;
    if (inspTab === 'completed') {
      html = head('Inspections',
        'Equipment checks, JHAs, pre-task checks and permit forms completed by crews in ' +
        'the field. Click one for the detail and its corrective actions.', right);

      var sites = {}, ipeople = {};
      CREW.forEach(function (r) { if (r.jobsite) sites[r.jobsite] = 1; if (r.inspector_name) ipeople[r.inspector_name] = 1; });
      var siteOpts = Object.keys(sites).sort().map(function (s) {
        return '<option value="' + esc(s) + '"' + (inspF.job === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
      var iPersonOpts = Object.keys(ipeople).sort().map(function (p) {
        return '<option value="' + esc(p) + '"' + (inspF.person === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('');
      var iRangeOpts = [['', 'Any date'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (inspF.range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="in-q" placeholder="Search inspections…" value="' + esc(inspF.q) + '"></div>' +
        '<select id="in-job"><option value="">All jobsites</option>' + siteOpts + '</select>' +
        '<select id="in-person"><option value="">All people</option>' + iPersonOpts + '</select>' +
        '<select id="in-range">' + iRangeOpts + '</select></div>';

      var cutI = inspF.range ? new Date(Date.now() - (+inspF.range) * 86400000) : null;
      var iq = inspF.q.toLowerCase();
      var activeCrew = CREW.filter(function (r) { return !r.archived; });
      var crewRows = activeCrew.filter(function (r) {
        if (inspF.job && r.jobsite !== inspF.job) return false;
        if (inspF.person && r.inspector_name !== inspF.person) return false;
        if (cutI && new Date(r.inspection_date + 'T00:00:00') < cutI) return false;
        if (iq && ((r.inspection_subtype || '') + ' ' + (r.form_type || '') + ' ' + (r.asset_id || '') + ' ' +
          (r.jobsite || '') + ' ' + (r.inspector_name || '')).toLowerCase().indexOf(iq) === -1) return false;
        return true;
      });
      var rows = crewRows.map(function (r) {
        return '<tr class="click" data-crewi="' + esc(r.id) + '">' + selCell(r.id) +
          '<td><span class="t-main">' + esc(r.inspection_subtype || r.form_type) + '</span>' +
            (r.asset_id ? '<div class="t-sub">' + esc(r.asset_id) + '</div>' : '') + '</td>' +
          '<td>' + esc(fmtDate(r.inspection_date)) +
            (r.submitted_at ? '<div class="t-sub">' + esc(tzTime(r.submitted_at)) + '</div>' : '') + '</td>' +
          '<td>' + esc(r.jobsite) + '</td>' +
          '<td>' + esc(r.inspector_name) +
            (r.sub_id ? '<div class="t-sub">' + esc(subName(r.sub_id)) + '</div>' : '') + '</td>' +
          '<td class="r">' + (r.has_defects
            ? pill('p-bad', r.defect_count + ' defect' + (r.defect_count === 1 ? '' : 's'))
            : pill('p-ok', 'Clear')) + '</td>' +
          '<td class="r"><button class="btn btn-sm" data-crewarch="' + esc(r.id) + '">Archive</button></td></tr>';
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>Completed inspections</h3>' +
        '<div class="sub">' + crewRows.length + ' of ' + activeCrew.length + ' shown</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: '' }, { t: 'Form' }, { t: 'Date' }, { t: 'Site' }, { t: 'By' },
         { t: 'Result', r: 1 }, { t: '', r: 1 }], rows, 'No inspections match your filters.') + '</div></div>';
    } else if (inspTab === 'links') {
      html = head('Inspections',
        'Digitally sent field forms still awaiting submission — sent but not opened, or ' +
        'opened but not yet submitted. Once submitted, a form drops off this list.', right);
      var lq = (subQ.inspLinks || '').toLowerCase();
      // One row per OUTSTANDING assignment. A form sent to N people appears once;
      // its assignment clears the moment the first recipient submits.
      html += fbarSearch('inlinks-q', subQ.inspLinks, 'Search sent links…');
      var rows2 = awaitingRows(B.invites, 'inspection', function (v) { return (v.templates || []).join(', ') || '—'; }, lq);
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Sent To' }, { t: 'Form' }, { t: 'Jobsite' }, { t: 'Sent' }, { t: 'Opened' },
         { t: 'Status', r: 1 }], rows2, 'Nothing awaiting submission.') +
        '</div></div>';
    } else if (inspTab === 'ca') {
      html = head('Inspections',
        'Everything crews flagged in the field and what was done about it. Click one to ' +
        'edit the action, close it out, or attach photos.', right);
      var caList = [];
      CREW.forEach(function (r) { (r.defects || []).forEach(function (dft, ix) { caList.push({ r: r, dft: dft, ix: ix }); }); });
      var inOpenN = caList.filter(function (x) { return x.dft.status === 'open'; }).length;
      // No Overdue KPI here: field-form defects carry no due date in the data.
      html += '<div class="cards">' +
        kpi(caList.length, 'corrective actions', 'all field forms', 'c-grey') +
        kpi(inOpenN, 'still open', 'requires closeout', inOpenN ? 'c-warn' : 'c-ok') +
        '</div>';
      var inCaJobSet = {}; caList.forEach(function (x) { if (x.r.jobsite) inCaJobSet[x.r.jobsite] = 1; });
      var inCaJobOpts = Object.keys(inCaJobSet).sort().map(function (j) {
        return '<option value="' + esc(j) + '"' + (inCaF.job === j ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('');
      var inCaStatOpts = [['', 'Any status'], ['open', 'Open'], ['closed', 'Closed / Verified']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (inCaF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      html += '<div class="fbar">' +
        '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="inca-q" placeholder="Search corrective actions…" value="' + esc(subQ.inspCa || '') + '"></div>' +
        '<select id="inca-job"><option value="">All jobsites</option>' + inCaJobOpts + '</select>' +
        '<select id="inca-status">' + inCaStatOpts + '</select></div>';
      var caq = (subQ.inspCa || '').toLowerCase();
      var caShown = caList.filter(function (x) {
        if (inCaF.job && x.r.jobsite !== inCaF.job) return false;
        if (inCaF.status && x.dft.status !== inCaF.status) return false;
        return has(x.dft.label + ' ' + (x.r.jobsite || '') + ' ' + (x.r.sub_id ? subName(x.r.sub_id) : x.r.inspector_name) + ' ' + (x.r.inspection_subtype || x.r.form_type || ''), caq);
      });
      // No due dates on field-form defects → Open first, then Closed (newest inspection leads within each group).
      caShown.sort(function (a, b) {
        var ao = a.dft.status === 'open', bo = b.dft.status === 'open';
        if (ao !== bo) return ao ? -1 : 1;
        return new Date(b.r.inspection_date) - new Date(a.r.inspection_date);
      });
      var rows3 = caShown.map(function (x) {
        var r = x.r, dft = x.dft, ix = x.ix;
        return '<tr class="click" data-editca="crew|' + esc(r.id) + '|' + ix + '">' +
            '<td><span class="t-main">' + esc(dft.label) + '</span></td>' +
            '<td>' + esc(r.inspection_subtype || r.form_type) + ' · ' +
            esc(fmtDate(r.inspection_date)) + '</td>' +
            '<td>' + esc(r.jobsite) + '</td>' +
            '<td>' + esc(r.sub_id ? subName(r.sub_id) : r.inspector_name) + '</td>' +
            '<td class="r num">' + ((dft.photos || []).length ? '\ud83d\udcf7 ' + dft.photos.length : '—') + '</td>' +
            '<td class="r">' + (dft.status === 'open' ? pill('p-warn', 'Open') : pill('p-ok', 'Closed')) +
            '</td></tr>';
      });
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Defect & Action' }, { t: 'Source' }, { t: 'Site' }, { t: 'Responsible Party' }, { t: 'Photos', r: 1 },
         { t: 'Status', r: 1 }], rows3, 'No corrective actions match these filters.') + '</div></div>';
    } else {
      // ARCHIVE — inspections moved out of the active list.
      html = head('Inspections', 'Inspections moved out of the active list. Restore one to bring it back.', right);
      var iaq = (subQ.inspArch || '').toLowerCase();
      var archI = CREW.filter(function (r) {
        return r.archived && has((r.inspection_subtype || r.form_type || '') + ' ' + (r.jobsite || '') + ' ' + (r.inspector_name || ''), iaq); });
      html += fbarSearch('inarch-q', subQ.inspArch, 'Search archived inspections…');
      html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Form' }, { t: 'Date' }, { t: 'Site' }, { t: 'By' }, { t: '', r: 1 }],
        archI.map(function (r) {
          return '<tr><td><span class="t-main">' + esc(r.inspection_subtype || r.form_type) + '</span></td>' +
            '<td>' + esc(fmtDate(r.inspection_date)) + '</td>' +
            '<td>' + esc(r.jobsite) + '</td>' +
            '<td>' + esc(r.inspector_name) + '</td>' +
            '<td class="r"><button class="btn btn-sm" data-crewrestore="' + esc(r.id) + '">Restore</button></td></tr>';
        }), 'Nothing archived.') + '</div></div>';
    }
    paint(html);
    wireSubtabs('it', function (v) { inspTab = v; pgInsp(); });
    $$('[data-crewarch]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation();
      var r = CREW.filter(function (x) { return x.id === b.dataset.crewarch; })[0];
      if (r) r.archived = true; toast('Inspection archived.'); pgInsp(); }; });
    $$('[data-crewrestore]').forEach(function (b) { b.onclick = function () {
      var r = CREW.filter(function (x) { return x.id === b.dataset.crewrestore; })[0];
      if (r) r.archived = false; toast('Inspection restored.'); pgInsp(); }; });
    if (inspTab === 'links') wireSearch('inlinks-q', function (v) { subQ.inspLinks = v; pgInsp(); });
    if (inspTab === 'ca') {
      wireSearch('inca-q', function (v) { subQ.inspCa = v; pgInsp(); });
      function incaBind(id, key) { var e = $('#' + id); if (e) e.onchange = function () { inCaF[key] = e.value; pgInsp(); }; }
      incaBind('inca-job', 'job'); incaBind('inca-status', 'status');
    }
    if (inspTab === 'archive') wireSearch('inarch-q', function (v) { subQ.inspArch = v; pgInsp(); });
    if (inspTab === 'completed') {
      function inBind(id, key) { var e = $('#' + id); if (e) e.oninput = e.onchange = function () { inspF[key] = e.value; pgInsp(); }; }
      inBind('in-q', 'q'); inBind('in-job', 'job'); inBind('in-person', 'person'); inBind('in-range', 'range');
      var _inq = $('#in-q'); if (_inq && inspF.q) { _inq.focus(); try { _inq.setSelectionRange(_inq.value.length, _inq.value.length); } catch (e) {} }
      massInit({ label: 'Download selected', run: function (ids) {
        combinedPrint('Inspections', ids.map(function (id) {
          var r = CREW.filter(function (x) { return x.id === id; })[0];
          return { title: r.inspection_subtype || r.form_type, body: crewPBody(r),
            sub: fmtDate(r.inspection_date) + ' · ' + r.jobsite + ' · ' + r.inspector_name };
        }) );
      } });
    }
  }

  // Render the canonical structured record (fields.doc) — every section, item,
  // response, note and photo, in order. Shared by the crew-inspection drawer.
  function docRespLabel(v) {
    var s = String(v == null ? '' : v).trim(), l = s.toLowerCase();
    var m = { yes: 'Yes', no: 'No', pass: 'Pass', fail: 'Fail', safe: 'Safe', defect: 'DEFECT', unsafe: 'UNSAFE', na: 'N/A', 'n/a': 'N/A', complete: 'Complete', incomplete: 'Incomplete' };
    return m[l] || s;
  }
  function docDetailHtml(doc) {
    if (!doc || !doc.sections || !doc.sections.length) return '<div class="small muted">The full record is available in the PDF.</div>';
    var h = '';
    doc.sections.forEach(function (sec) {
      h += '<div class="sec-h">' + esc(sec.title) + '</div>';
      (sec.items || []).forEach(function (it) {
        var raw = it.response == null ? '' : String(it.response);
        if (/^[a-z]:\\fakepath\\/i.test(raw)) raw = '';   // hide browser file-picker noise
        var resp = docRespLabel(raw);
        var col = it.flagged ? 'var(--fail,#c0392b)' : (/^(yes|pass|safe|ok|n\/a|complete)$/i.test(resp) ? 'var(--ok,#1e7d34)' : 'inherit');
        var rv = resp ? '<span style="font-weight:700;color:' + col + ';overflow-wrap:anywhere">' + esc(resp) + (it.flagged ? ' — FLAGGED' : '') + '</span>' : '';
        h += '<div class="kv" style="align-items:flex-start"><span class="k" style="overflow-wrap:anywhere">' + esc(it.label) + '</span><span class="v">' + rv + '</span></div>';
        if (it.notes) h += '<div class="small muted" style="margin:-6px 0 8px;padding-left:2px;overflow-wrap:anywhere"><em>' + (it.flagged ? 'Notes / what went wrong: ' : 'Notes: ') + esc(it.notes) + '</em></div>';
        (it.photos || []).forEach(function (p) {
          h += '<div style="margin:2px 0 10px"><img src="' + esc(p) + '" style="max-width:100%;height:auto;max-height:240px;border-radius:8px;border:1px solid var(--line,#ddd)"></div>';
        });
      });
    });
    return h;
  }

  function openCrewInsp(id) {
    var r = CREW.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var title = r.inspection_subtype || r.form_type;
    var h = pdfBtn('dl-crewi');
    h += '<div class="sec-h">Details</div>' +
      kv('Form', r.form_type + (r.inspection_subtype ? ' · ' + r.inspection_subtype : '')) +
      (r.asset_id ? kv('Asset', r.asset_id) : '') +
      kv('Site', r.jobsite) +
      kv('Completed by', r.inspector_name + (r.sub_id ? ' · ' + subName(r.sub_id) : '')) +
      kv('Date', fmtDate(r.inspection_date)) +
      (r.submitted_at ? kv('Submitted', tzDateTime(r.submitted_at)) : '') +
      kv('Result', r.has_defects ? r.defect_count + ' defect' +
         (r.defect_count === 1 ? '' : 's') : 'All items passed');
    // Delivery Activity — only for digitally sent forms (records with a sent
    // timestamp). Equipment/QR inspections have no sent_at, so this never shows
    // for them. Values are the record's own existing delivery timestamps.
    if (r.assignment_id) {
      // Shared assignment: sent to several people, ONE completion. Summarize the
      // whole assignment rather than a single recipient.
      h += assignmentDeliveryHtml('inspection', r.assignment_id);
    } else if (r.sent_at) {
      var dStatus = r.submitted_at ? pill('p-ok', 'Submitted')
        : r.opened_at ? pill('p-warn', 'Opened, not submitted')
        : pill('p-grey', 'Sent');
      h += '<div class="sec-h">Delivery Activity</div>' +
        kv('Sent to', r.inspector_name) +
        (r.phone ? kv('Phone', r.phone) : '') +
        kv('Sent', r.sent_at ? fmtWhen(r.sent_at) : 'Not yet') +
        kv('Opened', r.opened_at ? fmtWhen(r.opened_at) : 'Not yet') +
        kv('Submitted', r.submitted_at ? fmtWhen(r.submitted_at) : 'Not yet') +
        '<div class="kv"><span class="k">Status</span><span class="v">' + dStatus + '</span></div>';
    }
    // The real inspection — every item, response, note and photo — from the
    // canonical record. Fetched lazily so the drawer opens instantly.
    h += '<div class="sec-h">Inspection Items</div><div id="crew-doc" class="small muted">Loading inspection…</div>';
    drawer(title, fmtDate(r.inspection_date) + ' · ' + r.jobsite, h);
    post('cs_portal_field_doc', { p_id: r.id }).then(function (d) {
      var box = $('#crew-doc'); if (box) box.innerHTML = docDetailHtml(d && d.doc);
    }).catch(function () {
      var box = $('#crew-doc'); if (box) box.innerHTML = '<div class="small muted">The full record is available in the PDF.</div>';
    });
    $('#dl-crewi').onclick = function () {
      if (r.pdf_path) { openFieldPdf(r.id); return; }   // real stored field-submission PDF
      printRecord(title, fmtDate(r.inspection_date) + ' · ' + r.jobsite + ' · ' +
        r.inspector_name, crewPBody(r));
    };
  }

  /* New inspection: pick a person (or type one in), tick the forms to send,
     and the link goes out by text. Built here rather than under Jobs — the
     job is already on the form when the crew opens the link, and "text Dwight
     the forklift check" is how the request actually arrives. */
  function openNewInspection() {
    var people = (B.people || []).map(function (p) {
      return { name: p.name, phone: p.phone, tag: p.title };
    }).concat((B.subs || []).map(function (s) {
      return { name: s.contact_name, phone: s.contact_phone, tag: s.name };
    }));
    var tpls = (B.templates || []).filter(function (t) {
      return t.family !== 'report' && t.active;   // anything a crew can fill in
    });
    var recips = [];            // {name, phone} — one shared assignment, many links
    var formOn = {};            // ticked forms, preserved across re-render

    function render() {
      var jobOpts = (B.jobs || []).map(function (j) { return '<option value="' + esc(j.id) + '">' + esc(j.name) + '</option>'; }).join('');
      var whoOpts = '<optgroup label="Safety team">' +
        people.slice(0, (B.people || []).length).map(function (p, i) { return '<option value="' + i + '">' + esc(p.name) + ' — ' + esc(p.tag) + '</option>'; }).join('') +
        '</optgroup><optgroup label="Subcontractor contacts">' +
        people.slice((B.people || []).length).map(function (p, i) { return '<option value="' + ((B.people || []).length + i) + '">' + esc(p.name) + ' — ' + esc(p.tag) + '</option>'; }).join('') +
        '</optgroup>';
      var h = '<div class="f"><label for="ni-job">Jobsite <span class="small muted" style="text-transform:none;font-weight:400;letter-spacing:0">· optional</span></label>' +
          '<select id="ni-job"><option value="">—</option>' + jobOpts + '</select></div>' +
        '<div class="f"><label for="ni-who">Send to <span class="small muted" style="text-transform:none;font-weight:400;letter-spacing:0">· any one of them can complete it</span></label>' +
          '<select id="ni-who"><option value="">Pick from contacts…</option>' + whoOpts + '</select>' +
          '<div style="display:flex;gap:6px;margin-top:6px">' +
            '<input id="ni-name" placeholder="Name" style="flex:1">' +
            '<input id="ni-phone" placeholder="317-555-0100" style="flex:1" inputmode="tel">' +
            '<button type="button" class="btn btn-sm" id="ni-add">Add</button></div>' +
          '<div id="ni-recips" style="margin-top:8px">' + (recips.length
            ? recips.map(function (r, i) { return '<span class="photochip" style="margin:0 6px 6px 0">' + esc(r.name || r.phone) +
                (r.phone ? ' · ' + esc(r.phone) : '') + ' <button type="button" data-rmr="' + i + '" style="border:none;background:none;color:var(--fail);cursor:pointer;font-size:14px">×</button></span>'; }).join('')
            : '<span class="small muted">Add one or more recipients.</span>') + '</div></div>' +
        '<div class="f"><label>Which forms</label>' +
          tpls.map(function (t) {
            return '<label class="check"><input type="checkbox" value="' + esc(t.name) + '"' + (formOn[t.name] ? ' checked' : '') + '>' +
              '<span>' + esc(t.name) + '</span>' +
              '<span class="small muted" style="margin-left:auto">' + t.items + ' items</span></label>';
          }).join('') + '</div>' +
        '<p class="err small" id="ni-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
        '<button class="btn btn-gold" id="ni-send" style="width:100%;justify-content:center">Text the link</button>' +
        '<p class="small muted" style="margin-top:.7rem">Each recipient gets their own tracked link to the ' +
        'SAME assignment. Only one submission is needed — the first completes it for the crew.</p>';
      drawer('New inspection', 'Send a form to one or more people', h);
      wire();
    }
    function saveForms() { $$('.drawer .check input').forEach(function (c) { formOn[c.value] = c.checked; }); }
    function wire() {
      $('#ni-who').onchange = function () { var p = people[this.value]; if (p) { $('#ni-name').value = p.name; $('#ni-phone').value = p.phone; } };
      $('#ni-add').onclick = function () {
        saveForms(); var nm = $('#ni-name').value.trim(), ph = $('#ni-phone').value.trim();
        if (!nm && !ph) { $('#ni-err').textContent = 'Enter a name and phone to add.'; return; }
        recips.push({ name: nm || 'Crew', phone: ph }); render();
      };
      $$('[data-rmr]').forEach(function (b) { b.onclick = function () { saveForms(); recips.splice(+b.dataset.rmr, 1); render(); }; });
      $('#ni-send').onclick = function () {
        saveForms();
        var list = recips.slice();
        var nm = $('#ni-name').value.trim(), ph = $('#ni-phone').value.trim();
        if (ph || nm) list.push({ name: nm || 'Crew', phone: ph });
        var picked = tpls.map(function (t) { return t.name; }).filter(function (n) { return formOn[n]; });
        var err = $('#ni-err');
        if (!list.length)   { err.textContent = 'Add at least one recipient.'; return; }
        if (!picked.length) { err.textContent = 'Tick at least one form.'; return; }
        post('cs_portal_send_inspection',
             { p_recipients: list, p_templates: picked, p_job_id: $('#ni-job').value || null })
          .then(function () {
            closeDrawer();
            toast(list.length > 1 ? ('Assignment sent to ' + list.length + ' recipients') : ('Inspection link texted to ' + (list[0].name || list[0].phone)));
            pgInsp();
          })
          .catch(function (e) { err.textContent = e.message; });
      };
    }
    render();
  }

  /* ====================== TRAINING ====================================== */
  /* Internal only, by design: these are the company's own people. A sub's
     crew training lives on the subcontractor record, not here. */
  function certDays(d) { return Math.round((new Date(d + 'T12:00:00') - new Date()) / 86400000); }
  function certsByWorker() {
    var by = {};
    (B.certs || []).forEach(function (c) { (by[c.worker] = by[c.worker] || []).push(c); });
    return by;
  }
  // Training is split two ways: Internal is our own people (their certs live on
  // the company record); Subcontractors is every sub crew's training, grouped by
  // subcontractor and tied to the subcontractor field.
  var trainView = 'internal';
  var trainExtF = { sub: '', status: '' };

  // 90 / 60 / 30-day certification expiration alerts (Tony's explicit ask).
  // The system knows what is expiring; production notification delivery is
  // configured at rollout — the bands here are computed from live cert data.
  function certExpiryHtml() {
    var now = new Date();
    var b = { d90: [], d60: [], d30: [], exp: [] };
    (B.certs || []).forEach(function (c) {
      if (!c.expires) return;
      var days = Math.round((new Date(c.expires) - now) / 86400000);
      if (days < 0) b.exp.push(c);
      else if (days <= 30) b.d30.push(c);
      else if (days <= 60) b.d60.push(c);
      else if (days <= 90) b.d90.push(c);
    });
    function card(label, arr, cls) {
      var names = arr.slice(0, 4).map(function (c) { return esc(c.worker) + ' · ' + esc(c.cert_type); }).join('<br>');
      return '<div class="kpi" style="border-left:3px solid var(--' + cls + ')"><div class="l">' + label + '</div>' +
        '<div class="n">' + arr.length + '</div><div class="s" style="line-height:1.55">' + (names || 'None') + '</div></div>';
    }
    return '<div class="panel" style="margin-bottom:16px"><div class="panel-hd"><div>' +
      '<h3>Certification Expirations</h3><div class="sub">The system tracks what is expiring and can drive 90 / 60 / 30-day notifications. ' +
      '<span class="demo-sample-badge">Alert logic shown live; delivery configured at rollout</span></div></div></div>' +
      '<div class="panel-bd"><div class="cards">' +
        card('90-Day Notice', b.d90, 'warn') + card('60-Day Notice', b.d60, 'warn') +
        card('30-Day Notice', b.d30, 'bad') + card('Expired', b.exp, 'fail') +
      '</div></div></div>';
  }
  function pgTraining() {
    var by = certsByWorker();
    var sc = B.scorecard || [];
    var extCount = 0;
    sc.forEach(function (x) { extCount += (x.sub.crew || []).length; });

    var tabs = [['internal', 'Internal · ' + Object.keys(by).length],
                ['external', 'Subcontractors · ' + extCount]];

    var html = head('Training & Certifications',
      trainView === 'internal'
        ? 'Your own people — the certifications your company holds. Click a person for the full record and PDF.'
        : 'Subcontractor training, broken down by subcontractor. Pick a company to focus in — each sub crew’s certs live on the subcontractor record.',
      trainView === 'internal' ? '<button class="btn btn-gold" id="add-training">Add training</button>' : '');
    html += certExpiryHtml();
    html += subtabs(trainView, tabs, 'tv');
    html += (trainView === 'internal') ? trainingInternalHtml(by) : trainingExternalHtml(sc);
    paint(html);
    wireSubtabs('tv', function (v) { trainView = v; pgTraining(); });

    if (trainView === 'internal') {
      var ab = $('#add-training'); if (ab) ab.onclick = function () { openAddTraining(''); };
      massInit({ label: 'Download selected', run: function (ids) {
        combinedPrint('Training Records', ids.map(function (nm) {
          var pp = (B.people || []).filter(function (x) { return x.name === nm; })[0] || {};
          return { title: 'Training Record — ' + nm, body: personPBody(nm),
            sub: (pp.title || '') + (pp.phone ? ' · ' + pp.phone : '') };
        }) );
      } });
    } else {
      var ss = $('#te-sub'); if (ss) ss.onchange = function () { trainExtF.sub = ss.value; pgTraining(); };
      var st = $('#te-status'); if (st) st.onchange = function () { trainExtF.status = st.value; pgTraining(); };
      $$('[data-emp]').forEach(function (tr) {
        tr.onclick = function () { var p = tr.dataset.emp.split('|'); openEmployee(p[0], p[1]); };
      });
    }
  }

  function trainingInternalHtml(by) {
    var certs = B.certs || [];
    var expired = certs.filter(function (c) { return certDays(c.expires) < 0; }).length;
    var soon    = certs.filter(function (c) { var d = certDays(c.expires); return d >= 0 && d <= 60; }).length;
    var html = '<div class="cards">' +
      kpi(Object.keys(by).length, 'people', 'on the team', 'c-grey') +
      kpi(certs.length, 'certifications', 'on file', 'c-grey') +
      kpi(soon, 'expiring in 60 days', 'renew now', soon ? 'c-warn' : 'c-ok') +
      kpi(expired, 'expired', expired ? 'not qualified for that task' : 'none', expired ? 'c-bad' : 'c-ok') +
      '</div>';
    var rows = Object.keys(by).sort().map(function (name) {
      var list = by[name];
      var p = (B.people || []).filter(function (x) { return x.name === name; })[0] || {};
      var worst = Math.min.apply(null, list.map(function (c) { return certDays(c.expires); }));
      var next = list.slice().sort(function (a, b) {
        return new Date(a.expires) - new Date(b.expires); })[0];
      return '<tr class="click" data-person="' + esc(name) + '">' + selCell(name) +
        '<td><span class="t-main">' + esc(name) + '</span>' +
          '<div class="t-sub num">' + esc(p.phone || '') + '</div></td>' +
        '<td>' + esc(p.title || '—') + '</td>' +
        '<td class="r num">' + list.length + '</td>' +
        '<td>' + esc(next.cert_type) + '<div class="t-sub">' + esc(fmtDate(next.expires)) + '</div></td>' +
        '<td class="r">' + (worst < 0 ? pill('p-bad', 'Expired cert')
          : worst <= 60 ? pill('p-warn', 'Expiring') : pill('p-ok', 'Current')) + '</td></tr>';
    });
    return html + '<div class="panel"><div class="panel-bd flush">' + tableWrap(
      [{ t: '' }, { t: 'Person' }, { t: 'Role' }, { t: 'Certs', r: 1 }, { t: 'Next expiry' },
       { t: 'Status', r: 1 }], rows, 'No certifications on file.') + '</div></div>';
  }

  // Subcontractor training, grouped by subcontractor. Ties to the subcontractor
  // field via the company picker; rows open the same employee record as the Subs tab.
  function trainingExternalHtml(sc) {
    var allEmp = [];
    sc.forEach(function (x) {
      (x.sub.crew || []).forEach(function (emp) { allEmp.push({ sub: x.sub, emp: emp, st: empTrainStatus(emp) }); });
    });
    var expiredN  = allEmp.filter(function (e) { return e.st.k === 'expired'; }).length;
    var expiringN = allEmp.filter(function (e) { return e.st.k === 'expiring'; }).length;
    var noneN     = allEmp.filter(function (e) { return e.st.k === 'none'; }).length;
    var html = '<div class="cards">' +
      kpi(allEmp.length, 'sub employees', 'across ' + sc.length + ' subs', 'c-grey') +
      kpi(expiredN, 'expired training', expiredN ? 'not qualified' : 'none expired', expiredN ? 'c-bad' : 'c-ok') +
      kpi(expiringN, 'expiring in 60 days', 'renew soon', expiringN ? 'c-warn' : 'c-ok') +
      kpi(noneN, 'no training on file', noneN ? 'cannot verify' : 'all documented', noneN ? 'c-bad' : 'c-ok') +
      '</div>';

    var subOpts = sc.map(function (x) {
      return '<option value="' + esc(x.sub.id) + '"' + (trainExtF.sub === x.sub.id ? ' selected' : '') + '>' + esc(x.sub.name) + '</option>'; }).join('');
    var stOpts = [['', 'All training'], ['expired', 'Expired'], ['expiring', 'Expiring 60d'], ['none', 'No training'], ['ok', 'Current']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (trainExtF.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    html += '<div class="fbar">' +
      '<select id="te-sub"><option value="">All subcontractors</option>' + subOpts + '</select>' +
      '<select id="te-status">' + stOpts + '</select></div>';

    var shown = 0;
    sc.forEach(function (x) {
      if (trainExtF.sub && x.sub.id !== trainExtF.sub) return;
      var crew = (x.sub.crew || []).filter(function (emp) {
        if (trainExtF.status && empTrainStatus(emp).k !== trainExtF.status) return false;
        return true;
      });
      if (!crew.length) return;
      shown += crew.length;
      var rows = crew.map(function (emp) {
        var st = empTrainStatus(emp);
        var certTxt = (emp.certs || []).length
          ? (emp.certs.map(function (c) { return c.t; }).join(', ')) : '—';
        var next = (emp.certs || []).slice().sort(function (a, b) { return new Date(a.exp) - new Date(b.exp); })[0];
        return '<tr data-emp="' + esc(x.sub.id) + '|' + esc(emp.name) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(emp.name) + '</span><div class="t-sub">' + esc(emp.role) + '</div></td>' +
          '<td>' + esc(certTxt) + '</td>' +
          '<td>' + (next ? esc(fmtDate(next.exp)) : '—') + '</td>' +
          '<td class="r">' + pill(st.cls, st.label) + '</td></tr>';
      });
      html += '<div class="panel"><div class="panel-hd"><div><h3>' + esc(x.sub.name) + '</h3>' +
        '<div class="sub">' + esc(x.sub.trade) + ' · ' + crew.length + ' on crew</div></div>' +
        (x.cleared ? '' : pill('p-bad', 'Company not cleared')) + '</div>' +
        '<div class="panel-bd flush">' + tableWrap(
        [{ t: 'Employee' }, { t: 'Training' }, { t: 'Next expiry' }, { t: 'Status', r: 1 }],
        rows, 'No employees.') + '</div></div>';
    });
    if (!shown) html += '<div class="empty">No subcontractor employees match your filter.</div>';
    return html;
  }

  /* Add training — demo-contractor style: type a worker, tap the certs they earned, each
     gets its own issued / expires dates, submit. Adds to the roster this session. */
  var TRAIN_TYPES = ['OSHA 10', 'OSHA 30', 'First Aid / CPR', 'Fall Protection',
    'Forklift Operator', 'Aerial / Scissor Lift', 'Excavation Competent Person',
    'Confined Space', 'Hot Work', 'Rigging & Signal Person'];
  function trainYears(t) {
    if (/OSHA (10|30)/.test(t)) return 5;
    if (/First Aid|Fall Protection|Rigging/.test(t)) return 2;
    if (/Confined Space|Hot Work/.test(t)) return 1;
    return 3;
  }
  function addYears(iso, n) {
    var dt = new Date(iso + 'T12:00:00'); dt.setFullYear(dt.getFullYear() + n);
    return dt.toISOString().slice(0, 10);
  }
  function openAddTraining(preName) {
    var picks = [];
    var nameVal = preName || '';
    var today = new Date().toISOString().slice(0, 10);
    var names = (B.people || []).map(function (p) { return p.name; });

    function render() {
      var h = '<div class="f"><label for="at-name">Worker name</label>' +
        '<input list="at-people" id="at-name" autocomplete="off" value="' + esc(nameVal) + '" placeholder="Name"></div>' +
        '<datalist id="at-people">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
        '<div class="sec-h">Training — tap to add, each gets its own dates</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">' +
          TRAIN_TYPES.map(function (t) { return '<button type="button" class="btn btn-sm" data-addt="' + esc(t) + '">+ ' + esc(t) + '</button>'; }).join('') +
          '<button type="button" class="btn btn-sm" data-addt="__other">+ Other…</button>' +
        '</div>';
      h += '<div id="at-list">' + (picks.length ? picks.map(function (p, i) {
        return '<div class="panel" style="margin:0 0 8px"><div class="panel-bd">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
            (p.custom
              ? '<input class="at-tname" data-i="' + i + '" value="' + esc(p.type) + '" placeholder="Training name" style="flex:1;font-weight:600;padding:6px 8px;border:1px solid var(--line);border-radius:6px">'
              : '<div style="flex:1;font-weight:600">' + esc(p.type) + '</div>') +
            '<button type="button" class="linklike" data-rmt="' + i + '" style="color:var(--fail);font-size:18px;line-height:1">×</button>' +
          '</div>' +
          '<div style="display:flex;gap:8px">' +
            '<div style="flex:1"><label class="small muted" style="display:block;margin-bottom:2px">Issued</label>' +
              '<input type="date" class="at-iss" data-i="' + i + '" value="' + esc(p.issued) + '" style="width:100%"></div>' +
            '<div style="flex:1"><label class="small muted" style="display:block;margin-bottom:2px">Expires</label>' +
              '<input type="date" class="at-exp" data-i="' + i + '" value="' + esc(p.expires) + '" style="width:100%"></div>' +
          '</div></div></div>';
      }).join('') : '<div class="small muted">Tap a training above to add it.</div>') + '</div>';
      h += '<p class="small" id="at-err" style="color:var(--fail);min-height:1em;margin:.4rem 0 .6rem"></p>' +
        '<button type="button" class="btn btn-gold" id="at-submit" style="width:100%;justify-content:center">Submit training</button>';
      drawer('Add training', 'Log certifications for a worker', h);
      wire();
    }
    function wire() {
      var ni = $('#at-name'); if (ni) ni.oninput = function () { nameVal = ni.value; };
      $$('[data-addt]').forEach(function (b) {
        b.onclick = function () {
          var t = b.dataset.addt;
          if (t === '__other') picks.push({ type: '', custom: true, issued: today, expires: addYears(today, 3) });
          else picks.push({ type: t, issued: today, expires: addYears(today, trainYears(t)) });
          render();
        };
      });
      $$('.at-tname').forEach(function (e) { e.oninput = function () { picks[+e.dataset.i].type = e.value; }; });
      $$('.at-iss').forEach(function (e) { e.onchange = function () { picks[+e.dataset.i].issued = e.value; }; });
      $$('.at-exp').forEach(function (e) { e.onchange = function () { picks[+e.dataset.i].expires = e.value; }; });
      $$('[data-rmt]').forEach(function (b) { b.onclick = function () { picks.splice(+b.dataset.rmt, 1); render(); }; });
      var sub = $('#at-submit');
      if (sub) sub.onclick = function () {
        var err = $('#at-err');
        if (!nameVal.trim()) { err.textContent = 'Enter the worker’s name.'; return; }
        if (!picks.length) { err.textContent = 'Add at least one training.'; return; }
        if (picks.some(function (p) { return !p.type.trim(); })) { err.textContent = 'Every training needs a name.'; return; }
        if (!B.certs) B.certs = [];
        var pp = (B.people || []).filter(function (x) { return x.name === nameVal.trim(); })[0];
        picks.forEach(function (p, i) {
          B.certs.push({ id: 'ic_new_' + Date.now() + '_' + i, worker: nameVal.trim(),
            worker_id: pp ? pp.id : null, cert_type: p.type.trim(), issued: p.issued, expires: p.expires });
        });
        closeDrawer();
        toast(picks.length + ' training record' + (picks.length === 1 ? '' : 's') + ' added for ' + nameVal.trim() + '.');
        pgTraining();
      };
    }
    render();
  }

  function openPerson(name) {
    docReg = [];
    var list = (certsByWorker()[name] || []).slice()
      .sort(function (a, b) { return new Date(a.expires) - new Date(b.expires); });
    var p = (B.people || []).filter(function (x) { return x.name === name; })[0] || {};
    var wc = { kind: 'internal', workerId: p.id, workerName: name,
      reopen: function () { pgTraining(); openPerson(name); } };
    var h = pdfBtn('dl-person');
    h += '<div class="sec-h">Contact</div>' +
      kv('Role', p.title || '—') + kv('Phone', p.phone || '—');
    h += '<div class="sec-h">Training &amp; Certifications</div>';
    h += '<div style="margin-bottom:10px"><button class="btn btn-sm" id="p-addtrain">+ Add training / certification</button></div>';
    if (!list.length) {
      h += '<div class="small muted">None on file.</div>';
    } else {
      var rows = list.map(function (c) {
        var d = c.expires ? certDays(c.expires) : null;
        var stcell = c.expires == null ? pill('p-ok', 'No expiry')
          : d < 0 ? pill('p-bad', 'Expired')
          : d <= 60 ? pill('p-warn', 'Expiring ' + d + 'd')
          : pill('p-ok', 'Current');
        return '<tr><td><span class="t-main">' + esc(c.cert_type) + '</span></td>' +
          '<td>' + esc(fmtDate(c.issued)) + '</td>' +
          '<td>' + esc(fmtDate(c.expires)) + '</td>' +
          '<td>' + stcell + '</td>' +
          '<td>' + docCell(c.doc, 'Missing') + '</td>' +
          '<td class="r"><button class="linklike" data-editicert="' + esc(c.id) + '">Edit</button></td></tr>';
      });
      h += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
        [{ t: 'Certification' }, { t: 'Completed' }, { t: 'Expires' }, { t: 'Status' }, { t: 'Document' }, { t: '', r: 1 }],
        rows) + '</div></div>';
    }
    h += otherPdfsHtml(p.id);
    drawer(name, (p.title || '') + (p.phone ? ' · ' + p.phone : ''), h);
    var pat = $('#p-addtrain'); if (pat) pat.onclick = function () { openCertForm(wc, null); };
    $$('[data-editicert]').forEach(function (b) {
      b.onclick = function () {
        var c = (certsByWorker()[name] || []).filter(function (x) { return x.id === b.dataset.editicert; })[0];
        if (c) openCertForm(wc, { id: c.id, cert: c });
      };
    });
    wireOtherPdfs(wc);
    wireDocLinks();
    $('#dl-person').onclick = function () {
      printRecord('Training Record — ' + name, (p.title || '') +
        (p.phone ? ' · ' + p.phone : ''), personPBody(name));
    };
  }

  /* ====================== JOBS ========================================== */
  var jobsTab = 'active';
  function pgJobs() {
    var archived = jobsTab === 'archive';
    var all = (B.jobs || []);
    var activeN = all.filter(function (j) { return !j.archived; }).length;
    var archN = all.filter(function (j) { return j.archived; }).length;
    var right = subtabs(jobsTab, [['active', 'Active jobs · ' + activeN], ['archive', 'Archive · ' + archN]], 'jt') +
      (archived ? '' : ' <button class="btn btn-gold" id="new-job" style="margin-left:10px">Add job</button>');

    var html = head('Jobs',
      archived
        ? 'Closed and past jobsites. Everything filed against them is kept — reopen one to move it back to Active.'
        : 'Active jobsites. Click one for its people, subs and everything filed against it. Close a job to move it to the Archive.',
      right);

    var qKey = archived ? 'jobsArch' : 'jobsActive';
    var q = (subQ[qKey] || '').toLowerCase();
    html += fbarSearch(archived ? 'jobarch-q' : 'jobact-q', subQ[qKey], archived ? 'Search archived jobs…' : 'Search jobs…');

    var list = all.filter(function (j) { return !!j.archived === archived; })
      .filter(function (j) {
        return has((j.name || '') + ' ' + (j.job_number || '') + ' ' + (j.address || '') + ' ' +
          (j.foreman_name || '') + ' ' + (j.pm_name || ''), q); });

    var rows = list.map(function (j) {
      var subsOn = (B.scorecard || []).filter(function (x) {
        return x.sub.jobs.indexOf(j.id) !== -1; });
      var blocked = subsOn.filter(function (x) { return !x.cleared; }).length;
      return '<tr class="click" data-job="' + esc(j.id) + '">' +
        '<td><span class="t-main">' + esc(j.name) + '</span>' +
          '<div class="t-sub">' + esc(j.address) + '</div></td>' +
        '<td class="num">' + esc(j.job_number) + '</td>' +
        '<td>' + esc(fmtDate(j.start_date)) + '</td>' +
        '<td>' + esc(j.foreman_name || '—') +
          (j.foreman_phone ? '<div class="t-sub">' + esc(j.foreman_phone) + '</div>' : '') + '</td>' +
        '<td>' + esc(j.pm_name || '—') + '</td>' +
        '<td class="r"><span class="t-main">' + subsOn.length + ' sub' + (subsOn.length === 1 ? '' : 's') + '</span>' +
          (blocked ? '<div class="t-sub c-bad">' + blocked + ' not cleared</div>' : '') + '</td>' +
        '<td class="r">' + (archived
          ? pill('p-grey', 'Closed' + (j.closed_date ? ' · ' + fmtDate(j.closed_date) : ''))
          : pill('p-ok', 'Active')) + '</td>' +
        '<td class="r"><button class="btn btn-sm" data-' + (archived ? 'jobreopen' : 'jobclose') +
          '="' + esc(j.id) + '">' + (archived ? 'Reopen' : 'Close job') + '</button></td></tr>';
    });
    html += '<div class="panel"><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Site' }, { t: 'Number' }, { t: 'Started' }, { t: 'Superintendent' },
       { t: 'Project manager' }, { t: 'Subs', r: 1 }, { t: 'Status', r: 1 }, { t: '', r: 1 }], rows,
      archived ? 'No archived jobs.' : 'No active jobs match your search.') +
      '</div></div>';
    paint(html);
    wireSubtabs('jt', function (v) { jobsTab = v; pgJobs(); });
    wireSearch(archived ? 'jobarch-q' : 'jobact-q', function (v) { subQ[qKey] = v; pgJobs(); });
    var nb = $('#new-job');
    if (nb) nb.onclick = openNewJob;
    $$('[data-jobclose]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation();
      var j = (B.jobs || []).filter(function (x) { return x.id === b.dataset.jobclose; })[0];
      if (j && confirm('Close “' + j.name + '”? It moves to the Archive; nothing filed against it is deleted.')) {
        j.archived = true; j.closed_date = new Date().toISOString().slice(0, 10);
        toast('Job closed and archived.'); pgJobs();
      } }; });
    $$('[data-jobreopen]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation();
      var j = (B.jobs || []).filter(function (x) { return x.id === b.dataset.jobreopen; })[0];
      if (j) { j.archived = false; toast('Job reopened.'); pgJobs(); } }; });
  }

  function openNewJob() {
    var h = '<div class="f"><label for="nj-name">Job name</label>' +
      '<input type="text" id="nj-name" placeholder="Riverside Medical Pavilion"></div>' +
      '<div class="f"><label for="nj-num">Job number</label>' +
      '<input type="text" id="nj-num" placeholder="M-2447"></div>' +
      '<div class="f"><label for="nj-addr">Address</label>' +
      '<input type="text" id="nj-addr" placeholder="Street, city"></div>' +
      '<div class="f"><label for="nj-fore">Superintendent</label>' +
      '<input type="text" id="nj-fore" placeholder="Name"></div>' +
      '<div class="f"><label for="nj-phone">Superintendent phone</label>' +
      '<input type="tel" id="nj-phone" placeholder="317-555-0100"></div>' +
      '<div class="f"><label for="nj-pm">Project manager</label>' +
      '<input type="text" id="nj-pm" placeholder="Name"></div>' +
      '<p class="small" id="nj-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
      '<button class="btn btn-gold" id="nj-save" style="width:100%;justify-content:center">Add job</button>';
    drawer('Add job', 'Subcontractors are added from the job once it exists', h);
    $('#nj-save').onclick = function () {
      var name = $('#nj-name').value.trim();
      if (!name) { $('#nj-err').textContent = 'The job needs a name.'; return; }
      post('cs_portal_add_job', {
        p_name: name, p_job_number: $('#nj-num').value.trim(),
        p_address: $('#nj-addr').value.trim(),
        p_foreman_name: $('#nj-fore').value.trim(),
        p_foreman_phone: $('#nj-phone').value.trim(),
        p_pm_name: $('#nj-pm').value.trim()
      }).then(function () {
        closeDrawer(); toast('Job added');
        refreshBundle().then(pgJobs);
      }).catch(function (e) { $('#nj-err').textContent = e.message; });
    };
  }

  // Full-screen job view — everything filed against one jobsite in one place.
  function jobSection(title, sub, cols, rows, empty, right) {
    return '<div class="panel"><div class="panel-hd"><div><h3>' + esc(title) + '</h3>' +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' + (right || '') + '</div>' +
      '<div class="panel-bd flush">' + tableWrap(cols, rows, empty) + '</div></div>';
  }
  // PDF-body builders for the job-page download buttons (reports/crew reuse the
  // existing ones).
  function permitPBody(p) {
    var a = permitAssessment(p);
    return '<div class="sec">Permit</div>' +
      '<div class="row"><span>Type</span><span>' + esc(permitLabel(p.type)) + '</span></div>' +
      '<div class="row"><span>Location</span><span>' + esc(p.location) + '</span></div>' +
      '<div class="row"><span>Status</span><span>' + esc(p.status) + '</span></div>' +
      '<div class="row"><span>Workers</span><span>' + esc((p.workers || []).join(', ')) + '</span></div>' +
      '<div class="sec">Risk assessment</div>' +
      a.map(function (x) { return '<div class="row"><span>' + esc(x.label) + '</span><span class="chip ' + (x.checked ? 'ok">DONE' : 'na">—') + '</span></div>'; }).join('') +
      '<div class="sec">Authorisation</div>' +
      '<div class="row"><span>Requested by</span><span>' + esc(p.requested_by || '—') + '</span></div>' +
      '<div class="row"><span>Approved by</span><span>' + esc(p.approved_by || 'Not approved') + '</span></div>';
  }
  function regPBody(v) {
    var s = '<div class="sec">Visit</div>' +
      '<div class="row"><span>Agency</span><span>' + esc(v.agency) + '</span></div>' +
      '<div class="row"><span>Inspector</span><span>' + esc(v.inspector) + '</span></div>' +
      '<div class="row"><span>Date</span><span>' + esc(fmtDate(v.date)) + '</span></div>' +
      '<div class="row"><span>Reason</span><span>' + esc(v.reason || '—') + '</span></div>';
    if ((v.citations || []).length) s += '<div class="sec">Citations</div>' + v.citations.map(function (ct) {
      return '<div class="row"><span>' + esc(ct.standard) + ' — ' + esc(ct.description) + '</span><span>$' + ct.penalty.toLocaleString() + '</span></div>'; }).join('');
    if ((v.abatement || []).length) s += '<div class="sec">Abatement</div>' + v.abatement.map(function (ab) {
      return '<div class="row"><span>' + esc(ab.action) + '</span><span class="chip ' + (ab.status === 'open' ? 'bad">OPEN' : 'ok">CLOSED') + '</span></div>'; }).join('');
    return s;
  }
  function incidentPBody(i) {
    return '<div class="sec">Incident</div>' +
      '<div class="row"><span>Classification</span><span>' + esc(CLASS[i.classification]) + '</span></div>' +
      '<div class="row"><span>Date</span><span>' + esc(fmtDate(i.date)) + ' ' + esc(i.time || '') + '</span></div>' +
      '<div class="row"><span>Site</span><span>' + esc(jobName(i.job_id)) + '</span></div>' +
      (i.injured ? '<div class="row"><span>Injured</span><span>' + esc(i.injured) + '</span></div>' : '') +
      '<div class="sec">What happened</div><div class="row"><span>' + esc(i.description) + '</span></div>' +
      (i.immediate_action ? '<div class="sec">Immediate action</div><div class="row"><span>' + esc(i.immediate_action) + '</span></div>' : '') +
      (i.root_cause ? '<div class="sec">Root cause</div><div class="row"><span>' + esc(i.root_cause) + '</span></div>' : '') +
      ((i.corrective || []).length ? '<div class="sec">Corrective actions</div>' + i.corrective.map(function (c) {
        return '<div class="row"><span>' + esc(c.action) + '</span><span class="chip ' + (c.status === 'closed' ? 'ok">CLOSED' : 'bad">OPEN') + '</span></div>'; }).join('') : '');
  }
  function downloadJobPdf(kind, rid) {
    if (kind === 'report') { var r = (B.reports || []).filter(function (x) { return x.id === rid; })[0];
      if (r) printRecord('Site Safety Report', repDateDisp(r) + ' · ' + jobName(r.job_id) + ' · ' + r.inspector_name, reportPBody(r)); }
    else if (kind === 'crew') { var c = CREW.filter(function (x) { return x.id === rid; })[0];
      if (c) printRecord(c.inspection_subtype || c.form_type, fmtDate(c.inspection_date) + ' · ' + c.jobsite + ' · ' + c.inspector_name, crewPBody(c)); }
    else if (kind === 'permit') { var p = (B.permits || []).filter(function (x) { return x.id === rid; })[0];
      if (p) printRecord(permitLabel(p.type) + ' Permit', p.location + ' · ' + jobName(p.job_id), permitPBody(p)); }
    else if (kind === 'reg') { var v = (B.reg_visits || []).filter(function (x) { return x.id === rid; })[0];
      if (v) printRecord(v.agency + ' Visit Record', fmtDate(v.date) + ' · ' + jobName(v.job_id), regPBody(v)); }
    else if (kind === 'inc') { var i = (B.incidents || []).filter(function (x) { return x.id === rid; })[0];
      if (i) printRecord(CLASS[i.classification], fmtDate(i.date) + ' · ' + jobName(i.job_id), incidentPBody(i)); }
  }
  function openJob(id) {
    var j = (B.jobs || []).filter(function (x) { return x.id === id; })[0];
    if (!j) return pgJobs();
    var sc = (B.scorecard || []).filter(function (x) { return x.sub.jobs.indexOf(id) !== -1; });
    var reps = (B.reports || []).filter(function (r) { return r.job_id === id; });
    var crew = CREW.filter(function (r) { return r.jobsite === j.name; });
    var perms = (B.permits || []).filter(function (p) { return p.job_id === id; });
    var incs = (B.incidents || []).filter(function (i) { return i.job_id === id; });
    var regs = (B.reg_visits || []).filter(function (v) { return v.job_id === id; });
    var emps = []; sc.forEach(function (x) { (x.sub.crew || []).forEach(function (e) { emps.push({ sub: x.sub, emp: e }); }); });
    var internal = (B.people || []).filter(function (p) { return (p.jobs || []).indexOf(id) !== -1; });
    var internalCrew = (B.internal_crew || []).filter(function (e) { return e.job_id === id; });

    var notCleared = sc.filter(function (x) { return !x.cleared; }).length;
    var openInc = incs.filter(function (i) { return i.status !== 'closed'; }).length;
    var activePerm = perms.filter(function (p) { return p.status === 'active'; }).length;
    var workers = sc.reduce(function (a, x) { return a + x.sub.workers_on_site; }, 0);

    function pdfCell(kind, rid) { return '<td class="r"><button class="btn btn-sm" data-jpdf="' + kind + '|' + esc(rid) + '">PDF</button></td>'; }

    var html = head(j.name, j.job_number + ' · ' + j.address,
      '<div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">' +
        '<button class="btn" id="job-back">&larr; All jobs</button>' +
        '<button class="btn" id="job-edit">Edit job</button>' +
        '<button class="btn" id="job-close">' + (j.archived ? 'Reopen job' : 'Close job') + '</button>' +
        '<button class="btn btn-gold" id="job-dlall">Download all</button></div>');
    html += '<div class="cards">' +
      kpi(sc.length, 'subcontractors', notCleared ? notCleared + ' not cleared' : 'all cleared', notCleared ? 'c-bad' : 'c-ok') +
      kpi(workers, 'workers on site', 'reported across subcontractors', 'c-grey') +
      kpi(reps.length + crew.length, 'reports & inspections', 'filed on this job', 'c-grey') +
      kpi(activePerm, 'active permits', perms.length + ' total', activePerm ? 'c-ok' : 'c-grey') +
      kpi(openInc, 'open incidents', incs.length + ' on record', openInc ? 'c-bad' : 'c-ok') +
      '</div>';

    // Details
    html += '<div class="panel"><div class="panel-bd">' +
      kv('Job number', j.job_number) + kv('Address', j.address) +
      kv('Started', fmtDate(j.start_date)) +
      kv('Superintendent', (j.foreman_name || '—') + (j.foreman_phone ? ' · ' + j.foreman_phone : '')) +
      kv('Project manager', j.pm_name || '—') +
      kv('General contractor', j.gc_name || '—') + '</div></div>';

    // Subcontractors
    html += jobSection('Subcontractors', sc.length + ' on this job',
      [{ t: 'Company' }, { t: 'Trade' }, { t: 'On site', r: 1 }, { t: 'Status', r: 1 }],
      sc.map(function (x) {
        return '<tr data-sub="' + esc(x.sub.id) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(x.sub.name) + '</span></td>' +
          '<td>' + esc(x.sub.trade) + '</td>' +
          '<td class="r num">' + x.sub.workers_on_site + '</td>' +
          '<td class="r">' + (x.cleared ? pill('p-ok', 'Cleared') : pill('p-bad', 'Not cleared')) + '</td></tr>';
      }), 'None assigned yet.');
    var offJob = (B.subs || []).filter(function (s) { return s.jobs.indexOf(id) === -1; });
    if (offJob.length) {
      html += '<div style="display:flex;gap:8px;align-items:center;margin:-6px 0 14px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);box-shadow:var(--shadow)">' +
        '<span class="small muted" style="flex:0 0 auto">Add a sub to this job</span>' +
        '<select id="aj-sub" style="flex:1;max-width:420px">' +
        offJob.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' — ' + esc(s.trade) + '</option>'; }).join('') +
        '</select><button class="btn btn-gold btn-sm" id="aj-add">+ Add subcontractor</button></div>';
    }

    // Employees on site — only individually tracked worker records appear here,
    // distinct from the reported on-site headcount above.
    html += jobSection('Employees on site',
      emps.length + ' individual worker record' + (emps.length === 1 ? '' : 's') +
        ' across ' + sc.length + ' subcontractor' + (sc.length === 1 ? '' : 's'),
      [{ t: 'Employee' }, { t: 'Company' }, { t: 'Role' }, { t: 'Training', r: 1 }],
      emps.map(function (r) {
        var st = empTrainStatus(r.emp);
        return '<tr data-emp="' + esc(r.sub.id) + '|' + esc(r.emp.name) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(r.emp.name) + '</span></td>' +
          '<td>' + esc(r.sub.name) + '</td>' +
          '<td>' + esc(r.emp.role) + '</td>' +
          '<td class="r">' + pill(st.cls, st.label) + '</td></tr>';
      }), 'No employees on the roster yet.',
      sc.length ? '<button class="btn btn-gold btn-sm" id="je-add">+ Add employee</button>' : '');

    // Internal — safety team
    html += jobSection('Safety team', internal.length + ' assigned',
      [{ t: 'Name' }, { t: 'Role' }, { t: 'Phone', r: 1 }],
      internal.map(function (p) {
        return '<tr data-person="' + esc(p.name) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(p.name) + '</span></td>' +
          '<td>' + esc(p.title) + '</td>' +
          '<td class="r num">' + esc(p.phone) + '</td></tr>';
      }), 'No safety team assigned yet.',
      '<button class="btn btn-gold btn-sm" id="js-add">+ Add safety staff</button>');

    // Internal — on-site employees (the GC's own field crew)
    html += jobSection('Internal employees on site', internalCrew.length + ' on this job',
      [{ t: 'Employee' }, { t: 'Role' }, { t: 'Training', r: 1 }],
      internalCrew.map(function (e) {
        var st = empTrainStatus(e);
        return '<tr data-ice="' + esc(e.name) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(e.name) + '</span></td>' +
          '<td>' + esc(e.role) + '</td>' +
          '<td class="r">' + pill(st.cls, st.label) + '</td></tr>';
      }), 'No internal employees on this job yet.',
      '<button class="btn btn-gold btn-sm" id="ice-add">+ Add employee</button>');

    // Safety reports
    html += jobSection('Safety reports', reps.length + ' filed',
      [{ t: 'Date' }, { t: 'Inspector' }, { t: 'Result', r: 1 }, { t: '', r: 1 }],
      reps.map(function (r) {
        return '<tr data-report="' + esc(r.id) + '" style="cursor:pointer">' +
          '<td>' + esc(repDateDisp(r)) +
            (r.submitted_at ? '<div class="t-sub">' + esc(tzTime(r.submitted_at)) + '</div>' : '') + '</td>' +
          '<td>' + esc(r.inspector_name) + '</td>' +
          '<td class="r">' + (r.defect_count ? pill('p-warn', r.defect_count + ' flagged') : pill('p-ok', 'Clear')) + '</td>' +
          pdfCell('report', r.id) + '</tr>';
      }), 'No reports on this job yet.');

    // Crew inspections
    html += jobSection('Crew inspections', crew.length + ' submitted',
      [{ t: 'Form' }, { t: 'By' }, { t: 'Date' }, { t: 'Result', r: 1 }, { t: '', r: 1 }],
      crew.map(function (r) {
        return '<tr data-crewi="' + esc(r.id) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(r.inspection_subtype || r.form_type) + '</span></td>' +
          '<td>' + esc(r.inspector_name) + '</td>' +
          '<td>' + esc(fmtDate(r.inspection_date)) + '</td>' +
          '<td class="r">' + (r.has_defects ? pill('p-bad', r.defect_count + ' defect' + (r.defect_count === 1 ? '' : 's')) : pill('p-ok', 'Clear')) + '</td>' +
          pdfCell('crew', r.id) + '</tr>';
      }), 'No crew inspections yet.');

    // Permits (internal + external)
    html += jobSection('Permits', perms.length + ' on this job',
      [{ t: 'Permit' }, { t: 'Pulled by' }, { t: 'Location' }, { t: 'Status', r: 1 }, { t: '', r: 1 }],
      perms.map(function (p) {
        var ext = p.sub_id ? subName(p.sub_id) : 'Internal crew';
        var st = p.status === 'active' ? pill('p-ok', 'Active') : p.status === 'pending' ? pill('p-warn', 'Pending')
          : p.status === 'denied' ? pill('p-bad', 'Denied') : pill('p-grey', p.status);
        return '<tr data-permit="' + esc(p.id) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(permitLabel(p.type)) + '</span></td>' +
          '<td>' + esc(ext) + '<div class="t-sub">' + (p.sub_id ? 'External' : 'Internal') + '</div></td>' +
          '<td>' + esc(p.location) + '</td>' +
          '<td class="r">' + st + '</td>' + pdfCell('permit', p.id) + '</tr>';
      }), 'No permits on this job.');

    // Regulatory & Visits
    if (regs.length) html += jobSection('Regulatory & Visits', regs.length + ' on record',
      [{ t: 'Agency' }, { t: 'Inspector' }, { t: 'Date' }, { t: 'Status', r: 1 }, { t: '', r: 1 }],
      regs.map(function (v) {
        var st = v.status === 'closed' ? pill('p-ok', 'Closed')
          : v.status === 'abatement' ? pill('p-warn', 'Abatement open') : pill('p-warn', 'Open');
        return '<tr data-reg="' + esc(v.id) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(v.agency) + '</span></td>' +
          '<td>' + esc(v.inspector) + '</td>' +
          '<td>' + esc(fmtDate(v.date)) + '</td>' +
          '<td class="r">' + st + '</td>' + pdfCell('reg', v.id) + '</tr>';
      }), '');

    // Incidents
    html += jobSection('Incidents', incs.length + ' on record',
      [{ t: 'Type' }, { t: 'Date' }, { t: 'Injured' }, { t: 'Status', r: 1 }, { t: '', r: 1 }],
      incs.map(function (i) {
        return '<tr data-inc="' + esc(i.id) + '" style="cursor:pointer">' +
          '<td><span class="t-main">' + esc(CLASS[i.classification]) + '</span></td>' +
          '<td>' + esc(fmtDate(i.date)) + '</td>' +
          '<td>' + esc(i.injured || '—') + '</td>' +
          '<td class="r">' + (i.status === 'closed' ? pill('p-ok', 'Closed') : pill('p-warn', 'Investigating')) + '</td>' +
          pdfCell('inc', i.id) + '</tr>';
      }), 'No incidents on this job.');

    paint(html);
    var back = $('#job-back'); if (back) back.onclick = pgJobs;
    var ej = $('#job-edit'); if (ej) ej.onclick = function () { openEditJob(id); };
    var jc = $('#job-close'); if (jc) jc.onclick = function () {
      if (j.archived) { j.archived = false; toast('Job reopened.'); jobsTab = 'active'; pgJobs(); return; }
      if (confirm('Close “' + j.name + '”? It moves to the Archive; nothing filed against it is deleted.')) {
        j.archived = true; j.closed_date = new Date().toISOString().slice(0, 10);
        toast('Job closed and archived.'); jobsTab = 'archive'; pgJobs();
      }
    };
    var da = $('#job-dlall'); if (da) da.onclick = function () { downloadJobAll(id); };
    var je = $('#je-add'); if (je) je.onclick = function () { openAddJobEmployee(id); };
    var js = $('#js-add'); if (js) js.onclick = function () { openAddJobStaff(id); };
    var ic = $('#ice-add'); if (ic) ic.onclick = function () { openAddInternalEmployee(id); };
    $$('[data-ice]').forEach(function (tr) { tr.onclick = function () { openInternalEmp(id, tr.dataset.ice); }; });
    $$('[data-emp]').forEach(function (tr) {
      tr.onclick = function () { var p = tr.dataset.emp.split('|'); openEmployee(p[0], p[1]); };
    });
    $$('[data-reg]').forEach(function (tr) { tr.onclick = function () { openRegVisit(tr.dataset.reg); }; });
    $$('[data-jpdf]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); var p = b.dataset.jpdf.split('|'); downloadJobPdf(p[0], p[1]); };
    });
    var ab = $('#aj-add');
    if (ab) ab.onclick = function () {
      post('cs_portal_job_add_sub', { p_job_id: id, p_sub_id: $('#aj-sub').value })
        .then(function () { toast('Subcontractor added to ' + j.name); return refreshBundle(); })
        .then(function () { openJob(id); })
        .catch(function (e) { toast(e.message); });
    };
  }

  // One combined PDF of everything filed against the job.
  function downloadJobAll(id) {
    var j = (B.jobs || []).filter(function (x) { return x.id === id; })[0]; if (!j) return;
    var parts = [];
    (B.reports || []).filter(function (r) { return r.job_id === id; }).forEach(function (r) {
      parts.push({ title: 'Site Safety Report', sub: repDateDisp(r) + ' · ' + r.inspector_name, body: reportPBody(r) }); });
    CREW.filter(function (r) { return r.jobsite === j.name; }).forEach(function (r) {
      parts.push({ title: r.inspection_subtype || r.form_type, sub: fmtDate(r.inspection_date) + ' · ' + r.inspector_name, body: crewPBody(r) }); });
    (B.permits || []).filter(function (p) { return p.job_id === id; }).forEach(function (p) {
      parts.push({ title: permitLabel(p.type) + ' Permit', sub: p.location, body: permitPBody(p) }); });
    (B.reg_visits || []).filter(function (v) { return v.job_id === id; }).forEach(function (v) {
      parts.push({ title: v.agency + ' Visit', sub: fmtDate(v.date), body: regPBody(v) }); });
    (B.incidents || []).filter(function (i) { return i.job_id === id; }).forEach(function (i) {
      parts.push({ title: CLASS[i.classification], sub: fmtDate(i.date), body: incidentPBody(i) }); });
    if (!parts.length) { toast('Nothing to download on this job yet.'); return; }
    combinedPrint('Job Package — ' + j.name + ' · ' + j.job_number, parts);
  }

  // Edit the job's core details, in place.
  function openEditJob(id) {
    var j = (B.jobs || []).filter(function (x) { return x.id === id; })[0]; if (!j) return;
    function fld(lbl, key, ph) { return '<div class="f"><label>' + esc(lbl) + '</label>' +
      '<input id="ej-' + key + '" type="text" value="' + esc(j[key] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></div>'; }
    var h = fld('Job name', 'name') + fld('Job number', 'job_number') + fld('Address', 'address') +
      '<div class="f"><label>Started</label><input id="ej-start_date" type="date" value="' + esc(j.start_date || '') + '"></div>' +
      fld('Superintendent', 'foreman_name') + fld('Superintendent phone', 'foreman_phone') +
      fld('Project manager', 'pm_name') + fld('General contractor', 'gc_name') +
      '<button class="btn btn-gold" id="ej-save" style="width:100%;justify-content:center">Save job</button>';
    drawer('Edit job', j.job_number, h);
    $('#ej-save').onclick = function () {
      ['name', 'job_number', 'address', 'start_date', 'foreman_name', 'foreman_phone', 'pm_name', 'gc_name'].forEach(function (k) {
        var e = $('#ej-' + k); if (e) j[k] = e.value.trim();
      });
      closeDrawer(); toast('Job updated.'); openJob(id);
    };
  }

  // Add a subcontractor employee to a sub on this job.
  function openAddJobEmployee(id) {
    var subsOn = (B.scorecard || []).filter(function (x) { return x.sub.jobs.indexOf(id) !== -1; }).map(function (x) { return x.sub; });
    if (!subsOn.length) { toast('Add a subcontractor to the job first.'); return; }
    var h = '<div class="f"><label for="ae-sub">Company</label><select id="ae-sub">' +
      subsOn.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="f"><label for="ae-name">Employee name</label><input type="text" id="ae-name" autocomplete="off"></div>' +
      '<div class="f"><label for="ae-role">Role / trade</label><input type="text" id="ae-role" placeholder="e.g. Journeyman Electrician"></div>' +
      '<p class="small" id="ae-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
      '<button class="btn btn-gold" id="ae-save" style="width:100%;justify-content:center">Add employee</button>';
    drawer('Add employee on site', 'Onto a subcontractor crew', h);
    $('#ae-save').onclick = function () {
      var name = $('#ae-name').value.trim();
      if (!name) { $('#ae-err').textContent = 'Enter the employee name.'; return; }
      var s = (B.subs || []).filter(function (x) { return x.id === $('#ae-sub').value; })[0];
      if (s) { s.crew = s.crew || []; s.crew.push({ name: name, role: $('#ae-role').value.trim() || 'Crew', certs: [], insp: [] }); }
      closeDrawer(); toast('Employee added to ' + (s ? s.name : 'crew') + '.'); openJob(id);
    };
  }

  // Assign internal staff to this job (or add a new person).
  function openAddJobStaff(id) {
    var off = (B.people || []).filter(function (p) { return (p.jobs || []).indexOf(id) === -1; });
    var h = '<div class="f"><label for="as-who">Assign existing staff</label><select id="as-who">' +
      '<option value="">— add a new person below —</option>' +
      off.map(function (p, i) { return '<option value="' + i + '">' + esc(p.name) + ' — ' + esc(p.title) + '</option>'; }).join('') + '</select></div>' +
      '<div class="f"><label for="as-name">New person name</label><input type="text" id="as-name" autocomplete="off"></div>' +
      '<div class="f"><label for="as-title">Role</label><input type="text" id="as-title" placeholder="e.g. Superintendent"></div>' +
      '<div class="f"><label for="as-phone">Phone</label><input type="text" id="as-phone" placeholder="317-555-0100"></div>' +
      '<p class="small" id="as-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
      '<button class="btn btn-gold" id="as-save" style="width:100%;justify-content:center">Add to job</button>';
    drawer('Add internal staff', 'Assign your own people to this job', h);
    $('#as-save').onclick = function () {
      var sel = $('#as-who').value, err = $('#as-err');
      if (sel !== '') {
        var p = off[+sel]; p.jobs = p.jobs || []; if (p.jobs.indexOf(id) === -1) p.jobs.push(id);
        closeDrawer(); toast(p.name + ' assigned to the job.'); openJob(id); return;
      }
      var name = $('#as-name').value.trim();
      if (!name) { err.textContent = 'Pick someone or enter a new person.'; return; }
      (B.people || (B.people = [])).push({ name: name, title: $('#as-title').value.trim() || 'Staff',
        phone: $('#as-phone').value.trim() || '', jobs: [id], oriented: null, orient_expires: null, certs: [] });
      closeDrawer(); toast(name + ' added to the job.'); openJob(id);
    };
  }

  // Add one of the GC's own on-site employees to this job.
  function openAddInternalEmployee(id) {
    var h = '<div class="f"><label for="ic-name">Employee name</label><input type="text" id="ic-name" autocomplete="off"></div>' +
      '<div class="f"><label for="ic-role">Role / trade</label><input type="text" id="ic-role" placeholder="e.g. Carpenter"></div>' +
      '<p class="small" id="ic-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
      '<button class="btn btn-gold" id="ic-save" style="width:100%;justify-content:center">Add employee</button>';
    drawer('Add internal employee', 'Your own on-site crew', h);
    $('#ic-save').onclick = function () {
      var name = $('#ic-name').value.trim();
      if (!name) { $('#ic-err').textContent = 'Enter the employee name.'; return; }
      (B.internal_crew || (B.internal_crew = [])).push({ job_id: id, name: name,
        role: $('#ic-role').value.trim() || 'Crew', certs: [], insp: [] });
      closeDrawer(); toast(name + ' added to the job.'); openJob(id);
    };
  }

  // One internal on-site employee: training + the JHAs they submitted.
  function openInternalEmp(jobId, name) {
    var e = (B.internal_crew || []).filter(function (x) { return x.job_id === jobId && x.name === name; })[0];
    if (!e) return;
    var st = empTrainStatus(e);
    var h = '';
    if (st.k === 'expired' || st.k === 'none')
      h += '<div class="alert"><strong>' + (st.k === 'none' ? 'No training on file.' : 'Expired training.') +
        '</strong> Not verified for the task.</div>';
    h += '<div class="sec-h">Employee</div>' +
      kv('Role', e.role) + kv('Assigned job', jobName(jobId)) + kv('Employer', (C.contractor || 'Internal'));
    h += '<div class="sec-h">Training & Certifications</div>';
    if (!(e.certs || []).length) h += '<div class="small" style="color:var(--fail);font-weight:600">Nothing on file.</div>';
    else e.certs.forEach(function (c) {
      var dd = certDays(c.exp);
      var tag = dd < 0 ? '<span style="color:var(--fail);font-weight:700">Expired ' + fmtDate(c.exp) + '</span>'
        : dd <= 60 ? '<span style="color:var(--warn);font-weight:600">Expires ' + fmtDate(c.exp) + ' · ' + dd + 'd</span>'
        : 'Valid to ' + fmtDate(c.exp);
      h += '<div class="kv"><span class="k">' + esc(c.t) + '</span><span class="v" style="font-weight:400;font-size:12px">' + tag + '</span></div>';
    });
    h += '<div class="sec-h">JHAs & inspections submitted</div>';
    if (!(e.insp || []).length) h += '<div class="small muted">None on record.</div>';
    else e.insp.forEach(function (r) {
      h += '<div class="kv"><span class="k">' + esc(r.form) + '<div class="small muted">' + fmtDate(r.date) + '</div></span>' +
        (r.defects ? pill('p-bad', r.defects + ' defect' + (r.defects === 1 ? '' : 's')) : pill('p-ok', 'Clear')) + '</div>';
    });
    drawer(e.name, e.role + ' · ' + (C.contractor || 'Internal'), h);
  }

  /* ====================== TEMPLATES ===================================== */
  /* The form library. Two families because the words mean different things on
     a jobsite: an Observation is what the safety team walks and writes up; an
     Inspection is a check a crew completes on a thing or a task.

     The editor below is a working visual: sections and items can be renamed,
     added, removed and re-typed, and it persists to memory for the session.
     Real template content comes later. */
  var TPL_DRAFT = {};                 // code -> edited copy, session only
  var tplOpen = null;

  function seedSections(t) {
    // Plausible scaffolding so a template opens with something to look at.
    // Replaced wholesale when the real content arrives.
    var out = [];
    for (var s = 0; s < t.sections; s++) {
      var items = [];
      var per = Math.max(1, Math.round(t.items / t.sections));
      for (var i = 0; i < per; i++) {
        items.push({ id: 's' + s + 'i' + i, label: 'Checklist item ' + (i + 1),
                     type: 'yesno', invert: false });
      }
      out.push({ id: 'sec' + s, title: 'Section ' + (s + 1), items: items });
    }
    return out;
  }
  function tplContent(code) {
    return (B.template_content && B.template_content[code]) ||
      (code === 'insp_cjsc' ? (B.cjsc || null) : null);
  }
  function draftFor(code) {
    if (!TPL_DRAFT[code]) {
      var t = (B.templates || []).filter(function (x) { return x.code === code; })[0];
      var real = tplContent(code);   // real Creekside content if we have it
      TPL_DRAFT[code] = { code: t.code, name: t.name, family: t.family, active: t.active,
        sections: real ? JSON.parse(JSON.stringify(real)) : seedSections(t) };
    }
    return TPL_DRAFT[code];
  }

  var TPL_FAMS = [['report', 'Safety Reports'], ['inspection', 'Inspections'],
                  ['equipment', 'Equipment'], ['permit', 'Permit checks'],
                  ['orientation', 'Orientations']];
  var tplFam = 'report';
  var jobOpen = null;                 // selected job on the Jobs subtab
  var jobTplOpen = null;              // inspection code being edited within a job
  var talkTplOpen = null;             // selected toolbox-talk template
  var JOB_TPLS = null;                // job id -> [template codes], session only
  var JOB_TPL_DRAFT = {};             // job id -> { code -> editable per-job copy }
  // A job's copy of a template — starts identical to the master, then diverges
  // as it's edited. Edits here never touch the master or any other job.
  function jobDraftFor(jobId, code) {
    JOB_TPL_DRAFT[jobId] = JOB_TPL_DRAFT[jobId] || {};
    if (!JOB_TPL_DRAFT[jobId][code]) {
      var master = draftFor(code);
      JOB_TPL_DRAFT[jobId][code] = { code: master.code, name: master.name,
        sections: JSON.parse(JSON.stringify(master.sections)) };
    }
    return JOB_TPL_DRAFT[jobId][code];
  }
  function inspTemplates() { return (B.templates || []).filter(function (t) { return t.family === 'inspection'; }); }
  function seedJobTpls() {
    if (JOB_TPLS) return;
    JOB_TPLS = {};
    var all = B.templates || [];
    function fam(f) { return all.filter(function (t) { return t.family === f && t.active !== false; }).map(function (t) { return t.code; }); }
    var reports = fam('report'), insp = fam('inspection'), equip = fam('equipment'), permit = fam('permit');
    (B.jobs || []).forEach(function (j, idx) {
      var pick = [];
      if (reports.length) pick.push(reports[0]);                 // a safety report
      ['insp_cjsc', 'insp_jha', 'insp_daily'].forEach(function (c) { if (insp.indexOf(c) !== -1) pick.push(c); });
      if (equip.length) pick.push(equip[idx % equip.length]);    // a rotating equipment check
      if (permit.length) pick.push(permit[idx % permit.length]); // a rotating permit check
      JOB_TPLS[j.id] = pick.filter(function (c, i, a) { return a.indexOf(c) === i; });
    });
  }
  function pgTemplates() {
    var all = B.templates || [];
    if (tplFam !== 'jobs') {
      var inFam = all.filter(function (t) { return t.family === tplFam; });
      if (!tplOpen || !inFam.some(function (t) { return t.code === tplOpen; })) {
        tplOpen = inFam.length ? inFam[0].code : null;
      }
    }
    var famDesc = {
      report:     'What your safety team walks and writes up.',
      inspection: 'Task and site checks a crew completes in the field.',
      equipment:  'Pre-use checks on a thing with a serial number.',
      permit:     'The pre-entry and pre-task checks behind a permit to work.',
      orientation:'Company and jobsite safety orientations workers complete before working.',
      talks:      'Prepared toolbox talks your foremen run with the crew.',
      jobs:       'Every jobsite runs a different set of inspections — set them per job here.'
    };
    var right = tplFam === 'jobs' ? ''
      : tplFam === 'talks' ? '<button class="btn btn-gold" id="tpl-new">New toolbox talk</button>'
      : '<button class="btn btn-gold" id="tpl-new">New template</button>';
    var html = head('Templates', famDesc[tplFam], right);
    var famTabs = TPL_FAMS.map(function (f) {
      var n = all.filter(function (t) { return t.family === f[0]; }).length;
      return [f[0], f[1] + ' · ' + n];
    });
    famTabs.push(['talks', 'Toolbox Talks · ' + (B.talk_templates || []).length]);
    famTabs.push(['jobs', 'Jobs · ' + (B.jobs || []).length]);
    html += subtabs(tplFam, famTabs, 'tf');
    html += '<div class="tpl-grid" style="margin-top:14px">' +
      '<div class="tpl-list" id="tpl-list"></div>' +
      '<div class="tpl-ed" id="tpl-ed"></div></div>';
    paint(html);
    if (tplFam === 'jobs') { renderJobList(); renderJobAssign(); }
    else if (tplFam === 'talks') { renderTalkTplList(); renderTalkTplEditor(); }
    else { renderTplList(); renderTplEditor(); }
    wireSubtabs('tf', function (v) { tplFam = v; pgTemplates(); });
    var nb = $('#tpl-new');
    if (nb) nb.onclick = function () {
      if (tplFam === 'talks') {
        var id = 'tt_' + Date.now();
        (B.talk_templates || (B.talk_templates = [])).unshift({ id: id, topic: 'New toolbox talk',
          mins: 5, cat: 'General', summary: '', points: [''] });
        talkTplOpen = id;
        pgTemplates();
        toast('New toolbox talk created — add its points.');
        return;
      }
      var famName = (TPL_FAMS.filter(function (f) { return f[0] === tplFam; })[0] || ['', 'Template'])[1];
      var code = 'tpl_' + Date.now();
      var name = 'New ' + famName.replace(/s$/, '') + ' template';
      (B.templates || (B.templates = [])).unshift({ code: code, family: tplFam, name: name,
        sections: 1, items: 1, active: true, used_30d: 0, unassigned: true });
      TPL_DRAFT[code] = { code: code, name: name, family: tplFam, active: true,
        sections: [{ id: 's' + Date.now(), title: 'Section 1',
          items: [{ id: 'i' + Date.now(), label: '', type: 'yesno' }] }] };
      tplOpen = code;
      pgTemplates();
      toast('New template created — add your sections and fields.');
    };
  }

  // Templates → Toolbox Talks: list, create and edit prepared talks.
  function renderTalkTplList() {
    var host = $('#tpl-list'); if (!host) return;
    host.innerHTML = '';
    var list = B.talk_templates || [];
    if (!talkTplOpen || !list.some(function (t) { return t.id === talkTplOpen; })) talkTplOpen = list.length ? list[0].id : null;
    if (!list.length) { host.appendChild(el('div', 'empty', 'No toolbox talks yet.')); return; }
    list.forEach(function (t) {
      var b = el('button', 'tpl-row' + (t.id === talkTplOpen ? ' on' : ''));
      var left = el('div');
      left.appendChild(el('div', 'nm', t.topic));
      left.appendChild(el('div', 'mt', t.mins + ' min · ' + t.cat + ' · ' + (t.points || []).length + ' points'));
      b.appendChild(left);
      b.onclick = function () { talkTplOpen = t.id; renderTalkTplList(); renderTalkTplEditor(); };
      host.appendChild(b);
    });
  }
  function renderTalkTplEditor() {
    var host = $('#tpl-ed'); if (!host) return;
    if (!talkTplOpen) { host.innerHTML = '<div class="empty">Select a toolbox talk on the left, or create one.</div>'; return; }
    var t = (B.talk_templates || []).filter(function (x) { return x.id === talkTplOpen; })[0];
    if (!t) { host.innerHTML = ''; return; }
    if (t.sections) { renderTalkForm(t, host); return; }   // structured meeting form
    t.points = t.points || [];
    var ta = 'width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px';
    var html = '<div class="panel-hd"><div><h3>' + esc(t.topic) + '</h3>' +
      '<div class="sub">' + t.mins + ' min · ' + esc(t.cat) + '</div></div>' +
      '<button class="btn btn-sm" id="tt-del" style="color:var(--fail)">Delete</button></div>' +
      '<div style="padding:14px 16px">' +
      '<div class="f"><label for="tt-topic">Topic</label><input id="tt-topic" value="' + esc(t.topic) + '" style="width:100%"></div>' +
      '<div style="display:flex;gap:8px"><div class="f" style="flex:1"><label for="tt-mins">Minutes</label>' +
        '<input id="tt-mins" type="number" value="' + (t.mins || 5) + '"></div>' +
        '<div class="f" style="flex:2"><label for="tt-cat">Category</label><input id="tt-cat" value="' + esc(t.cat || '') + '"></div></div>' +
      '<div class="f"><label for="tt-sum">Summary</label><textarea id="tt-sum" rows="2" style="' + ta + '">' + esc(t.summary || '') + '</textarea></div>' +
      '<div class="sec-h" style="margin:14px 0 6px">Talking points</div><div id="tt-points">' +
      t.points.map(function (p, i) {
        return '<div style="display:flex;gap:8px;align-items:center;margin:5px 0">' +
          '<span class="dot" style="background:var(--ink-4);flex-shrink:0"></span>' +
          '<input class="tt-pt" data-i="' + i + '" value="' + esc(p) + '" placeholder="Talking point" ' +
            'style="flex:1;min-width:0;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px">' +
          '<button class="tt-rmpt" data-i="' + i + '" style="border:none;background:none;color:var(--fail);cursor:pointer;font-size:18px;line-height:1;padding:0 4px">&times;</button></div>';
      }).join('') + '</div>' +
      '<button class="btn btn-sm" id="tt-addpt" style="margin-top:6px">+ Add point</button></div>';
    host.innerHTML = html;
    wireTalkTplEditor(t);
  }
  // A toolbox talk that carries a full sectioned form (meeting details, talking
  // points, discussion, crew sign-off) — edited with the same sectioned editor
  // as the inspection templates.
  function renderTalkForm(t, host) {
    var itemCount = t.sections.reduce(function (n, s) { return n + s.items.length; }, 0);
    var html = '<div class="panel-hd"><div><h3>' + esc(t.topic) + '</h3>' +
      '<div class="sub">' + (t.mins || 5) + ' min · ' + esc(t.cat || '') + ' · ' +
        t.sections.length + ' sections · ' + itemCount + ' fields</div></div>' +
      '<button class="btn btn-sm" id="tt-del" style="color:var(--fail)">Delete</button></div>' +
      '<div style="padding:14px 16px">' +
      '<div style="display:flex;gap:8px">' +
        '<div class="f" style="flex:2"><label for="tt-topic">Topic</label>' +
          '<input id="tt-topic" value="' + esc(t.topic) + '" style="width:100%"></div>' +
        '<div class="f" style="flex:1"><label for="tt-mins">Minutes</label>' +
          '<input id="tt-mins" type="number" value="' + (t.mins || 5) + '"></div>' +
        '<div class="f" style="flex:2"><label for="tt-cat">Category</label>' +
          '<input id="tt-cat" value="' + esc(t.cat || '') + '"></div></div>' +
      teSectionsHtml(t) + '</div>';
    host.innerHTML = html;
    var tp = $('#tt-topic'); if (tp) tp.oninput = function () {
      t.topic = tp.value; var h3 = $('#tpl-ed .panel-hd h3'); if (h3) h3.textContent = tp.value; renderTalkTplList(); };
    var mn = $('#tt-mins'); if (mn) mn.onchange = function () { t.mins = +mn.value || 0; renderTalkTplList(); };
    var ct = $('#tt-cat'); if (ct) ct.oninput = function () { t.cat = ct.value; renderTalkTplList(); };
    var del = $('#tt-del'); if (del) del.onclick = function () {
      if (!confirm('Delete this toolbox talk?')) return;
      var list = B.talk_templates || []; var i = list.indexOf(t); if (i !== -1) list.splice(i, 1);
      talkTplOpen = null; renderTalkTplList(); renderTalkTplEditor(); toast('Toolbox talk deleted.'); };
    wireTalkSections(t);
  }
  function wireTalkSections(t) {
    function rr() { renderTalkTplList(); renderTalkTplEditor(); }
    $$('.te-title').forEach(function (e) { e.oninput = function () { t.sections[+e.dataset.si].title = e.value; }; });
    $$('.te-item').forEach(function (e) { e.oninput = function () { t.sections[+e.dataset.si].items[+e.dataset.ii].label = e.value; }; });
    $$('.te-type').forEach(function (e) { e.onchange = function () { t.sections[+e.dataset.si].items[+e.dataset.ii].type = e.value; }; });
    $$('.te-rmitem').forEach(function (b) { b.onclick = function () { t.sections[+b.dataset.si].items.splice(+b.dataset.ii, 1); rr(); }; });
    $$('[data-additem]').forEach(function (b) { b.onclick = function () { t.sections[+b.dataset.additem].items.push({ id: 'i' + Date.now(), label: '', type: 'yesno' }); rr(); }; });
    $$('[data-rmsec]').forEach(function (b) { b.onclick = function () { if (confirm('Remove this section and all of its fields?')) { t.sections.splice(+b.dataset.rmsec, 1); rr(); } }; });
    $$('[data-addsec]').forEach(function (b) { b.onclick = function () { t.sections.push({ id: 's' + Date.now(), title: 'New Section', items: [{ id: 'i' + Date.now(), label: '', type: 'yesno' }] }); rr(); }; });
  }
  function wireTalkTplEditor(t) {
    var tp = $('#tt-topic'); if (tp) tp.oninput = function () { t.topic = tp.value; var h3 = $('#tpl-ed .panel-hd h3'); if (h3) h3.textContent = tp.value; renderTalkTplList(); };
    var mn = $('#tt-mins'); if (mn) mn.onchange = function () { t.mins = +mn.value || 0; renderTalkTplList(); };
    var ct = $('#tt-cat'); if (ct) ct.oninput = function () { t.cat = ct.value; renderTalkTplList(); };
    var sm = $('#tt-sum'); if (sm) sm.oninput = function () { t.summary = sm.value; };
    $$('.tt-pt').forEach(function (e) { e.oninput = function () { t.points[+e.dataset.i] = e.value; }; });
    $$('.tt-rmpt').forEach(function (b) { b.onclick = function () { t.points.splice(+b.dataset.i, 1); renderTalkTplList(); renderTalkTplEditor(); }; });
    var ap = $('#tt-addpt'); if (ap) ap.onclick = function () { t.points.push(''); renderTalkTplList(); renderTalkTplEditor(); };
    var del = $('#tt-del'); if (del) del.onclick = function () {
      if (!confirm('Delete this toolbox talk?')) return;
      var list = B.talk_templates || [];
      var i = list.indexOf(t); if (i !== -1) list.splice(i, 1);
      talkTplOpen = null; renderTalkTplList(); renderTalkTplEditor();
      toast('Toolbox talk deleted.');
    };
  }

  // Jobs subtab: pick a job, build its own set of Safety Reports across all
  // families, and edit each form's fields for that job only.
  var TPL_FAM_LABEL = { report: 'Reports', inspection: 'Inspections', equipment: 'Equipment', permit: 'Permit checks', orientation: 'Orientations' };
  function renderJobList() {
    var host = $('#tpl-list'); if (!host) return;
    seedJobTpls();
    host.innerHTML = '';
    var jobs = B.jobs || [];
    if (!jobOpen || !jobs.some(function (j) { return j.id === jobOpen; })) jobOpen = jobs.length ? jobs[0].id : null;
    if (!jobs.length) { host.appendChild(el('div', 'empty', 'No jobs yet.')); return; }
    jobs.forEach(function (j) {
      var b = el('button', 'tpl-row' + (j.id === jobOpen ? ' on' : ''));
      var left = el('div');
      left.appendChild(el('div', 'nm', j.name));
      left.appendChild(el('div', 'mt', j.job_number + ' · ' + (JOB_TPLS[j.id] || []).length + ' forms'));
      b.appendChild(left);
      b.onclick = function () { jobOpen = j.id; jobTplOpen = null; renderJobList(); renderJobAssign(); };
      host.appendChild(b);
    });
  }
  function renderJobAssign() {
    var host = $('#tpl-ed'); if (!host) return;
    seedJobTpls();
    if (!jobOpen) { host.innerHTML = '<div class="empty">Select a job on the left to build its Safety Reports.</div>'; return; }
    var j = (B.jobs || []).filter(function (x) { return x.id === jobOpen; })[0];
    var assigned = JOB_TPLS[jobOpen] || (JOB_TPLS[jobOpen] = []);
    if (jobTplOpen) { renderJobTplEditor(j, jobTplOpen); return; }

    var all = B.templates || [];
    function metaOf(c) { return all.filter(function (t) { return t.code === c; })[0] || {}; }
    var unassigned = all.filter(function (t) { return assigned.indexOf(t.code) === -1 && t.active !== false; });

    var html = '<div class="panel-hd"><div><h3>Safety Reports · ' + esc(j.name) + '</h3>' +
      '<div class="sub">' + assigned.length + ' form' + (assigned.length === 1 ? '' : 's') +
      ' on this job — each editable for this job only</div></div></div><div style="padding:12px 16px">';
    if (!assigned.length) html += '<div class="empty" style="padding:1rem 0">Nothing on this job yet. Add a form below.</div>';

    ['report', 'inspection', 'equipment', 'permit', 'orientation'].forEach(function (fam) {
      var codes = assigned.filter(function (c) { return metaOf(c).family === fam; });
      if (!codes.length) return;
      html += '<div class="sec-h" style="margin:14px 0 6px">' + esc(TPL_FAM_LABEL[fam]) + '</div>';
      codes.forEach(function (code) {
        var d = jobDraftFor(jobOpen, code);
        var itemCount = d.sections.reduce(function (n, s) { return n + s.items.length; }, 0);
        html += '<div style="display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px">' +
          '<div class="click" data-jtedit="' + esc(code) + '" style="flex:1;min-width:0;cursor:pointer">' +
          '<div class="t-main">' + esc(d.name) + '</div>' +
          '<div class="t-sub">' + d.sections.length + ' sections · ' + itemCount + ' fields · saved for this job</div></div>' +
          '<button class="btn btn-sm" data-jtedit="' + esc(code) + '">Edit</button>' +
          '<button class="btn btn-sm" data-jtdel="' + esc(code) + '" style="color:var(--fail)">Remove</button></div>';
      });
    });

    if (unassigned.length) {
      var groups = ['report', 'inspection', 'equipment', 'permit', 'orientation'].map(function (fam) {
        var opts = unassigned.filter(function (t) { return t.family === fam; })
          .map(function (t) { return '<option value="' + esc(t.code) + '">' + esc(t.name) + '</option>'; }).join('');
        return opts ? '<optgroup label="' + esc(TPL_FAM_LABEL[fam]) + '">' + opts + '</optgroup>' : '';
      }).join('');
      html += '<div style="display:flex;gap:8px;margin-top:12px"><select id="jt-pick" style="flex:1">' + groups + '</select>' +
        '<button class="btn btn-gold btn-sm" id="jt-add">Add to job</button></div>';
    } else {
      html += '<div class="small muted" style="margin-top:12px">Every form is on this job.</div>';
    }
    html += '</div>';
    host.innerHTML = html;

    $$('[data-jtedit]').forEach(function (b) { b.onclick = function () { jobTplOpen = b.dataset.jtedit; renderJobAssign(); }; });
    $$('[data-jtdel]').forEach(function (b) { b.onclick = function () { var i = assigned.indexOf(b.dataset.jtdel); if (i !== -1) assigned.splice(i, 1); renderJobList(); renderJobAssign(); }; });
    var add = $('#jt-add'); if (add) add.onclick = function () {
      var code = $('#jt-pick').value;
      if (code && assigned.indexOf(code) === -1) { assigned.push(code); jobDraftFor(jobOpen, code); }
      renderJobList(); renderJobAssign();
    };
  }
  function renderJobTplEditor(j, code) {
    var host = $('#tpl-ed'); if (!host) return;
    var d = jobDraftFor(jobOpen, code);
    var itemCount = d.sections.reduce(function (n, s) { return n + s.items.length; }, 0);
    var html = '<div class="panel-hd"><div><h3>' + esc(d.name) + '</h3>' +
      '<div class="sub">' + esc(j.name) + ' · ' + d.sections.length + ' sections · ' + itemCount + ' fields · this job only</div></div>' +
      '<button class="btn btn-sm" id="jt-back">&larr; Back</button></div>';
    html += '<div style="padding:14px 16px">' +
      '<div class="f"><label for="jte-name">Form name (this job)</label>' +
      '<input id="jte-name" value="' + esc(d.name) + '" style="width:100%"></div>' +
      teSectionsHtml(d) + '</div>';
    host.innerHTML = html;
    var back = $('#jt-back'); if (back) back.onclick = function () { jobTplOpen = null; renderJobAssign(); };
    var nm = $('#jte-name'); if (nm) nm.oninput = function () { d.name = nm.value; var h3 = $('#tpl-ed .panel-hd h3'); if (h3) h3.textContent = nm.value; };
    wireJobSections(d);
  }
  function wireJobSections(d) {
    function rr() { renderJobAssign(); }
    $$('.te-title').forEach(function (e) { e.oninput = function () { d.sections[+e.dataset.si].title = e.value; }; });
    $$('.te-item').forEach(function (e) { e.oninput = function () { d.sections[+e.dataset.si].items[+e.dataset.ii].label = e.value; }; });
    $$('.te-type').forEach(function (e) { e.onchange = function () { d.sections[+e.dataset.si].items[+e.dataset.ii].type = e.value; }; });
    $$('.te-rmitem').forEach(function (b) { b.onclick = function () { d.sections[+b.dataset.si].items.splice(+b.dataset.ii, 1); rr(); }; });
    $$('[data-additem]').forEach(function (b) { b.onclick = function () { d.sections[+b.dataset.additem].items.push({ id: 'i' + Date.now(), label: '', type: 'yesno' }); rr(); }; });
    $$('[data-rmsec]').forEach(function (b) { b.onclick = function () { if (confirm('Remove this section and all of its fields?')) { d.sections.splice(+b.dataset.rmsec, 1); rr(); } }; });
    $$('[data-addsec]').forEach(function (b) { b.onclick = function () { d.sections.push({ id: 's' + Date.now(), title: 'New Section', items: [{ id: 'i' + Date.now(), label: '', type: 'yesno' }] }); rr(); }; });
  }

  function renderTplList() {
    var host = $('#tpl-list'); if (!host) return;
    host.innerHTML = '';
    var list = (B.templates || []).filter(function (t) { return t.family === tplFam; });
    if (!list.length) {
      host.appendChild(el('div', 'empty', 'No templates in this family yet.'));
      return;
    }
    list.forEach(function (t) {
      var d = TPL_DRAFT[t.code];
      var content = tplContent(t.code);
      var secN = d ? d.sections.length : content ? content.length : t.sections;
      var itN = d ? d.sections.reduce(function (n, s) { return n + s.items.length; }, 0)
        : content ? content.reduce(function (n, s) { return n + s.items.length; }, 0) : t.items;
      var b = el('button', 'tpl-row' + (t.code === tplOpen ? ' on' : ''));
      var left = el('div');
      left.appendChild(el('div', 'nm', d ? d.name : t.name));
      left.appendChild(el('div', 'mt', secN + ' sections · ' + itN + ' items · ' +
        (t.used_30d ? t.used_30d + ' used in 30d' : 'unused')));
      b.appendChild(left);
      if (!t.active) b.appendChild(el('span', 'pill p-grey', 'Off'));
      b.onclick = function () { tplOpen = t.code; renderTplList(); renderTplEditor(); };
      host.appendChild(b);
    });
  }

  // Field types a template item can be — shown as a dropdown per item.
  var TPL_ITEM_TYPES = [['yesno', 'Yes / No'], ['text', 'Text'], ['number', 'Number'],
    ['check', 'Checkbox'], ['multi', 'Checkbox (multi-select)'], ['sign', 'Signature'],
    ['photo', 'Photo'], ['comment', 'Comment'], ['choice', 'Multiple choice']];
  function teTypeSelect(cur, si, ii) {
    var opts = TPL_ITEM_TYPES.slice();
    if (cur && !opts.some(function (o) { return o[0] === cur; })) opts.unshift([cur, cur]);
    return '<select class="te-type" data-si="' + si + '" data-ii="' + ii + '" ' +
      'style="flex:0 0 auto;font-size:12px;padding:5px 6px;border:1px solid var(--line);border-radius:6px">' +
      opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (((cur || 'yesno') === o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
  }
  function teSectionsHtml(d) {
    return d.sections.map(function (s, si) {
      var body = s.items.map(function (it, ii) {
        return '<div style="display:flex;gap:8px;align-items:center;margin:5px 0">' +
          '<span class="dot" style="background:var(--ink-4);flex-shrink:0"></span>' +
          '<input class="te-item" data-si="' + si + '" data-ii="' + ii + '" value="' + esc(it.label) + '" ' +
            'placeholder="Field label" style="flex:1;min-width:0;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px">' +
          teTypeSelect(it.type, si, ii) +
          '<button class="te-rmitem" data-si="' + si + '" data-ii="' + ii + '" title="Remove field" ' +
            'style="border:none;background:none;color:var(--fail);cursor:pointer;font-size:18px;line-height:1;padding:0 4px">&times;</button>' +
        '</div>';
      }).join('');
      return '<div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
          '<input class="te-title" data-si="' + si + '" value="' + esc(s.title) + '" ' +
            'style="flex:1;min-width:0;font-weight:700;font-size:14px;padding:6px 8px;border:1px solid var(--line);border-radius:6px">' +
          '<span class="muted small" style="white-space:nowrap">' + s.items.length + ' fields</span>' +
          '<button class="btn btn-sm" data-rmsec="' + si + '" style="color:var(--fail)">Remove section</button>' +
        '</div>' + body +
        '<button class="btn btn-sm" data-additem="' + si + '" style="margin-top:8px">+ Add field</button>' +
      '</div>';
    }).join('') +
    '<button class="btn" data-addsec="1" style="margin-top:4px">+ Add section</button>';
  }
  function renderTplEditor() {
    var host = $('#tpl-ed'); if (!host) return;
    if (!tplOpen) { host.innerHTML = '<div class="empty">Select a template on the left to view and edit it.</div>'; return; }
    var d = draftFor(tplOpen);
    var meta = (B.templates || []).filter(function (t) { return t.code === tplOpen; })[0] || {};
    var itemCount = d.sections.reduce(function (n, s) { return n + s.items.length; }, 0);
    var html = '<div class="panel-hd"><div><h3>' + esc(d.name) + '</h3>' +
      '<div class="sub">' + d.sections.length + ' sections · ' + itemCount + ' fields' +
      (meta.unassigned ? ' · not assigned to any client yet' : '') + '</div></div>' +
      '<label class="check" style="margin:0;white-space:nowrap"><input type="checkbox" id="te-active"' +
      (d.active ? ' checked' : '') + '><span>Active</span></label></div>';
    html += '<div style="padding:14px 16px">' +
      '<div class="f"><label for="te-name">Template name</label>' +
      '<input id="te-name" value="' + esc(d.name) + '" style="width:100%"></div>' +
      teSectionsHtml(d) + '</div>';
    host.innerHTML = html;
    wireTplEditor(d);
  }
  function wireTplEditor(d) {
    function rr() { renderTplList(); renderTplEditor(); }
    var nm = $('#te-name');
    if (nm) nm.oninput = function () {
      d.name = nm.value;
      var h3 = $('#tpl-ed .panel-hd h3'); if (h3) h3.textContent = nm.value;
      renderTplList();
    };
    var act = $('#te-active'); if (act) act.onchange = function () { d.active = act.checked; renderTplList(); };
    $$('.te-title').forEach(function (e) { e.oninput = function () { d.sections[+e.dataset.si].title = e.value; }; });
    $$('.te-item').forEach(function (e) { e.oninput = function () { d.sections[+e.dataset.si].items[+e.dataset.ii].label = e.value; }; });
    $$('.te-type').forEach(function (e) { e.onchange = function () { d.sections[+e.dataset.si].items[+e.dataset.ii].type = e.value; }; });
    $$('.te-rmitem').forEach(function (b) { b.onclick = function () { d.sections[+b.dataset.si].items.splice(+b.dataset.ii, 1); rr(); }; });
    $$('[data-additem]').forEach(function (b) { b.onclick = function () { d.sections[+b.dataset.additem].items.push({ id: 'i' + Date.now(), label: '', type: 'yesno' }); rr(); }; });
    $$('[data-rmsec]').forEach(function (b) { b.onclick = function () { if (confirm('Remove this section and all of its fields?')) { d.sections.splice(+b.dataset.rmsec, 1); rr(); } }; });
    $$('[data-addsec]').forEach(function (b) { b.onclick = function () { d.sections.push({ id: 's' + Date.now(), title: 'New Section', items: [{ id: 'i' + Date.now(), label: '', type: 'yesno' }] }); rr(); }; });
  }

  /* ====================== DOCUMENTS ===================================== */
  /* The filing cabinet a safety professional actually gets asked to open:
     OSHA 300/300A recordkeeping, written programs, insurance. Stored here so
     the answer to "send me your..." is a download, not a search. */
  var docYear = new Date().getFullYear();
  function pgDocs() {
    var docs = B.docs || [];
    var folders = B.doc_folders || [];
    var nowY = new Date().getFullYear();
    function docYearOf(dd) { return new Date(dd.uploaded_at).getFullYear(); }
    function filesFor(fkey, item) {
      return docs.filter(function (dd) { return dd.folder === fkey && dd.item === item && docYearOf(dd) === docYear; });
    }
    var docsThisYear = docs.filter(function (dd) { return docYearOf(dd) === docYear; });
    var reqTotal = 0, reqMissing = 0;
    folders.forEach(function (fo) {
      fo.items.forEach(function (it) {
        if (it.req) { reqTotal++; if (!filesFor(fo.key, it.it).length) reqMissing++; }
      });
    });

    var html = head('Documents',
      'Your safety-document filing structure. Required items reflect the company’s configured ' +
      'compliance and prequalification requirements; recommended items are commonly maintained ' +
      'for audits, clients and safety administration.');

    var dq = (subQ.docs || '').toLowerCase();
    html += fbarSearch('doc-q', subQ.docs, 'Search documents by name…');

    // Year cycler — step back through prior years to review or upload what was filed.
    html += '<div style="display:flex;align-items:center;gap:.5rem;margin:.2rem 0 .8rem">' +
      '<span class="small muted">Filing year</span>' +
      '<button class="btn btn-sm" id="dy-prev"' + (docYear <= nowY - 6 ? ' disabled' : '') + '>&lsaquo;</button>' +
      '<span style="font-weight:700;font-size:15px;min-width:52px;text-align:center">' + docYear + '</span>' +
      '<button class="btn btn-sm" id="dy-next"' + (docYear >= nowY ? ' disabled' : '') + '>&rsaquo;</button>' +
      '<span class="small muted" style="margin-left:.4rem">' + docsThisYear.length + ' file' +
      (docsThisYear.length === 1 ? '' : 's') + ' filed in ' + docYear +
      (docYear < nowY ? ' · viewing a prior year' : '') + '</span></div>';

    html += '<div class="cards">' +
      kpi(reqMissing, 'required docs missing', 'of ' + reqTotal + ' configured requirements · ' + docYear,
          reqMissing ? 'c-bad' : 'c-ok') +
      kpi(docsThisYear.length, 'files on record', 'filed in ' + docYear, 'c-grey') +
      kpi(docsThisYear.filter(function (dd) {
        return (new Date() - new Date(dd.uploaded_at)) < 90 * 86400000; }).length,
        'updated this quarter', 'fresh enough to hand over', 'c-grey') +
      kpi('Centralized', 'document storage', 'safety records organized in one place', 'c-grey') +
      '</div>';

    var shownFolders = 0;
    folders.forEach(function (fo) {
      var items = dq ? fo.items.filter(function (it) {
        if (it.it.toLowerCase().indexOf(dq) !== -1) return true;
        return filesFor(fo.key, it.it).some(function (f) { return (f.name || '').toLowerCase().indexOf(dq) !== -1; });
      }) : fo.items;
      if (dq && !items.length) return;
      shownFolders++;
      var rows = items.map(function (it) {
        var files = filesFor(fo.key, it.it);
        var latest = files[0];
        var stat;
        if (files.length) {
          stat = '<span class="t-main">' + esc(latest.name) + '</span>' +
            '<div class="t-sub">' + esc(fmtDate(latest.uploaded_at)) +
            (files.length > 1 ? ' · ' + files.length + ' versions' : '') + '</div>';
        } else {
          stat = it.req ? '<span class="c-bad">Missing</span>'
                        : '<span class="muted">—</span>';
        }
        return '<tr>' +
          (latest ? selCell(latest.id) : '<td class="selcol"><input type="checkbox" class="msel" disabled></td>') +
          '<td><span class="t-main" style="font-weight:500">' + esc(it.it) + '</span></td>' +
          '<td>' + (it.req ? pill('p-bad', 'Required') : pill('p-grey', 'Recommended')) + '</td>' +
          '<td>' + stat + '</td>' +
          '<td class="r">' +
            (latest ? '<button class="btn btn-sm" data-dl="' + esc(latest.id) + '">Download</button> ' : '') +
            '<button class="btn btn-sm" data-up="' + esc(fo.key) + '|' + esc(it.it) + '">Upload</button>' +
          '</td></tr>';
      });
      var miss = fo.items.filter(function (it) {
        return it.req && !filesFor(fo.key, it.it).length; }).length;
      html += '<div class="panel"><div class="panel-hd"><div><h3>' + esc(fo.name) + '</h3>' +
        '<div class="sub">' + docs.filter(function (dd) { return dd.folder === fo.key; }).length +
        ' files' + (miss ? ' · <span style="color:var(--fail);font-weight:600">' + miss +
        ' required missing</span>' : ' · complete on required items') + '</div></div></div>' +
        '<div class="panel-bd flush">' + tableWrap(
          [{ t: '' }, { t: 'Document' }, { t: 'Priority' }, { t: 'On file' }, { t: '', r: 1 }],
          rows) + '</div></div>';
    });
    if (dq && !shownFolders) html += '<div class="empty">No documents match “' + esc(dq) + '”.</div>';

    // Everything in one file — GC / auditor-ready compliance packages.
    // (Hidden while searching so results stay focused on the matching documents.)
    if (!dq) {
    var dir = (B.people || []).filter(function (p) { return /Director/.test(p.title); })[0];
    var attest = dir ? dir.name + ', ' + dir.title : 'Safety Director';
    var rptBy = (C.brand || (C.contractor || 'Company') + ' Safety');
    function reportRow(title, sub, key) {
      return '<div class="kv" style="padding:10px 0">' +
        '<span class="k" style="color:var(--ink)"><span class="t-main">' + esc(title) + '</span>' +
        '<div class="small muted">' + esc(sub) + '</div></span>' +
        '<span style="display:flex;gap:6px;flex:0 0 auto">' +
          '<button class="btn btn-sm" data-rpt="open|' + key + '">Open</button>' +
          '<button class="btn btn-gold btn-sm" data-rpt="dl|' + key + '">Download PDF</button>' +
        '</span></div>';
    }
    html += '<div class="panel"><div class="panel-hd"><div><h3>Everything in one file</h3>' +
      '<div class="sub">Every inspection, finding and certification — one PDF for your GC or auditor.</div></div>' +
      '<button class="btn btn-gold" id="doc-all">Download all documentation</button></div>' +
      '<div class="panel-bd">' +
        reportRow(docYear + ' Annual Safety Compliance Report',
          'Prepared by ' + rptBy + ' · attested by ' + attest, 'annual') +
        reportRow((docYear - 2) + '–' + docYear + ' 3-Year Safety Compliance Report',
          'Rolling three-year record for prequalification and bids', 'three') +
      '</div></div>';

    // CCS annual safety audit certification — the yearly nonprofit audit that
    // keeps the company qualified to bid large / prequalified work.
    var ccs = B.ccs || {};
    var vt = ccs.valid_through ? new Date(ccs.valid_through + 'T12:00:00') : null;
    var vdays = vt ? Math.round((vt - new Date()) / 86400000) : null;
    var cstat = vdays === null ? pill('p-grey', 'Not on file')
      : vdays < 0 ? pill('p-bad', 'Expired')
      : vdays <= 60 ? pill('p-warn', 'Expires in ' + vdays + ' days') : pill('p-ok', 'Current');
    html += '<div class="panel"><div class="panel-hd"><div><h3>Annual Safety Audit — Demo</h3>' +
      '<div class="sub">Example annual safety-audit record used to demonstrate certification tracking and audit-package exports.</div></div>' +
      pill('p-grey', 'Sample') + '</div><div class="panel-bd">' +
      kv('Audit type', 'Demo / Example') +
      kv('Last audit', ccs.last_audit ? fmtDate(ccs.last_audit) : '—') +
      kv('Valid through', vt ? fmtDate(ccs.valid_through) : '—', vdays !== null && vdays < 0) +
      kv('Next audit due', vt ? fmtDate(ccs.valid_through) : '—') +
      '<div class="kv" style="border-bottom:none"><span class="k">Certificate on file</span>' +
      '<span class="v" style="display:flex;gap:8px;align-items:center">' +
        (ccs.file ? '<span class="t-main">' + esc(ccs.file.name) + '</span>' : '<span class="muted">None</span>') +
      '</span></div>' +
      '<button class="btn btn-gold btn-sm" id="ccs-dl" style="margin-top:6px">Export audit package</button>' +
      '<div class="small muted" style="margin-top:8px">Compiles the safety records commonly needed for an annual audit or prequalification review.</div>' +
      '</div></div>';
    } // end if (!dq)

    paint(html);
    wireSearch('doc-q', function (v) { subQ.docs = v; pgDocs(); });
    var dp = $('#dy-prev'); if (dp) dp.onclick = function () { if (docYear > nowY - 6) { docYear--; pgDocs(); } };
    var dn = $('#dy-next'); if (dn) dn.onclick = function () { if (docYear < nowY) { docYear++; pgDocs(); } };
    var docAll = $('#doc-all'); if (docAll) docAll.onclick = function () { complianceReport('all'); };
    $$('[data-rpt]').forEach(function (b) {
      b.onclick = function () { complianceReport(b.dataset.rpt.split('|')[1]); };
    });
    massInit({ label: 'Download selected', run: function (ids) {
      combinedPrint('Document Package', ids.map(function (id) {
        var dd = docs.filter(function (x) { return x.id === id; })[0];
        return { title: dd.name, sub: dd.item + ' · uploaded ' + fmtDate(dd.uploaded_at),
          body: '<div class="row"><span>Folder</span><span>' +
            esc((folders.filter(function (fo) { return fo.key === dd.folder; })[0] || {}).name || '') +
            '</span></div><div class="row"><span>Size</span><span>' +
            Math.round(dd.size / 1024) + ' KB</span></div>' +
            '<div style="font-size:11.5px;color:#6b7280;margin-top:8px">Demo build: this sheet ' +
            'stands in for the file. The live build zips the real files.</div>' };
      }) );
    } });
    $$('[data-dl]').forEach(function (b) {
      b.onclick = function () {
        toast('Demo build — files download from private Storage in the live version.');
      };
    });
    $$('[data-up]').forEach(function (b) {
      b.onclick = function () {
        var pp = b.dataset.up.split('|');
        openDocUpload(pp[0], pp[1], docYear);
      };
    });
    var ccsDl = $('#ccs-dl');
    if (ccsDl) ccsDl.onclick = function () {
      var recordables = (B.incidents || []).filter(function (i) { return i.osha_recordable; }).length;
      var openCA = (B.findings || []).filter(function (f) { return f.status === 'open'; }).length;
      var nearMiss = (B.near_misses || []).length;
      var certsAll = B.certs || [], expired = certsAll.filter(function (c) { return certDays(c.expires) < 0; }).length;
      var trainPct = certsAll.length ? Math.round((certsAll.length - expired) / certsAll.length * 100) : 100;
      var scAll = B.scorecard || [], blocked = scAll.filter(function (x) { return !x.cleared; }).length;
      var body = '<div class="sec">Company</div>' +
        '<div class="row"><span>Company</span><span>' + esc((B.company && B.company.name) || C.contractor || '') + '</span></div>' +
        '<div class="sec">Safety performance — trailing 12 months</div>' +
        '<div class="row"><span>TRIR</span><span>0.94</span></div>' +
        '<div class="row"><span>DART rate</span><span>0.62</span></div>' +
        '<div class="row"><span>EMR</span><span>0.89</span></div>' +
        '<div class="row"><span>Recordables YTD</span><span>' + recordables + '</span></div>' +
        '<div class="sec">Program standing</div>' +
        '<div class="row"><span>Open corrective actions</span><span>' + openCA + '</span></div>' +
        '<div class="row"><span>Near-miss reports (30 days)</span><span>' + nearMiss + '</span></div>' +
        '<div class="row"><span>Training compliance</span><span>' + trainPct + '%</span></div>' +
        '<div class="row"><span>Subcontractors cleared</span><span>' + (scAll.length - blocked) + ' of ' + scAll.length + '</span></div>' +
        '<div class="sec">Filing cabinet</div>' +
        (B.doc_folders || []).map(function (fo) {
          return '<div class="row"><span>' + esc(fo.name) + '</span><span>' + (B.docs || []).filter(function (dd) { return dd.folder === fo.key; }).length + ' files</span></div>'; }).join('') +
        '<div style="font-size:11.5px;color:#6b7280;margin-top:10px">Compiles commonly requested safety records into an export package for review. Demo export — it does not submit anything to any external organization.</div>';
      printRecord('Safety Audit — Demo Export Package', (B.company && B.company.name) || C.contractor || '', body);
    };
  }

  /* One PDF that stands in for the whole program — inspections, findings, certs,
     incidents and the filing cabinet, over a chosen period. */
  function complianceReport(key) {
    var nowY = new Date().getFullYear();
    var since, until, title;
    if (key === 'three') { since = new Date((docYear - 2) + '-01-01'); until = new Date(docYear + '-12-31T23:59:59');
      title = (docYear - 2) + '–' + docYear + ' 3-Year Safety Compliance Report'; }
    else if (key === 'all') { since = new Date('2000-01-01'); until = new Date(nowY + '-12-31T23:59:59');
      title = 'Complete Safety Documentation Package'; }
    else { since = new Date(docYear + '-01-01'); until = new Date(docYear + '-12-31T23:59:59');
      title = docYear + ' Annual Safety Compliance Report'; }
    function inRange(dt) { var x = new Date(dt); return x >= since && x <= until; }
    function rw(k, v) { return '<div class="row"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }

    var reps = (B.reports || []).filter(function (r) { return inRange(r.report_date); });
    var crew = CREW.filter(function (r) { return inRange(r.inspection_date); });
    var finds = (B.findings || []).filter(function (f) { return inRange(f.date); });
    var findsOpen = finds.filter(function (f) { return f.status === 'open'; }).length;
    var certs = B.certs || [];
    var certsExp = certs.filter(function (c) { return certDays(c.expires) < 0; }).length;
    var incs = (B.incidents || []).filter(function (i) { return inRange(i.date); });
    var rec = incs.filter(function (i) { return i.osha_recordable; }).length;
    var talks = (B.talks || []).filter(function (t) { return inRange(t.date); });

    var dir = (B.people || []).filter(function (p) { return /Director/.test(p.title); })[0];
    var attest = dir ? dir.name + ', ' + dir.title : 'Safety Director';
    var rptBy = (C.brand || (C.contractor || 'Company') + ' Safety');

    var body = '<div class="sec">Program summary</div>' +
      rw('Site safety reports', reps.length) +
      rw('Crew inspections', crew.length) +
      rw('Findings logged', finds.length + ' (' + findsOpen + ' still open)') +
      rw('Certifications on file', certs.length + ' (' + certsExp + ' expired)') +
      rw('Incidents', incs.length + ' (' + rec + ' OSHA recordable)') +
      rw('Toolbox Talks', talks.length) +
      '<div class="sec">Filing cabinet</div>' +
      (B.doc_folders || []).map(function (fo) {
        return rw(fo.name, (B.docs || []).filter(function (dd) { return dd.folder === fo.key; }).length + ' files');
      }).join('') +
      '<div style="font-size:11.5px;color:#6b7280;margin-top:10px">Prepared by ' + esc(rptBy) +
      ' · attested by ' + esc(attest) + '. Demo build — the live version compiles the underlying ' +
      'PDFs into one downloadable file.</div>';
    printRecord(title, 'Reporting period ending ' +
      until.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), body);
  }

  function openDocUpload(fkey, item, year) {
    var nowY = new Date().getFullYear();
    var fileYear = year || nowY;
    var folders = B.doc_folders || [];
    var h = '<div class="f"><label for="du-folder">Folder</label><select id="du-folder">' +
      folders.map(function (fo) {
        return '<option value="' + esc(fo.key) + '"' + (fo.key === fkey ? ' selected' : '') + '>' +
          esc(fo.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="f"><label for="du-item">Document type</label><select id="du-item"></select></div>' +
      '<div class="f"><label for="du-name">File name</label>' +
      '<input type="text" id="du-name" placeholder="filename.pdf"></div>' +
      '<p class="small" id="du-err" style="color:var(--fail);min-height:1em"></p>' +
      '<button class="btn btn-gold" id="du-save" style="width:100%;justify-content:center">Upload</button>' +
      '<p class="small muted" style="margin-top:.7rem">Demo build: records the entry. The live ' +
      'version stores the file itself in private Storage — never on a public URL.</p>';
    drawer('Upload document', 'Filed under ' + fileYear +
      (fileYear !== nowY ? ' (back-filing a prior year)' : ''), h);
    function fillItems() {
      var fo = folders.filter(function (x) { return x.key === $('#du-folder').value; })[0];
      $('#du-item').innerHTML = (fo ? fo.items : []).map(function (it) {
        return '<option' + (it.it === item ? ' selected' : '') + '>' + esc(it.it) + '</option>';
      }).join('');
    }
    fillItems();
    $('#du-folder').onchange = fillItems;
    $('#du-save').onclick = function () {
      var nm = $('#du-name').value.trim();
      if (!nm) { $('#du-err').textContent = 'Give the file a name.'; return; }
      // Stamp with today when filing the current year, or mid-year when back-filing.
      var stamp = fileYear === nowY ? new Date().toISOString() : fileYear + '-06-15T12:00:00.000Z';
      (B.docs || []).unshift({ id: 'd' + Date.now(), folder: $('#du-folder').value,
        item: $('#du-item').value, name: nm, uploaded_at: stamp, size: 204800 });
      closeDrawer(); toast('Filed under ' + $('#du-item').value + ' · ' + fileYear);
      pgDocs();
    };
  }


  /* ====================== ORIENTATION =================================== */
  /* "Who may work here today." The roster is derived from data the system
     already holds (sub crews, certs, orientation dates) — the only entry is
     marking a worker oriented at the trailer, once. */
  // Authorization derived the same way for internal and external workers.
  function orientAuth(w) {
    var oDays = w.orient_expires
      ? Math.round((new Date(w.orient_expires + 'T12:00:00') - new Date()) / 86400000) : null;
    var expiredCerts = (w.certs || []).filter(function (c) {
      return Math.round((new Date(c.exp + 'T12:00:00') - new Date()) / 86400000) < 0; });
    var why = [];
    if (!w.oriented) why.push('Not oriented');
    else if (oDays !== null && oDays < 0) why.push('Orientation expired');
    expiredCerts.forEach(function (c) { why.push(c.t + ' expired'); });
    return { orient_days: oDays, expired_certs: expiredCerts, authorized: why.length === 0, why: why };
  }
  // Internal staff roster — the GC's own people, same shape as the sub roster.
  function internalRoster() {
    return (B.people || []).map(function (p) {
      var w = { id: p.id, name: p.name, role: p.title, oriented: p.oriented,
        orient_expires: p.orient_expires, certs: p.certs || [] };
      var a = orientAuth(w);
      return { id: p.id, type: 'internal', sub: { name: (C.contractor || 'Internal') + ' (internal)' },
        jobs: p.jobs || [], w: w,
        orient_days: a.orient_days, expired_certs: a.expired_certs, authorized: a.authorized, why: a.why };
    }).sort(function (a, b) { return (a.authorized ? 1 : 0) - (b.authorized ? 1 : 0); });
  }

  /* ---- Jobsite orientation (additive; company logic above is untouched) ---
     Site orientation status for one worker on one job, derived from completion
     dates. Missing = no record, Expired = past, Current otherwise.           */
  function siteOrientStatus(workerId, jobId) {
    var recs = (B.job_orientations || []).filter(function (c) {
      return c.worker_id === workerId && c.job_id === jobId; });
    if (!recs.length) return { k: 'missing', label: 'Missing', rec: null };
    var rec = recs.slice().sort(function (a, b) { return new Date(b.expires_at) - new Date(a.expires_at); })[0];
    var days = Math.round((new Date(rec.expires_at + 'T12:00:00') - new Date()) / 86400000);
    return { k: days < 0 ? 'expired' : 'current', label: days < 0 ? 'Expired' : 'Current', rec: rec, days: days };
  }
  // Jobs a roster row is eligible for (external inherit the sub's jobs).
  function rowJobs(r) { return r.type === 'internal' ? (r.jobs || []) : ((r.sub && r.sub.jobs) || []); }
  // ADDITIVE job authorization = company authorization (unchanged) AND this
  // job's site orientation current. Never mutates orientAuth or company state.
  function jobAuth(r, jobId) {
    var why = (r.why || []).slice();          // company reasons reused verbatim
    var site = siteOrientStatus(r.id, jobId);
    if (site.k === 'missing') why.push('Site orientation not completed');
    else if (site.k === 'expired') why.push('Site orientation expired');
    return { authorized: why.length === 0, why: why, site: site };
  }
  function companyOrientLabel(r) {
    if (!r.w.oriented) return { cls: 'p-bad', label: 'Not completed' };
    if (r.orient_days !== null && r.orient_days < 0) return { cls: 'p-bad', label: 'Expired' };
    return { cls: 'p-ok', label: 'Current' };
  }
  function siteOrientPill(st) {
    return st.k === 'current' ? pill('p-ok', 'Current')
      : st.k === 'expired' ? pill('p-warn', 'Expired') : pill('p-bad', 'Missing');
  }
  function certCell(r) {
    return r.expired_certs.length
      ? '<span class="c-bad">' + esc(r.expired_certs.map(function (c) { return c.t; }).join(', ')) + ' expired</span>'
      : ((r.w.certs || []).length ? (r.w.certs.length + ' current') : '<span class="muted">none on file</span>');
  }
  // Re-resolve a roster row by stable id after a bundle refresh (drawer re-open).
  function findWorkerRow(id, type) {
    var list = (type === 'internal' ? internalRoster() : workerRoster())
      .concat(type === 'internal' ? workerRoster() : internalRoster());
    return list.filter(function (r) { return r.id === id; })[0] || null;
  }
  function orientTplName(code) {
    var t = (B.templates || []).filter(function (x) { return x.code === code; })[0];
    return t ? t.name : code;
  }

  var orientMain = 'company';        // Company Orientation | By Job
  var orientTab = 'external';        // within Company: internal | external
  var orientF = { q: '', job: '', company: '' };
  var orientJob = '';                // By Job: selected job id ('' -> first job)
  var orientAwaitF = { q: '', job: '' };   // Awaiting Submission: search + jobsite filter

  function pgOrient() {
    var mainTabs = subtabs(orientMain, [['company', 'Company Orientation'], ['byjob', 'By Job'],
      ['awaiting', 'Awaiting Submission']], 'om');
    if (orientMain === 'byjob') { pgOrientByJob(mainTabs); return; }
    if (orientMain === 'awaiting') { pgOrientAwaiting(mainTabs); return; }

    var subTabs = subtabs(orientTab, [['internal', 'Internal employees'], ['external', 'Subcontractors']], 'or');
    var full = orientTab === 'internal' ? internalRoster() : workerRoster();

    var jobOpts = (B.jobs || []).map(function (j) {
      return '<option value="' + esc(j.id) + '"' + (orientF.job === j.id ? ' selected' : '') + '>' + esc(jobName(j.id)) + '</option>'; }).join('');
    var coOpts = (B.subs || []).map(function (s) {
      return '<option value="' + esc(s.name) + '"' + (orientF.company === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('');

    var q = orientF.q.toLowerCase();
    var roster = full.filter(function (r) {
      if (orientF.job && rowJobs(r).indexOf(orientF.job) === -1) return false;
      if (orientTab === 'external' && orientF.company && r.sub.name !== orientF.company) return false;
      if (q && (r.w.name + ' ' + r.w.role).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var blocked = roster.filter(function (r) { return !r.authorized; });
    var expiring = roster.filter(function (r) {
      return r.authorized && r.orient_days !== null && r.orient_days <= 30; });

    var html = head('Orientation & Site Authorization',
      'Company baseline onboarding. A worker is authorized when their orientation is current and no ' +
      'certification on file is expired. Click a name for the badge.', mainTabs);
    html += subTabs;
    html += '<div class="cards">' +
      kpi(roster.length - blocked.length, 'authorized', orientTab === 'internal' ? 'internal staff' : 'sub crews', 'c-ok') +
      kpi(blocked.length, 'not authorized', blocked.length ? 'should not be on site' : 'nobody blocked',
          blocked.length ? 'c-bad' : 'c-ok') +
      kpi(expiring.length, 'orientations expiring', 'within 30 days', expiring.length ? 'c-warn' : 'c-ok') +
      kpi(roster.length, orientTab === 'internal' ? 'internal employees' : 'sub workers', 'shown', 'c-grey') +
      '</div>';

    html += '<div class="fbar">' +
      '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<input id="or-q" placeholder="Search name or role…" value="' + esc(orientF.q) + '"></div>' +
      '<select id="or-job"><option value="">All jobs</option>' + jobOpts + '</select>' +
      (orientTab === 'external'
        ? '<select id="or-co"><option value="">All companies</option>' + coOpts + '</select>' : '') +
      '</div>';

    var companyCol = orientTab === 'internal' ? 'Role' : 'Subcontractor';
    var rows = roster.map(function (r, i) {
      return '<tr class="click" data-worker="' + i + '">' +
        '<td><span class="t-main">' + esc(r.w.name) + '</span>' +
          '<div class="t-sub">' + esc(r.w.role) + '</div></td>' +
        '<td>' + esc(orientTab === 'internal' ? r.w.role : r.sub.name) + '</td>' +
        '<td>' + (r.w.oriented ? esc(fmtDate(r.w.oriented)) :
          '<span class="c-bad">Never</span>') + '</td>' +
        '<td>' + (r.w.orient_expires
          ? (r.orient_days < 0 ? '<span class="c-bad">' + esc(fmtDate(r.w.orient_expires)) + '</span>'
             : r.orient_days <= 30 ? '<span class="c-warn">' + esc(fmtDate(r.w.orient_expires)) + '</span>'
             : esc(fmtDate(r.w.orient_expires)))
          : '—') + '</td>' +
        '<td>' + certCell(r) + '</td>' +
        '<td class="r">' + (r.authorized ? pill('p-ok', 'Authorized')
          : pill('p-bad', 'Not authorized')) + '</td></tr>';
    });
    html += '<div class="panel"><div class="panel-hd"><div><h3>Roster</h3>' +
      '<div class="sub">Blocked workers first. Click one for the badge and the reason.</div>' +
      '</div></div><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Worker' }, { t: companyCol }, { t: 'Oriented' }, { t: 'Expires' },
       { t: 'Certifications' }, { t: 'Status', r: 1 }], rows,
      'No workers match your filters.') + '</div></div>';
    paint(html);
    wireSubtabs('om', function (v) { orientMain = v; pgOrient(); });
    wireSubtabs('or', function (v) { orientTab = v; orientF.company = ''; pgOrient(); });
    function orBind(id, key) { var e = $('#' + id); if (e) e.oninput = e.onchange = function () { orientF[key] = e.value; pgOrient(); }; }
    orBind('or-q', 'q'); orBind('or-job', 'job'); orBind('or-co', 'company');
    var _orq = $('#or-q'); if (_orq && orientF.q) { _orq.focus(); try { _orq.setSelectionRange(_orq.value.length, _orq.value.length); } catch (e) {} }
    var R = roster;
    $$('[data-worker]').forEach(function (tr) {
      tr.onclick = function () { openWorker(R[+tr.dataset.worker]); };
    });
  }

  // BY JOB: who is assigned to one project and are they authorized for THIS job.
  function pgOrientByJob(mainTabs) {
    var jobs = B.jobs || [];
    if (!orientJob || !jobs.some(function (j) { return j.id === orientJob; })) orientJob = jobs.length ? jobs[0].id : '';
    var job = jobs.filter(function (j) { return j.id === orientJob; })[0];

    var roster = workerRoster().filter(function (r) { return rowJobs(r).indexOf(orientJob) !== -1; })
      .concat(internalRoster().filter(function (r) { return rowJobs(r).indexOf(orientJob) !== -1; }));
    roster.forEach(function (r) { r._ja = jobAuth(r, orientJob); });
    roster.sort(function (a, b) { return (a._ja.authorized ? 1 : 0) - (b._ja.authorized ? 1 : 0); });

    var authed = roster.filter(function (r) { return r._ja.authorized; }).length;
    var missing = roster.filter(function (r) { return r._ja.site.k === 'missing'; }).length;

    var html = head('Orientation & Site Authorization',
      'Who is assigned to this project and whether they are authorized for THIS job. Job ' +
      'authorization = company authorization current AND this site’s orientation current.', mainTabs);
    var jobOpts = jobs.map(function (j) {
      return '<option value="' + esc(j.id) + '"' + (orientJob === j.id ? ' selected' : '') + '>' +
        esc(j.name) + '</option>'; }).join('');
    html += '<div class="fbar"><select id="oj-job">' + jobOpts + '</select></div>';
    html += '<div class="cards">' +
      kpi(authed, 'authorized for job', job ? esc(job.name) : '', 'c-ok') +
      kpi(roster.length - authed, 'not authorized', (roster.length - authed) ? 'blocked for this job' : 'all clear', (roster.length - authed) ? 'c-bad' : 'c-ok') +
      kpi(missing, 'site orientation missing', 'not completed for this job', missing ? 'c-warn' : 'c-ok') +
      kpi(roster.length, 'workers assigned', 'to this job', 'c-grey') +
      '</div>';

    var rows = roster.map(function (r, i) {
      var co = companyOrientLabel(r);
      return '<tr class="click" data-worker="' + i + '">' +
        '<td><span class="t-main">' + esc(r.w.name) + '</span>' +
          '<div class="t-sub">' + esc(r.w.role) + '</div></td>' +
        '<td>' + esc(r.type === 'internal' ? (r.w.role) : r.sub.name) + '</td>' +
        '<td>' + pill(co.cls, co.label) + '</td>' +
        '<td>' + siteOrientPill(r._ja.site) + '</td>' +
        '<td>' + certCell(r) + '</td>' +
        '<td class="r">' + (r._ja.authorized ? pill('p-ok', 'Authorized')
          : pill('p-bad', 'Not authorized')) + '</td></tr>';
    });
    html += '<div class="panel"><div class="panel-hd"><div><h3>' + (job ? esc(job.name) : 'Job') + ' roster</h3>' +
      '<div class="sub">Not-authorized workers first. Click one for the badge, site orientation and reasons.</div>' +
      '</div></div><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Worker' }, { t: 'Company / Role' }, { t: 'Company Orientation' }, { t: 'Site Orientation' },
       { t: 'Certifications' }, { t: 'Authorization', r: 1 }], rows,
      'No workers assigned to this job.') + '</div></div>';
    paint(html);
    wireSubtabs('om', function (v) { orientMain = v; pgOrient(); });
    var jsel = $('#oj-job'); if (jsel) jsel.onchange = function () { orientJob = jsel.value; pgOrient(); };
    var R = roster;
    $$('[data-worker]').forEach(function (tr) {
      tr.onclick = function () { openWorker(R[+tr.dataset.worker], orientJob); };
    });
  }

  // AWAITING SUBMISSION: filtered view over ORIENTATION_SENDS — sends not yet
  // submitted. Delivery-status only; no authorization or send-data changes.
  function pgOrientAwaiting(mainTabs) {
    var all = (B.orientation_sends || []).filter(function (s) { return !s.submitted_at; });
    var openedN = all.filter(function (s) { return s.opened_at; }).length;
    var notOpenedN = all.length - openedN;

    var scopeName = function (s) { return s.job_id ? jobName(s.job_id) : 'Company-wide'; };
    var q = (orientAwaitF.q || '').toLowerCase();
    var pending = all.filter(function (s) {
      if (orientAwaitF.job && s.job_id !== orientAwaitF.job) return false;
      return has((s.recipient || '') + ' ' + orientTplName(s.template_id) + ' ' + scopeName(s), q);
    });
    // Opened-but-not-submitted first, then sent-but-not-opened; oldest pending first.
    pending.sort(function (a, b) {
      var ra = a.opened_at ? 0 : 1, rb = b.opened_at ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return new Date(a.sent_at) - new Date(b.sent_at);
    });

    var html = head('Orientation & Site Authorization',
      'Orientations sent digitally that have not been submitted yet. Opened-but-not-submitted ' +
      'first, then sent-but-not-opened — oldest waiting first.', mainTabs);
    html += '<div class="cards">' +
      kpi(all.length, 'awaiting submission', 'sent, not yet completed', all.length ? 'c-warn' : 'c-ok') +
      kpi(openedN, 'opened', 'opened, not submitted', openedN ? 'c-warn' : 'c-grey') +
      kpi(notOpenedN, 'not opened', 'sent, not opened', 'c-grey') +
      '</div>';

    var jobIds = {};
    all.forEach(function (s) { if (s.job_id) jobIds[s.job_id] = true; });
    var jobOpts = Object.keys(jobIds).map(function (jid) {
      return '<option value="' + esc(jid) + '"' + (orientAwaitF.job === jid ? ' selected' : '') + '>' + esc(jobName(jid)) + '</option>'; }).join('');
    html += '<div class="fbar">' +
      '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<input id="oa-q" placeholder="Search worker, orientation or jobsite…" value="' + esc(orientAwaitF.q) + '"></div>' +
      '<select id="oa-job"><option value="">All jobsites</option>' + jobOpts + '</select>' +
      '</div>';

    var rows = pending.map(function (s, i) {
      return '<tr class="click" data-osend="' + i + '">' +
        '<td><span class="t-main">' + esc(s.recipient || '—') + '</span></td>' +
        '<td>' + esc(orientTplName(s.template_id)) + '</td>' +
        '<td>' + (s.job_id ? esc(jobName(s.job_id)) : '<span class="muted">Company-wide</span>') + '</td>' +
        '<td>' + esc(fmtWhen(s.sent_at)) + '</td>' +
        '<td>' + (s.opened_at ? esc(fmtWhen(s.opened_at)) : '—') + '</td>' +
        '<td class="r">' + (s.opened_at ? pill('p-warn', 'Opened') : pill('p-grey', 'Sent')) + '</td></tr>';
    });
    html += '<div class="panel"><div class="panel-hd"><div><h3>Awaiting submission</h3>' +
      '<div class="sub">Sent to the worker, not yet completed. Click one for the delivery detail.</div>' +
      '</div></div><div class="panel-bd flush">' + tableWrap(
      [{ t: 'Worker' }, { t: 'Orientation' }, { t: 'Jobsite' }, { t: 'Sent' }, { t: 'Opened' }, { t: 'Status', r: 1 }],
      rows, 'Nothing awaiting submission.') + '</div></div>';
    paint(html);
    wireSubtabs('om', function (v) { orientMain = v; pgOrient(); });
    var qEl = $('#oa-q'); if (qEl) qEl.oninput = function () { orientAwaitF.q = qEl.value; pgOrient(); };
    var jEl = $('#oa-job'); if (jEl) jEl.onchange = function () { orientAwaitF.job = jEl.value; pgOrient(); };
    var _q = $('#oa-q'); if (_q && orientAwaitF.q) { _q.focus(); try { _q.setSelectionRange(_q.value.length, _q.value.length); } catch (e) {} }
    var P = pending;
    $$('[data-osend]').forEach(function (tr) {
      tr.onclick = function () { openOrientSend(P[+tr.dataset.osend]); };
    });
  }

  // Read-only detail for a pending orientation send. No status mutation here.
  function openOrientSend(sd) {
    if (!sd) return;
    var row = findWorkerRow(sd.worker_id, sd.worker_id && sd.worker_id.indexOf('pi_') === 0 ? 'internal' : 'external');
    var h = '<div class="sec-h">Worker</div>' +
      kv('Name', sd.recipient || (row && row.w.name) || '—') +
      (row ? kv(row.type === 'internal' ? 'Role' : 'Company', row.type === 'internal' ? row.w.role : row.sub.name) : '') +
      (sd.phone ? kv('Phone', sd.phone) : '');
    h += '<div class="sec-h">Orientation</div>' +
      kv('Template', orientTplName(sd.template_id)) +
      kv('Scope', sd.job_id ? jobName(sd.job_id) : 'Company-wide');
    h += '<div class="sec-h">Delivery activity</div>' +
      kv('Sent', fmtWhen(sd.sent_at)) +
      kv('Opened', sd.opened_at ? fmtWhen(sd.opened_at) : 'Not opened') +
      kv('Submitted', 'Awaiting submission') +
      '<div class="kv"><span class="k">Status</span>' +
      (sd.opened_at ? pill('p-warn', 'Opened') : pill('p-grey', 'Sent')) + '</div>';
    drawer(sd.recipient || 'Orientation delivery', orientTplName(sd.template_id), h);
  }

  function openWorker(r, jobId) {
    var h = '';
    if (!r.authorized) {
      h += '<div class="alert"><strong>Not authorized to work.</strong> ' +
        esc(r.why.join(' · ')) + '.</div>';
    }
    // Badge = company / global authorization (meaning unchanged).
    h += '<div class="sec-h">Badge</div>' +
      '<div class="badgecard' + (r.authorized ? '' : ' bad') + '">' +
      '<div class="b-status">' + (r.authorized ? 'AUTHORIZED' : 'NOT AUTHORIZED') + '</div>' +
      '<div class="b-name">' + esc(r.w.name) + '</div>' +
      '<div class="b-sub">' + esc(r.sub.name) + ' · ' + esc(r.w.role) + '</div>' +
      '<div class="b-note">Company authorization. Scan check: 5 seconds in the field replaces a ' +
      'radio call. QR encodes this record in the live build.</div></div>' +
      '<button class="btn btn-sm" id="w-print" style="margin-top:10px">Print badge card</button>';

    // Opened from By Job — show THIS job's authorization separately below the badge.
    if (jobId) {
      var jja = jobAuth(r, jobId);
      h += '<div style="margin-top:10px;padding:10px 12px;border:1px solid ' +
        (jja.authorized ? 'var(--ok-br)' : 'var(--fail-br)') + ';background:' +
        (jja.authorized ? 'var(--ok-tt)' : 'var(--fail-tt)') + ';border-radius:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
          '<span class="small" style="font-weight:700;color:' + (jja.authorized ? 'var(--ok)' : 'var(--fail)') +
            '">' + esc(jobName(jobId)) + '</span>' +
          (jja.authorized ? pill('p-ok', 'Authorized for this job') : pill('p-bad', 'Not authorized for this job')) + '</div>' +
        (!jja.authorized ? '<div class="small" style="margin-top:4px;color:var(--ink-2)">' + esc(jja.why.join(' · ')) + '</div>' : '') +
        '</div>';
    }

    h += '<div class="sec-h">Company orientation</div>' +
      kv('Completed', r.w.oriented ? fmtDate(r.w.oriented) : 'Never', !r.w.oriented) +
      kv('Expires', r.w.orient_expires ? fmtDate(r.w.orient_expires) : '—',
         r.orient_days !== null && r.orient_days < 0);
    if (!r.w.oriented || (r.orient_days !== null && r.orient_days < 0)) {
      h += '<button class="btn btn-gold btn-sm" id="w-orient" style="margin-top:10px">' +
        'Mark completed manually</button>' +
        '<p class="small muted" style="margin-top:.5rem">Use this only to record an orientation ' +
        'completed outside the digital workflow.</p>';
    }

    // Jobsite authorization — one card per job the worker is assigned to.
    var assigned = rowJobs(r);
    h += '<div class="sec-h">Jobsite authorization</div>';
    if (!assigned.length) h += '<div class="small muted">Not assigned to any job.</div>';
    assigned.forEach(function (jid) {
      var ja = jobAuth(r, jid), st = ja.site;
      h += '<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">' +
          '<span class="t-main">' + esc(jobName(jid)) + '</span>' +
          (ja.authorized ? pill('p-ok', 'Authorized') : pill('p-bad', 'Not authorized')) + '</div>' +
        '<div class="kv"><span class="k">Site orientation</span>' + siteOrientPill(st) + '</div>' +
        (st.rec ? '<div class="kv"><span class="k">Completed</span><span class="v">' + esc(fmtDate(st.rec.completed_at)) + '</span></div>' +
                  '<div class="kv"><span class="k">Expires</span><span class="v' + (st.k === 'expired' ? ' bad' : '') + '">' + esc(fmtDate(st.rec.expires_at)) + '</span></div>' : '') +
        (!ja.authorized ? '<div class="small" style="color:var(--fail);margin-top:2px">' + esc(ja.why.join(' · ')) + '</div>' : '') +
        ((st.k === 'missing' || st.k === 'expired')
          ? '<button class="btn btn-sm" data-siteorient="' + esc(jid) + '" style="margin-top:8px">Mark site orientation complete manually</button>' : '') +
        '</div>';
    });

    h += '<div class="sec-h">Certifications</div>';
    if (!(r.w.certs || []).length) h += '<div class="small muted">None on file.</div>';
    (r.w.certs || []).forEach(function (c) {
      var dd = Math.round((new Date(c.exp + 'T12:00:00') - new Date()) / 86400000);
      h += '<div class="kv"><span class="k">' + esc(c.t) + '</span>' +
        (dd < 0 ? pill('p-bad', 'Expired ' + fmtDate(c.exp)) :
         dd <= 60 ? pill('p-warn', dd + ' days') : pill('p-ok', 'Current')) + '</div>';
    });

    // Delivery activity — from ORIENTATION_SENDS (seeded timestamps, never generated here).
    var sends = (B.orientation_sends || []).filter(function (x) { return x.worker_id === r.id; });
    if (sends.length) {
      h += '<div class="sec-h">Delivery activity</div>';
      sends.forEach(function (sd) {
        var stp = sd.status === 'completed' ? pill('p-ok', 'Submitted')
          : sd.status === 'opened' ? pill('p-warn', 'Awaiting submission') : pill('p-grey', 'Sent');
        h += '<div class="kv"><span class="k">' + esc(orientTplName(sd.template_id)) +
          '<div class="small muted">Sent ' + esc(fmtWhen(sd.sent_at)) +
          (sd.opened_at ? ' · Opened ' + esc(fmtWhen(sd.opened_at)) : '') +
          (sd.submitted_at ? ' · Submitted ' + esc(fmtWhen(sd.submitted_at)) : '') +
          '</div></span>' + stp + '</div>';
      });
    }

    drawer(r.w.name, r.sub.name + ' · ' + r.w.role, h);
    function reopen() {
      refreshBundle().then(function () { pgOrient(); var nr = findWorkerRow(r.id, r.type); if (nr) openWorker(nr, jobId); });
    }
    $('#w-print').onclick = function () {
      printRecord('Site Badge — ' + r.w.name, r.sub.name + ' · ' + r.w.role,
        '<div class="sec">Status</div><div class="row"><span>Authorization</span>' +
        '<span class="chip ' + (r.authorized ? 'ok">AUTHORIZED' : 'bad">NOT AUTHORIZED') +
        '</span></div>' +
        '<div class="row"><span>Oriented</span><span>' +
        esc(r.w.oriented ? fmtDate(r.w.oriented) : 'Never') + '</span></div>' +
        (r.why.length ? '<div class="fix">' + esc(r.why.join(' · ')) + '</div>' : ''));
    };
    var ob = $('#w-orient');
    if (ob) ob.onclick = function () {
      post('cs_portal_orient_worker', { p_worker_id: r.id, p_type: r.type })
        .then(function () { toast(r.w.name + ' oriented — authorization re-derived'); reopen(); });
    };
    $$('[data-siteorient]').forEach(function (b) {
      b.onclick = function () {
        var jid = b.dataset.siteorient;
        post('cs_portal_complete_site_orient', { p_worker_id: r.id, p_type: r.type, p_job_id: jid })
          .then(function () { toast('Site orientation completed — job authorization re-derived'); reopen(); });
      };
    });
  }

  /* ====================== DRAWERS ======================================= */
  function closeDrawer() {
    var s = $('.scrim'), d = $('.drawer');
    if (s) s.remove(); if (d) d.remove();
  }
  function drawer(title, sub, bodyHtml) {
    closeDrawer();
    var scrim = el('div', 'scrim');
    scrim.onclick = closeDrawer;
    var dr = el('div', 'drawer');
    dr.innerHTML = '<div class="drawer-hd"><div><h3>' + esc(title) + '</h3>' +
      (sub ? '<div class="small muted" style="margin-top:.2rem">' + esc(sub) + '</div>' : '') +
      '</div><button class="x" aria-label="Close">&times;</button></div>' +
      '<div class="drawer-bd">' + bodyHtml + '</div>';
    dr.querySelector('.x').onclick = closeDrawer;
    document.body.appendChild(scrim);
    document.body.appendChild(dr);
  }
  function kv(k, v, bad) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span>' +
      '<span class="v' + (bad ? ' bad' : '') + '">' + esc(v) + '</span></div>';
  }

  function permitAssessment(p) {
    if (p.assessment) return p.assessment;
    if (p.controls) return p.controls.map(function (c) { return { label: c, checked: true }; });
    return ((B.permit_checklists || {})[p.type] || []).map(function (c) { return { label: c, checked: false }; });
  }
  function openPermit(id) {
    var p = (B.permits || []).filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var m = minsLeft(p), h = '';
    if (p.denied_reason) h += '<div class="alert">' + esc(p.denied_reason) + '</div>';
    else if (p.status === 'pending') h += '<div class="alert" style="background:var(--warn-tt);border-color:var(--warn-br)"><strong>Awaiting approval.</strong> Nobody may start until it is signed.</div>';
    else if (p.status === 'active' && m <= 60) h += '<div class="alert"><strong>Expires ' + fmtTime(p.expires_at) + '.</strong> A crew may still be exposed.</div>';

    h += '<div class="sec-h">Where</div>' +
      kv('Site', jobName(p.job_id)) + kv('Location', p.location) +
      kv('Subcontractor', subName(p.sub_id));
    h += '<div class="sec-h">Who is covered</div>' +
      '<div class="small">' + esc(p.workers.join(', ')) + '</div>' +
      (p.attendant ? kv('Attendant', p.attendant) : '');

    var assess = permitAssessment(p);
    h += '<div class="sec-h">Risk assessment</div>' +
      assess.map(function (a) {
        return '<div class="bullet"><span class="m' + (a.checked ? '' : ' d') + '">' + (a.checked ? '✓' : '○') +
          '</span><span>' + esc(a.label) + '</span></div>';
      }).join('');

    // Delivery Activity — a SEPARATE section from the permit lifecycle below.
    // Shown only when this permit was digitally sent (a submitted send links to
    // it). Never merges Sent/Submitted with Requested/Issued/Expires/Closed.
    var pSend = (B.permit_sends || []).filter(function (s) { return s.submitted_at && s.permit_id === p.id; })[0];
    if (pSend) h += deliveryActivityHtml(pSend);

    h += '<div class="sec-h">Authorisation</div>' +
      kv('Requested by', p.requested_by) +
      (p.approver ? kv('Routed to', p.approver) : '') +
      kv('Approved by', p.approved_by || 'Not approved', !p.approved_by) +
      kv('Issued', fmtWhen(p.issued_at)) +
      kv('Expires', fmtWhen(p.expires_at), p.status === 'active' && m <= 60) +
      (p.signature ? kv('Electronic signature', p.signature.name + ' · ' + fmtWhen(p.signature.at)) : '') +
      (p.closed_at ? kv('Closed by', (p.closed_by || '—') + ' · ' + fmtWhen(p.closed_at)) : '');

    if (p.assignment_id) h += assignmentDeliveryHtml('permit', p.assignment_id);

    if (p.status === 'pending') {
      h += '<div class="sec-h">Authorise this permit</div>' +
        '<div class="small muted" style="margin-bottom:8px">Verify the controls are in place, then sign to activate. Deny to send it back.</div>' +
        '<div style="display:flex;gap:8px"><button class="btn btn-gold" id="pm-approve">Approve &amp; sign</button>' +
        '<button class="btn" id="pm-deny" style="color:var(--fail)">Deny</button></div>';
    } else if (p.status === 'active') {
      h += '<div class="sec-h">Close-out</div>' +
        '<div class="small muted" style="margin-bottom:8px">When the task is done and the area is made safe, close the permit to archive the audit record.</div>' +
        '<button class="btn" id="pm-close">Close permit</button>';
    } else if (p.status === 'closed') {
      h += '<div class="sec-h">Audit record</div><div class="small muted">Closed and archived — an immutable, timestamped record for regulatory or insurance audits.</div>';
    }

    drawer(permitLabel(p.type), p.location, h);
    var ap = $('#pm-approve');
    if (ap) ap.onclick = function () {
      var name = prompt('Type your name to sign and activate this permit:', p.approver || '');
      if (!name || !name.trim()) return;
      p.approved_by = name.trim();
      p.signature = { name: name.trim(), at: new Date().toISOString() };
      p.issued_at = new Date().toISOString();
      p.expires_at = new Date(Date.now() + (p.duration_min || 240) * 60000).toISOString();
      p.status = 'active';
      toast('Permit approved and active'); pgPermits(); openPermit(id);
    };
    var dn = $('#pm-deny');
    if (dn) dn.onclick = function () {
      var reason = prompt('Reason for denial:', '');
      if (reason === null) return;
      p.status = 'denied'; p.denied_reason = reason.trim() || 'Denied by the approver.';
      toast('Permit denied'); pgPermits(); openPermit(id);
    };
    var cl = $('#pm-close');
    if (cl) cl.onclick = function () {
      if (!confirm('Close this permit? This creates the final, timestamped audit record.')) return;
      p.status = 'closed'; p.closed_by = 'Safety'; p.closed_at = new Date().toISOString();
      toast('Permit closed — audit record saved'); pgPermits(); openPermit(id);
    };
  }

  function docIcon(name) {
    var n = (name || '').toLowerCase();
    if (/\.(jpg|jpeg|png|gif|heic|webp)$/.test(n)) return '🖼️';
    if (/\.(pdf)$/.test(n)) return '📄';
    if (/\.(docx?|txt|rtf)$/.test(n)) return '📝';
    if (/\.(xlsx?|csv)$/.test(n)) return '📊';
    return '📎';
  }
  // Everything an incident file typically comes with — seeded once, then the
  // operator keeps adding to it. Persists for the demo session.
  function seedIncidentDocs(i) {
    var out = [{ name: 'Incident Report — ' + i.id + '.pdf', added: i.date }];
    if (i.injured) {
      out.push({ name: 'First Report of Injury.pdf', added: i.date });
      if (i.osha_recordable) out.push({ name: 'OSHA 301 Incident Report.pdf', added: i.date });
    }
    (i.witnesses || []).forEach(function (w) {
      out.push({ name: 'Witness Statement — ' + w.name + '.pdf', added: i.date });
    });
    return out;
  }

  function openIncident(id) {
    var i = (B.incidents || []).filter(function (x) { return x.id === id; })[0];
    if (!i) return;
    var h = '<div style="display:flex;gap:8px;margin-bottom:12px">' +
      '<button class="btn btn-gold btn-sm" id="inc-edit">Edit / add details</button>' +
      '<button class="btn btn-sm" id="inc-301">OSHA 301 form</button></div>';
    h += '<div class="sec-h">What happened</div><div class="small">' + esc(i.description) + '</div>';
    h += '<div class="sec-h">Where and when</div>' +
      kv('Site', jobName(i.job_id)) + kv('Subcontractor', subName(i.sub_id)) +
      kv('Date', fmtDate(i.date) + ' ' + i.time);
    if (i.injured) {
      h += '<div class="sec-h">Injury</div>' +
        kv('Person', i.injured) + kv('Body part', i.body_part) + kv('Nature', i.nature) +
        kv('Days away', String(i.days_away)) + kv('Restricted days', String(i.restricted_days)) +
        kv('OSHA recordable', i.osha_recordable ? 'Yes, as determined by the employer' : 'No',
           i.osha_recordable);
    }
    h += '<div class="sec-h">Immediate action</div><div class="small">' + esc(i.immediate_action) + '</div>';
    h += '<div class="sec-h">Root cause</div><div class="small">' +
      (i.root_cause ? esc(i.root_cause)
        : '<span class="muted">Investigation open — assigned to ' + esc(i.investigator) + '.</span>') +
      '</div>';
    if (i.contributing && i.contributing.length) {
      h += '<div class="sec-h">Contributing factors</div>' + i.contributing.map(function (c) {
        return '<div class="bullet"><span class="m d">•</span><span>' + esc(c) + '</span></div>';
      }).join('');
    }
    if (i.witnesses && i.witnesses.length) {
      h += '<div class="sec-h">Witnesses</div>' + i.witnesses.map(function (w) {
        return '<div class="quote"><div class="small">“' + esc(w.statement) + '”</div>' +
          '<div class="by">' + esc(w.name) + ' · ' + esc(w.role) + '</div></div>';
      }).join('');
    }
    h += '<div class="sec-h">Corrective actions</div>' + i.corrective.map(function (ca) {
      return '<div class="ca"><div><div>' + esc(ca.action) + '</div>' +
        '<div class="small muted">' + esc(ca.owner) + ' · due ' + esc(fmtDate(ca.due)) + '</div></div>' +
        (ca.status === 'open' ? pill('p-warn', 'Open') : pill('p-ok', 'Closed')) + '</div>';
    }).join('');

    // Document file — upload and keep every file that comes from this incident.
    if (!i.docs) i.docs = seedIncidentDocs(i);
    h += '<div class="sec-h">Documents <span class="small muted" style="font-weight:400">· ' +
      i.docs.length + ' on file</span></div>' +
      '<div id="inc-docs">' + (i.docs.length ? i.docs.map(function (d, ix) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px">' +
          '<span style="font-size:16px;flex-shrink:0">' + docIcon(d.name) + '</span>' +
          '<div style="flex:1;min-width:0"><div class="t-main" style="font-size:13px;word-break:break-word">' + esc(d.name) + '</div>' +
          (d.added ? '<div class="t-sub">Added ' + fmtDate(d.added) + '</div>' : '') + '</div>' +
          '<button class="linklike" data-rmdoc="' + ix + '" style="color:var(--fail)">Remove</button></div>';
      }).join('') : '<div class="small muted" style="margin-bottom:6px">No documents yet.</div>') + '</div>' +
      '<input type="file" id="inc-files" multiple style="margin-top:4px;font-size:12.5px">' +
      '<button class="btn btn-gold btn-sm" id="inc-add" style="margin-top:8px">Add documents</button>' +
      '<p class="small muted" style="margin-top:.5rem">Reports, witness statements, photos, medical ' +
      'and OSHA forms — everything for this incident lives here.</p>';

    drawer(CLASS[i.classification] + (i.injured ? ' · ' + i.injured : ''),
           fmtDate(i.date) + ' · ' + jobName(i.job_id), h);

    var addBtn = $('#inc-add');
    if (addBtn) addBtn.onclick = function () {
      var files = ($('#inc-files') || {}).files;
      if (!files || !files.length) { toast('Choose a file to add first.'); return; }
      var today = new Date().toISOString().slice(0, 10);
      Array.prototype.forEach.call(files, function (f) { i.docs.push({ name: f.name, added: today }); });
      toast(files.length + ' document' + (files.length === 1 ? '' : 's') + ' added.');
      openIncident(i.id);
    };
    $$('.drawer [data-rmdoc]').forEach(function (b) {
      b.onclick = function () { i.docs.splice(+b.dataset.rmdoc, 1); openIncident(i.id); };
    });
    var ed = $('#inc-edit'); if (ed) ed.onclick = function () { openEditIncident(id); };
    var f301 = $('#inc-301'); if (f301) f301.onclick = function () { osha301(id); };
  }

  /* OSHA Form 301 — Injury and Illness Incident Report. Maps the incident record
     to the official 301 fields and prints it (Save as PDF). */
  function osha301(id) {
    var i = (B.incidents || []).filter(function (x) { return x.id === id; })[0];
    if (!i) return;
    function rw(k, v) { return '<div class="row"><span>' + esc(k) + '</span><span>' + esc(v || '—') + '</span></div>'; }
    var yn = function (b) { return b ? 'Yes' : 'No'; };
    var body =
      '<div class="sec">Information about the employee</div>' +
      rw('1. Full name', i.injured || '(no injury — near miss)') +
      rw('2. Street / city / state / ZIP', i.emp_address || '—') +
      rw('3. Date of birth', i.emp_dob || '—') +
      rw('4. Date hired', i.emp_hired || '—') +
      rw('5. Sex', i.emp_sex || '—') +
      '<div class="sec">Information about the physician or health care professional</div>' +
      rw('6. Name of physician / facility', i.treatment) +
      rw('7. Treated in an emergency room?', yn(i.emergency_room)) +
      rw('8. Hospitalized overnight as an in-patient?', yn(i.hospitalized)) +
      '<div class="sec">Information about the case</div>' +
      rw('10. Case number', i.id) +
      rw('11. Date of injury or illness', fmtDate(i.date)) +
      rw('13. Time of event', i.time || '—') +
      rw('14. What was the employee doing just before the incident?', i.emp_doing) +
      rw('15. What happened?', i.description) +
      rw('16. What was the injury or illness?',
        [i.body_part, i.nature].filter(Boolean).join(' — ') || '—') +
      rw('17. What object or substance directly harmed the employee?', i.harm_object) +
      rw('OSHA recordable (as determined by the employer)', yn(i.osha_recordable)) +
      rw('Days away from work', String(i.days_away || 0)) +
      rw('Days on job transfer or restriction', String(i.restricted_days || 0)) +
      '<div style="font-size:11.5px;color:#6b7280;margin-top:10px">OSHA Form 301 equivalent. ' +
      'Completed by ' + esc(i.investigator || 'Safety') + '. This demo compiles the record into ' +
      'the 301 layout; the live build produces the signed government form.</div>';
    printRecord('OSHA 301 — Injury & Illness Incident Report',
      CLASS[i.classification] + ' · ' + fmtDate(i.date) + ' · ' + jobName(i.job_id), body);
  }

  /* Desk investigation editor — fill in the record the field report opened:
     classification, injury detail, root cause, contributing factors, witnesses
     and corrective actions. Mutates the incident for the session. */
  function openEditIncident(id) {
    var i = (B.incidents || []).filter(function (x) { return x.id === id; })[0];
    if (!i) return;
    i.witnesses = i.witnesses || []; i.corrective = i.corrective || []; i.contributing = i.contributing || [];
    var ta = 'width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px';

    function render() {
      var h = '<div class="f"><label for="ei-class">Classification</label><select id="ei-class">' +
        [['first_aid', 'First aid'], ['recordable', 'OSHA recordable'], ['property', 'Property damage']]
          .map(function (o) { return '<option value="' + o[0] + '"' + (i.classification === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="f"><label for="ei-status">Status</label><select id="ei-status">' +
          '<option value="investigating"' + (i.status !== 'closed' ? ' selected' : '') + '>Investigating</option>' +
          '<option value="closed"' + (i.status === 'closed' ? ' selected' : '') + '>Closed</option></select></div>' +
        '<div class="sec-h">Injury</div>' +
        '<div class="f"><label for="ei-injured">Injured person</label>' +
          '<input type="text" id="ei-injured" value="' + esc(i.injured || '') + '"></div>' +
        '<div class="f"><label for="ei-body">Body part</label><input type="text" id="ei-body" value="' + esc(i.body_part || '') + '"></div>' +
        '<div class="f"><label for="ei-nature">Nature</label><input type="text" id="ei-nature" value="' + esc(i.nature || '') + '"></div>' +
        '<div style="display:flex;gap:8px"><div class="f" style="flex:1"><label for="ei-away">Days away</label>' +
          '<input type="number" id="ei-away" value="' + (i.days_away || 0) + '"></div>' +
          '<div class="f" style="flex:1"><label for="ei-restr">Restricted days</label>' +
          '<input type="number" id="ei-restr" value="' + (i.restricted_days || 0) + '"></div></div>' +
        '<label class="check" style="margin:2px 0 6px"><input type="checkbox" id="ei-rec"' + (i.osha_recordable ? ' checked' : '') + '>' +
          '<span>OSHA recordable (as determined by the employer)</span></label>' +
        '<div class="sec-h">Narrative</div>' +
        '<div class="f"><label for="ei-desc">What happened</label><textarea id="ei-desc" rows="3" style="' + ta + '">' + esc(i.description || '') + '</textarea></div>' +
        '<div class="f"><label for="ei-act">Immediate action</label><textarea id="ei-act" rows="2" style="' + ta + '">' + esc(i.immediate_action || '') + '</textarea></div>' +
        '<div class="f"><label for="ei-root">Root cause</label><textarea id="ei-root" rows="2" style="' + ta + '">' + esc(i.root_cause || '') + '</textarea></div>' +
        '<div class="f"><label for="ei-inv">Investigator</label><input type="text" id="ei-inv" value="' + esc(i.investigator || '') + '"></div>' +
        '<div class="f"><label for="ei-contrib">Contributing factors <span style="font-weight:400;text-transform:none">(one per line)</span></label>' +
          '<textarea id="ei-contrib" rows="3" style="' + ta + '">' + esc((i.contributing || []).join('\n')) + '</textarea></div>' +
        '<div class="sec-h">OSHA 301 detail</div>' +
        '<div class="f"><label for="ei-doing">What the employee was doing just before the incident</label>' +
          '<textarea id="ei-doing" rows="2" style="' + ta + '">' + esc(i.emp_doing || '') + '</textarea></div>' +
        '<div class="f"><label for="ei-harm">Object / substance that directly harmed the employee</label>' +
          '<input type="text" id="ei-harm" value="' + esc(i.harm_object || '') + '"></div>' +
        '<div class="f"><label for="ei-treat">Physician / treatment facility</label>' +
          '<input type="text" id="ei-treat" value="' + esc(i.treatment || '') + '"></div>' +
        '<label class="check" style="margin:2px 0"><input type="checkbox" id="ei-er"' + (i.emergency_room ? ' checked' : '') + '><span>Treated in an emergency room</span></label>' +
        '<label class="check" style="margin:2px 0 6px"><input type="checkbox" id="ei-hosp"' + (i.hospitalized ? ' checked' : '') + '><span>Hospitalized overnight as an in-patient</span></label>';

      h += '<div class="sec-h">Witnesses</div><div id="ei-wit">';
      i.witnesses.forEach(function (w, ix) {
        h += '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px">' +
          '<div style="display:flex;gap:8px"><input class="ei-wname" data-i="' + ix + '" placeholder="Name" value="' + esc(w.name || '') + '" style="flex:1">' +
          '<input class="ei-wrole" data-i="' + ix + '" placeholder="Role" value="' + esc(w.role || '') + '" style="flex:1">' +
          '<button class="linklike" data-rmwit="' + ix + '" style="color:var(--fail)">×</button></div>' +
          '<textarea class="ei-wstmt" data-i="' + ix + '" rows="2" placeholder="Statement" style="' + ta + ';margin-top:6px">' + esc(w.statement || '') + '</textarea></div>';
      });
      h += '</div><button class="btn btn-sm" id="ei-addwit">+ Add witness</button>';

      h += '<div class="sec-h">Corrective actions</div><div id="ei-ca">';
      i.corrective.forEach(function (c, ix) {
        h += '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px">' +
          '<textarea class="ei-caact" data-i="' + ix + '" rows="2" placeholder="Corrective action" style="' + ta + '">' + esc(c.action || '') + '</textarea>' +
          '<div style="display:flex;gap:8px;margin-top:6px"><input class="ei-caown" data-i="' + ix + '" placeholder="Owner" value="' + esc(c.owner || '') + '" style="flex:1">' +
          '<input type="date" class="ei-cadue" data-i="' + ix + '" value="' + esc(c.due || '') + '" style="flex:1">' +
          '<select class="ei-castat" data-i="' + ix + '"><option value="open"' + (c.status !== 'closed' ? ' selected' : '') + '>Open</option><option value="closed"' + (c.status === 'closed' ? ' selected' : '') + '>Closed</option></select>' +
          '<button class="linklike" data-rmca="' + ix + '" style="color:var(--fail)">×</button></div></div>';
      });
      h += '</div><button class="btn btn-sm" id="ei-addca">+ Add corrective action</button>';

      h += '<div style="margin-top:16px"><button class="btn btn-gold" id="ei-save" style="width:100%;justify-content:center">Save details</button>' +
        '<button class="btn" id="ei-back" style="width:100%;justify-content:center;margin-top:8px">Cancel</button></div>';
      drawer('Edit incident', CLASS[i.classification] + ' · ' + fmtDate(i.date), h);
      wire();
    }
    function wire() {
      // simple fields update the incident live
      bind('ei-class', function (v) { i.classification = v; });
      bind('ei-status', function (v) { i.status = v; });
      bind('ei-injured', function (v) { i.injured = v.trim() || null; });
      bind('ei-body', function (v) { i.body_part = v; });
      bind('ei-nature', function (v) { i.nature = v; });
      bind('ei-away', function (v) { i.days_away = +v || 0; });
      bind('ei-restr', function (v) { i.restricted_days = +v || 0; });
      bind('ei-desc', function (v) { i.description = v; });
      bind('ei-act', function (v) { i.immediate_action = v; });
      bind('ei-root', function (v) { i.root_cause = v; });
      bind('ei-inv', function (v) { i.investigator = v; });
      bind('ei-contrib', function (v) { i.contributing = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); });
      bind('ei-doing', function (v) { i.emp_doing = v; });
      bind('ei-harm', function (v) { i.harm_object = v; });
      bind('ei-treat', function (v) { i.treatment = v; });
      var rec = $('#ei-rec'); if (rec) rec.onchange = function () { i.osha_recordable = rec.checked; };
      var er = $('#ei-er'); if (er) er.onchange = function () { i.emergency_room = er.checked; };
      var hosp = $('#ei-hosp'); if (hosp) hosp.onchange = function () { i.hospitalized = hosp.checked; };
      $$('.ei-wname').forEach(function (e) { e.oninput = function () { i.witnesses[+e.dataset.i].name = e.value; }; });
      $$('.ei-wrole').forEach(function (e) { e.oninput = function () { i.witnesses[+e.dataset.i].role = e.value; }; });
      $$('.ei-wstmt').forEach(function (e) { e.oninput = function () { i.witnesses[+e.dataset.i].statement = e.value; }; });
      $$('.ei-caact').forEach(function (e) { e.oninput = function () { i.corrective[+e.dataset.i].action = e.value; }; });
      $$('.ei-caown').forEach(function (e) { e.oninput = function () { i.corrective[+e.dataset.i].owner = e.value; }; });
      $$('.ei-cadue').forEach(function (e) { e.onchange = function () { i.corrective[+e.dataset.i].due = e.value; }; });
      $$('.ei-castat').forEach(function (e) { e.onchange = function () { i.corrective[+e.dataset.i].status = e.value; }; });
      $$('[data-rmwit]').forEach(function (b) { b.onclick = function () { i.witnesses.splice(+b.dataset.rmwit, 1); render(); }; });
      $$('[data-rmca]').forEach(function (b) { b.onclick = function () { i.corrective.splice(+b.dataset.rmca, 1); render(); }; });
      var aw = $('#ei-addwit'); if (aw) aw.onclick = function () { i.witnesses.push({ name: '', role: '', statement: '' }); render(); };
      var ac = $('#ei-addca'); if (ac) ac.onclick = function () { i.corrective.push({ action: '', owner: i.investigator || '', due: new Date().toISOString().slice(0, 10), status: 'open' }); render(); };
      var bk = $('#ei-back'); if (bk) bk.onclick = function () { openIncident(id); };
      var sv = $('#ei-save'); if (sv) sv.onclick = function () { toast('Incident details saved.'); openIncident(id); };
      function bind(elId, fn) { var e = $('#' + elId); if (e) e.oninput = e.onchange = function () { fn(e.value); }; }
    }
    render();
  }

  function openSub(id) {
    var x = (B.scorecard || []).filter(function (r) { return r.sub.id === id; })[0];
    if (!x) return;
    var s = x.sub;
    var h = '';
    // Open findings for this sub — overdue / soonest-due first.
    var open = (B.findings || []).filter(function (f) { return f.sub_id === s.id && f.status === 'open'; })
      .sort(function (a, b) { return new Date(a.due) - new Date(b.due); });

    h += '<div style="margin-bottom:14px"><button class="btn btn-sm" id="sub-edit-btn">Edit subcontractor</button></div>';

    // 1. CLEARANCE — status up top, then the four gate details.
    if (!x.cleared) {
      var GATE_NAMES = { program: 'written safety program', emr: 'EMR',
                         training: 'crew training', competent: 'competent persons' };
      h += '<div class="alert"><strong>Not cleared to work.</strong> ' +
        'Failing: ' + esc(x.failed_gates.map(function (g) {
          return GATE_NAMES[g] || g; }).join(', ')) + '.</div>';
    } else {
      h += '<div style="background:var(--ok-tt);border:1px solid var(--ok-br);padding:11px 13px;' +
        'border-radius:7px;font-size:13px;line-height:1.5;color:var(--ink-2);margin-bottom:8px">' +
        '<strong style="color:var(--ok)">Cleared to work.</strong> All four prequalification gates pass.</div>';
    }
    h += '<div class="sec-h">Clearance</div>' +
      kv('Written safety program', s.program_on_file ? 'On file' : 'Not received', !s.program_on_file) +
      kv('EMR', (s.emr == null ? 'Not on file' : s.emr.toFixed(2)) + ' · company requirement ≤ 1.20', !x.gates.emr) +
      kv('Crew training current', s.training_pct + '%', !x.gates.training) +
      kv('Competent persons', x.missing_cp.length ? 'Missing: ' + x.missing_cp.join(', ')
                                                  : s.competent_named.join(', '), !x.gates.competent);

    // 2. CURRENT JOB READINESS — orientation, who is on site, which jobs.
    h += '<div class="sec-h">Current job readiness</div>' +
      kv('Site orientation', s.orientation_pct + '% of crew', s.orientation_pct < 90) +
      kv('Workers on site now', String(s.workers_on_site)) +
      kv('Jobs', s.jobs.map(jobName).join(', '));

    // 3. SAFETY PERFORMANCE — trailing 12 months.
    h += '<div class="sec-h">Safety performance — trailing 12 months</div>' +
      kv('Recordables', String(s.recordables_12mo)) +
      kv('TRIR', x.trir === null ? '—' : x.trir.toFixed(2)) +
      kv('Hours worked', s.hours_12mo.toLocaleString()) +
      kv('Findings open / total', x.open + ' / ' + x.findings) +
      (x.avg_close_days !== null ? kv('Average days to close', String(x.avg_close_days)) : '');

    // 4. OPEN FINDINGS — the records themselves, overdue first.
    if (open.length) {
      h += '<div class="sec-h">Open findings</div>';
      h += open.map(function (f) {
        var late = new Date(f.due) < new Date();
        return '<div class="alert"><div>' + esc(f.description) + '</div>' +
          '<div class="small muted" style="margin-top:.3rem">' + esc(jobName(f.job_id)) +
          ' · due ' + esc(fmtDate(f.due)) + (late ? ' · OVERDUE' : '') + '</div></div>';
      }).join('');
    }
    /* their crew, and the crew's own training — SUB training lives here,
       never on the company Training tab */
    h += '<div class="sec-h">Crew & training' +
      ((s.crew || []).length ? ' <span class="small muted" style="font-weight:400">· ' +
        s.crew.length + ' · tap a name for the full record</span>' : '') + '</div>';
    h += '<div style="margin:0 0 10px"><button class="btn btn-sm" id="sub-addemp-btn">+ Add employee</button></div>';
    if ((s.crew || []).length) {
      s.crew.forEach(function (w) {
        var certBits = (w.certs || []).map(function (c) {
          if (!c.exp) return esc(c.t);
          var dd = Math.round((new Date(c.exp + 'T12:00:00') - new Date()) / 86400000);
          return esc(c.t) + (dd < 0
            ? ' <span style="color:var(--fail);font-weight:700">(expired)</span>'
            : dd <= 60 ? ' <span style="color:var(--warn);font-weight:600">(' + dd + 'd)</span>' : '');
        }).join(' · ');
        h += '<div class="kv click" data-emp="' + esc(s.id) + '|' + esc(w.name) + '" style="cursor:pointer">' +
          '<span class="k" style="color:var(--ink)">' + esc(w.name) +
          '<div class="small muted">' + esc(w.role) + '</div></span>' +
          '<span class="v" style="font-weight:400;font-size:12px">' +
          (certBits || '<span style="color:var(--fail);font-weight:600">No training on file</span>') +
          '</span></div>';
      });
    } else {
      h += '<div class="small muted">No crew on file yet.</div>';
    }
    /* what we sent them, and what came back */
    var sent = (B.invites || []).filter(function (v) { return v.sub_id === s.id; });
    var done = CREW.filter(function (r) { return r.sub_id === s.id; });
    h += '<div class="sec-h">Field activity</div>';
    if (!sent.length && !done.length) {
      h += '<div class="small muted">Nothing sent, nothing submitted.</div>';
    }
    sent.forEach(function (v) {
      h += '<div class="kv"><span class="k">' + esc(v.templates.join(', ')) +
        '<div class="small muted">Sent to ' + esc(v.name) + ' · ' + esc(fmtWhen(v.sent_at)) + '</div></span>' +
        (v.status === 'completed' ? pill('p-ok', 'Completed') : pill('p-warn', 'Awaiting')) + '</div>';
    });
    done.forEach(function (r) {
      h += '<div class="kv"><span class="k">' + esc(r.inspection_subtype || r.form_type) +
        '<div class="small muted">' + esc(r.inspector_name) + ' · ' + esc(fmtDate(r.inspection_date)) +
        ' · ' + esc(r.jobsite) + '</div></span>' +
        (r.has_defects ? pill('p-bad', r.defect_count + ' defect' + (r.defect_count === 1 ? '' : 's'))
                       : pill('p-ok', 'Clear')) + '</div>';
    });
    // Documents — upload and keep every file for this sub (COI, EMR, program, W-9…).
    if (!s.files) s.files = [];
    h += '<div class="sec-h">Documents <span class="small muted" style="font-weight:400">· ' +
      s.files.length + ' on file</span></div>';
    h += '<div id="sub-docs">';
    if (!s.files.length) {
      h += '<div class="small" style="color:var(--fail);font-weight:600;margin-bottom:6px">Nothing on file — ' +
        'no COI, no written program, no EMR letter.</div>';
    }
    s.files.forEach(function (f2, ix) {
      h += '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px">' +
        '<span style="font-size:16px;flex-shrink:0">' + docIcon(f2.name) + '</span>' +
        '<div style="flex:1;min-width:0"><div class="t-main" style="font-size:13px;word-break:break-word">' + esc(f2.name) + '</div>' +
        '<div class="t-sub">Uploaded ' + esc(fmtDate(f2.up)) + '</div></div>' +
        '<button class="linklike" data-rmsubdoc="' + ix + '" style="color:var(--fail)">Remove</button></div>';
    });
    h += '</div>' +
      '<input type="file" id="sub-files" multiple style="margin-top:4px;font-size:12.5px">' +
      '<button class="btn btn-gold btn-sm" id="sub-add" style="margin-top:8px">Add documents</button>';

    h += '<div class="sec-h">Contact</div>' +
      kv(s.contact_name, s.contact_phone) + kv('Email', s.contact_email);
    drawer(s.name, s.trade, h);
    $('#sub-edit-btn').onclick = function () { openSubForm(id); };
    $('#sub-addemp-btn').onclick = function () { openEmpForm(id, null); };
    $$('.drawer [data-emp]').forEach(function (b) {
      b.onclick = function () { var p = b.dataset.emp.split('|'); openEmployee(p[0], p[1]); };
    });
    var addB = $('#sub-add');
    if (addB) addB.onclick = function () {
      var files = ($('#sub-files') || {}).files;
      if (!files || !files.length) { toast('Choose a file to add first.'); return; }
      var today = new Date().toISOString().slice(0, 10);
      Array.prototype.forEach.call(files, function (f2) { s.files.push({ name: f2.name, up: today }); });
      toast(files.length + ' document' + (files.length === 1 ? '' : 's') + ' added.');
      openSub(id);
    };
    $$('.drawer [data-rmsubdoc]').forEach(function (b) {
      b.onclick = function () { s.files.splice(+b.dataset.rmsubdoc, 1); openSub(id); };
    });
  }

  /* ====================== paint + delegation ============================ */
  // Permissions concept (demo representation — not production authorization).
  // Company roles see different scopes; the switcher makes the concept visible.
  var ROLES = {
    admin: { user: 'Paul Greiner', title: 'Company Safety Admin', scope: 'Full visibility across all Greiner jobs, employees and analytics.' },
    mgmt:  { user: 'Tony Greiner', title: 'Company Management', scope: 'Company-level visibility across all jobs and reporting.' },
    super: { user: 'Dave Kruse', title: 'Superintendent', scope: 'Limited to assigned jobs: Purdue Academic Building, Community Health North.' },
    field: { user: 'Field crew', title: 'Field User', scope: 'Assigned field forms only — no company dashboard.' }
  };
  var ROLE = 'admin';
  function roleBanner() {
    var r = ROLES[ROLE] || ROLES.admin;
    return '<div class="role-banner"><span class="role-chip">' + esc(r.title) + '</span>' +
      '<span>' + esc(r.user) + ' · ' + esc(r.scope) + '</span>' +
      '<span class="role-demo">Demo permission representation</span></div>';
  }
  var DEMO_BANNER = '<div class="demo-banner"><b>' + esc((C.brand || 'Greiner Brothers')) +
    '</b> on the ' + esc(C.poweredBy || 'NextGen Safety') + ' platform · <b>Imported Safety 101 inspections are real Greiner history</b>; ' +
    'other records are demonstration samples. Fully configurable to Greiner’s program.</div>';
  function paint(html) {
    MASS = null;
    var sb = $('#selbar'); if (sb) sb.remove();
    $('#main').innerHTML = html;
    $$('[data-permit]').forEach(function (r) {
      r.onclick = function () { openPermit(r.dataset.permit); };
    });
    $$('[data-inc]').forEach(function (r) {
      r.onclick = function () { openIncident(r.dataset.inc); };
    });
    $$('[data-sub]').forEach(function (r) {
      r.onclick = function () { openSub(r.dataset.sub); };
    });
    $$('[data-goto]').forEach(function (b) {
      b.onclick = function () { go(b.dataset.goto); };
    });
    $$('[data-job]').forEach(function (r) {
      r.onclick = function () { openJob(r.dataset.job); };
    });
    $$('[data-report]').forEach(function (r) {
      r.onclick = function () { openReport(r.dataset.report); };
    });
    $$('[data-crewi]').forEach(function (r) {
      r.onclick = function () { openCrewInsp(r.dataset.crewi); };
    });
    $$('[data-invite]').forEach(function (r) {
      r.onclick = function () { openSentLink(r.dataset.invite); };
    });
    $$('[data-asg]').forEach(function (r) {
      r.onclick = function () { var p = r.dataset.asg.split('|'); openAssignment(p[0], p[1]); };
    });
    $$('[data-talk]').forEach(function (r) {
      r.onclick = function () { openTalk(r.dataset.talk); };
    });
    $$('[data-person]').forEach(function (r) {
      r.onclick = function () { openPerson(r.dataset.person); };
    });
    $$('[data-editca]').forEach(function (r) {
      r.onclick = function (e) { e.stopPropagation(); openCA(r.dataset.editca); };
    });
    $$('.msel').forEach(function (cb) {
      cb.onclick = function (e) { e.stopPropagation(); };
      cb.onchange = updateSelbar;
    });
  }

  /* Download PDF: build a real PDF file with jsPDF (loaded on demand) and save
     it straight to the user's downloads — no preview window. Falls back to the
     print window if jsPDF can't load (offline). All Download-PDF buttons and
     combined exports funnel through printRecord, so this covers every tab. */
  var jspdfReady = null;
  function loadJsPDF() {
    if (jspdfReady) return jspdfReady;
    jspdfReady = new Promise(function (res, rej) {
      if (window.jspdf) return res(window.jspdf);
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
      s.onload = function () { res(window.jspdf); };
      s.onerror = function () { rej(new Error('offline')); };
      document.head.appendChild(s);
    });
    return jspdfReady;
  }
  function htmlToBlocks(html) {
    var out = [];
    var d = new DOMParser().parseFromString('<div id="_r">' + html + '</div>', 'text/html');
    var root = d.getElementById('_r'); if (!root) return out;
    Array.prototype.forEach.call(root.children, function (e) {
      var cls = e.className || '', style = e.getAttribute('style') || '';
      if (/page-break-before/.test(style)) { out.push({ k: 'pb' }); return; }
      if (e.tagName === 'H2') { out.push({ k: 'h2', t: e.textContent.trim() }); return; }
      if (/\bsec\b/.test(cls)) { out.push({ k: 'sec', t: e.textContent.trim() }); return; }
      if (/\brow\b/.test(cls)) {
        var sp = e.querySelectorAll('span');
        out.push({ k: 'row', l: sp[0] ? sp[0].textContent.trim() : e.textContent.trim(),
          r: sp[1] ? sp[1].textContent.trim() : '', c: sp[1] ? (sp[1].className || '') : '' });
        return;
      }
      if (/\bfix\b/.test(cls)) {
        var who = e.querySelector('.who'), w = who ? who.textContent.trim() : '', m = e.textContent.trim();
        if (w) m = m.slice(0, m.length - w.length).trim();
        out.push({ k: 'fix', t: m, w: w }); return;
      }
      var txt = e.textContent.trim(); if (txt) out.push({ k: 'text', t: txt });
    });
    return out;
  }
  function pdfChipColor(c) {
    if (/ok/.test(c)) return '#047857';
    if (/bad/.test(c)) return '#991b1b';
    if (/na/.test(c)) return '#9ca3af';
    return '#1f2937';
  }
  function pdfSave(title, sub, bodyHtml, opts) {
    opts = opts || {};
    return loadJsPDF().then(function (ns) {
      var doc = new ns.jsPDF({ unit: 'pt', format: 'letter' });
      var PW = 612, PH = 792, M = 46, W = PW - M * 2, y = 0, INK = '#1f2937', GREY = '#6b7280', LINE = '#e5e7eb';
      var BRAND = C.brand || (B.company && B.company.name) || C.contractor || 'Safety';
      function setF(sz, b, col) { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(sz); doc.setTextColor(col || INK); }
      function ensure(h) { if (y + h > PH - 52) { doc.addPage(); y = M; } }
      // Header band — brand on the right, wrapped title on the left (no collision).
      doc.setFillColor('#1e3a8a'); doc.rect(0, 0, PW, 76, 'F');
      setF(9, true, '#ffffff'); doc.text(BRAND, PW - M, 30, { align: 'right' });
      setF(7.5, false, '#c7d2fe'); doc.text('Generated from ' + BRAND + ' Demo', PW - M, 44, { align: 'right' });
      setF(15, true, '#ffffff');
      var ht = doc.splitTextToSize(String(title || ''), W - 150);
      doc.text(ht[0], M, 30);
      setF(9, false, '#c7d2fe'); doc.text(String(sub || ''), M, 50);
      y = 92;
      // Banner. Imported Safety 101 records are REAL Greiner history — they get a
      // source-record banner, never a "demonstration data" label. Fictional
      // serious records get a red variant; everything else is demo/sample.
      var strong = !!opts.fictional;
      if (opts.imported) {
        doc.setFillColor('#ecfdf5'); doc.setDrawColor('#a7f3d0');
        doc.roundedRect(M, y, W, 30, 4, 4, 'FD');
        setF(10, true, '#047857'); doc.text('IMPORTED SAFETY 101 SOURCE RECORD', M + 10, y + 13);
        setF(7.5, false, '#059669'); doc.text('Imported into the ' + BRAND + ' demonstration environment', M + 10, y + 24);
      } else {
        doc.setFillColor(strong ? '#fef2f2' : '#fffbeb'); doc.setDrawColor(strong ? '#fecaca' : '#fde68a');
        doc.roundedRect(M, y, W, 30, 4, 4, 'FD');
        setF(10, true, strong ? '#991b1b' : '#92400e');
        doc.text(strong ? 'DEMO DOCUMENT · FICTIONAL SAMPLE DATA' : 'DEMO DOCUMENT', M + 10, y + 13);
        setF(7.5, false, strong ? '#b91c1c' : '#a16207');
        doc.text(strong ? 'Illustrative scenario generated by the ' + BRAND + ' demo — not an actual safety record or event.'
                        : 'Demonstration data · Not an official safety record', M + 10, y + 24);
      }
      y += 46;
      htmlToBlocks(bodyHtml).forEach(function (b) {
        if (b.k === 'pb') { doc.addPage(); y = M; return; }
        if (b.k === 'h2') { ensure(26); y += 8; setF(14, true, INK); doc.text(b.t, M, y); y += 16; return; }
        if (b.k === 'sec') { ensure(22); y += 10; setF(8.5, true, GREY); doc.text(b.t.toUpperCase(), M, y); y += 4;
          doc.setDrawColor(LINE); doc.line(M, y, PW - M, y); y += 11; return; }
        if (b.k === 'row') {
          setF(10, false, INK);
          var lines = doc.splitTextToSize(b.l, b.r ? W - 140 : W);
          ensure(lines.length * 13 + 4);
          for (var i = 0; i < lines.length; i++) doc.text(lines[i], M, y + i * 13);
          if (b.r) { setF(10, true, pdfChipColor(b.c)); doc.text(b.r, PW - M, y, { align: 'right' }); }
          y += lines.length * 13 + 5; return;
        }
        if (b.k === 'fix') {
          setF(9.5, false, INK);
          var fl = doc.splitTextToSize(b.t, W - 16);
          ensure(fl.length * 12 + 20);
          doc.setFillColor('#f8fafc'); doc.rect(M, y - 9, W, fl.length * 12 + (b.w ? 16 : 8), 'F');
          for (var j = 0; j < fl.length; j++) doc.text(fl[j], M + 8, y + j * 12);
          y += fl.length * 12;
          if (b.w) { setF(8, false, GREY); doc.text(b.w, M + 8, y + 4); y += 12; }
          y += 8; return;
        }
        setF(10, false, INK);
        var tl = doc.splitTextToSize(b.t, W);
        ensure(tl.length * 13 + 4);
        for (var k = 0; k < tl.length; k++) doc.text(tl[k], M, y + k * 13);
        y += tl.length * 13 + 4;
      });
      var fname = (String(title || 'record').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'record') + '.pdf';
      // Footer + page numbers on every page.
      var pages = doc.getNumberOfPages();
      var gen = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      for (var pg = 1; pg <= pages; pg++) {
        doc.setPage(pg); doc.setDrawColor(LINE); doc.line(M, PH - 36, PW - M, PH - 36);
        setF(8, false, GREY);
        doc.text(BRAND + ' Demo', M, PH - 24);
        doc.text('Page ' + pg + ' of ' + pages, PW / 2, PH - 24, { align: 'center' });
        doc.text('Generated ' + gen, PW - M, PH - 24, { align: 'right' });
      }
      doc.save(fname);
    });
  }
  function printRecord(title, sub, bodyHtml, opts) {
    pdfSave(title, sub, bodyHtml, opts).catch(function () { printRecordWindow(title, sub, bodyHtml); });
  }
  function printRecordWindow(title, sub, bodyHtml) {
    var w = window.open('', '_blank');
    if (!w) { toast('Pop-up blocked — allow pop-ups to export.'); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(title) + '</title><style>' +
      'body{font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;margin:40px auto;max-width:720px;padding:0 20px}' +
      'h1{font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0}' +
      '.sub{color:#6b7280;font-size:12px;margin:4px 0 0}' +
      '.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a8a;padding-bottom:14px;margin-bottom:20px}' +
      '.co{font-weight:700;font-size:13px;text-align:right;color:#1e3a8a}' +
      '.sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;margin:18px 0 6px}' +
      '.row{display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:12.5px}' +
      '.chip{font-weight:700}.ok{color:#047857}.bad{color:#991b1b}.na{color:#9ca3af}' +
      '.fix{background:#f8fafc;border-left:3px solid #047857;padding:8px 10px;margin:6px 0 10px;font-size:12px}' +
      '.fix .who{color:#6b7280;margin-top:2px}' +
      '.noprint{position:fixed;top:12px;right:12px}.noprint button{padding:8px 14px;font-weight:600}' +
      '.foot{margin-top:28px;padding-top:10px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:10.5px}' +
      '@media print{.noprint{display:none}}' +
      '</style></head><body>' +
      '<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>' +
      '<div class="hd"><div><h1>' + esc(title) + '</h1><div class="sub">' + esc(sub) + '</div></div>' +
      '<div class="co">' + esc((B.company && B.company.name) || '') +
      '<br><span style="color:#6b7280;font-weight:400">Safety Dashboard</span></div></div>' +
      bodyHtml +
      '<div class="foot">Generated ' + new Date().toLocaleDateString('en-US',
        { month: 'long', day: 'numeric', year: 'numeric' }) + '</div>' +
      '</body></html>');
    w.document.close();
  }
  function pdfBtn(id) {
    return '<button class="btn btn-sm" id="' + id + '" style="margin-bottom:14px">Download PDF</button>';
  }

  /* ---------- mass select ------------------------------------------------
     Checkbox a few rows, one button, one combined PDF with page breaks —
     the same motion as the Creekside and legacy demo dashboards. */
  var MASS = null;
  function massInit(spec) { MASS = spec; updateSelbar(); }
  function updateSelbar() {
    var bar = $('#selbar');
    var n = $$('.msel:checked').length;
    if (!n || !MASS) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = el('div'); bar.id = 'selbar'; bar.className = 'selbar';
      document.body.appendChild(bar);
    }
    bar.innerHTML = '<span class="num">' + n + ' selected</span>' +
      '<button class="btn btn-gold btn-sm" id="selgo">' + esc(MASS.label) + '</button>';
    $('#selgo').onclick = function () {
      MASS.run($$('.msel:checked').map(function (cb) { return cb.dataset.mid; }));
    };
  }
  function selCell(id) {
    return '<td class="selcol"><input type="checkbox" class="msel" data-mid="' + esc(id) + '"></td>';
  }
  function combinedPrint(title, parts) {
    printRecord(title, parts.length + ' records',
      parts.map(function (pt) {
        return '<h2 style="font-family:Georgia,serif;font-weight:400;font-size:19px;margin:0 0 1px">' +
          esc(pt.title) + '</h2><div style="color:#6b7280;font-size:11.5px;margin-bottom:8px">' +
          esc(pt.sub) + '</div>' + pt.body;
      }).join('<div style="page-break-before:always"></div>'));
  }

  /* ---------- corrective actions: one editor for every source -----------
     A corrective action can live on a report line, a finding, an incident or
     a crew inspection defect. Same editor for all four: what is being done,
     who owns it, open or closed, photos of the fix. Edits persist for the
     demo session. */
  // Shared SOURCE line: "<record type> · <job> · <date>" with no dangling
  // separators — parts that are unavailable are simply omitted.
  function srcLine(parts) {
    return parts.filter(function (x) { return x && x !== '—'; }).join(' · ');
  }
  function catLabel(c) {
    if (!c) return '';
    var n = catName(c);
    return String(n).replace(/[_-]+/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
  function caResolve(ref) {
    var p = ref.split('|');
    if (p[0] === 'rfix') {
      var r = (B.reports || []).filter(function (x) { return x.id === p[1]; })[0];
      if (!r) return null;
      var label = '';
      ((r.fields || {}).sections || []).forEach(function (s) {
        (s.items || []).forEach(function (it) { if (it.id === p[2]) label = it.label; });
      });
      if (!r.fixes[p[2]]) r.fixes[p[2]] = { action: '', owner: '', status: 'open' };
      var fx = r.fixes[p[2]];
      return { context: label, demo: true,
        where: srcLine([r.report_type || 'Site Safety Report', jobName(r.job_id), repDateDisp(r)]),
        get: function () { return fx; },
        set: function (v) { fx.action = v.action; fx.owner = v.owner;
                            fx.status = v.status; fx.photos = v.photos; } };
    }
    if (p[0] === 'find') {
      var f = (B.findings || []).filter(function (x) { return x.id === p[1]; })[0];
      if (!f) return null;
      var obs = f.observation || f.description || '';
      var fget = function () { return { action: f.corrective || '', owner: subName(f.sub_id),
        status: f.status === 'closed' ? 'closed' : 'open', photos: f.photos_list || [] }; };
      var fset = function (v) { f.corrective = v.action; f.status = v.status;
        f.closed = v.status === 'closed' ? new Date().toISOString().slice(0, 10) : null;
        f.photos_list = v.photos; };
      if (f.imported) {
        // Real imported Safety 101 finding — resolve its true source report.
        var sr = (B.reports || []).filter(function (x) { return x.id === f.source_report; })[0];
        var stype = (sr && sr.report_type) || 'Safety Observation';
        var sdate = (sr && sr.report_date) || f.date;
        return { context: obs, category: f.cat, imported: true,
          where: srcLine([stype, jobName(f.job_id), fmtDate(sdate)]),
          get: fget, set: fset, ownerLocked: true };
      }
      return { context: obs, category: catLabel(f.cat), demo: true,
        where: srcLine(['Site Safety Finding', jobName(f.job_id), fmtDate(f.date)]),
        get: fget, set: fset, ownerLocked: true };
    }
    if (p[0] === 'inc') {
      var i = (B.incidents || []).filter(function (x) { return x.id === p[1]; })[0];
      var ca = i && i.corrective[+p[2]];
      if (!ca) return null;
      return { context: i.description, demo: true,
        where: srcLine([CLASS[i.classification] || 'Incident', jobName(i.job_id), fmtDate(i.date)]),
        get: function () { return { action: ca.action, owner: ca.owner,
          status: ca.status, photos: ca.photos || [] }; },
        set: function (v) { ca.action = v.action; ca.owner = v.owner;
                            ca.status = v.status; ca.photos = v.photos; } };
    }
    if (p[0] === 'reg') {
      var rv = (B.reg_visits || []).filter(function (x) { return x.id === p[1]; })[0];
      var ab = rv && rv.abatement[+p[2]];
      if (!ab) return null;
      return { context: 'Abatement — ' + rv.agency + ' visit, ' + fmtDate(rv.date), demo: true,
        where: srcLine([rv.agency + ' Visit', jobName(rv.job_id), fmtDate(rv.date)]),
        get: function () { return { action: ab.action, owner: ab.owner,
          status: ab.status, photos: ab.photos || [] }; },
        set: function (v) { ab.action = v.action; ab.owner = v.owner;
                            ab.status = v.status; ab.photos = v.photos; } };
    }
    if (p[0] === 'crew') {
      var c = CREW.filter(function (x) { return x.id === p[1]; })[0];
      var dft = c && (c.defects || [])[+p[2]];
      if (!dft) return null;
      return { context: dft.label, demo: true,
        where: srcLine([c.inspection_subtype || c.form_type || 'Equipment Inspection', c.jobsite, c.asset_id, fmtDate(c.inspection_date)]),
        get: function () { return { action: dft.action || '', owner: dft.owner ||
          (c.sub_id ? subName(c.sub_id) : c.inspector_name), status: dft.status,
          photos: dft.photos || [] }; },
        set: function (v) { dft.action = v.action; dft.owner = v.owner;
                            dft.status = v.status; dft.photos = v.photos; } };
    }
    return null;
  }

  function openCA(ref) {
    var res = caResolve(ref);
    if (!res) return;
    var cur = res.get();
    var badge = res.imported ? ' <span class="src-badge">Imported Safety 101</span>'
              : (res.demo ? ' <span class="demo-sample-badge">Demo Sample</span>' : '');
    var h = '<div class="f"><label>Source</label>' +
      '<div style="font-size:13.5px;color:var(--ink-2)">' + esc(res.where) + badge + '</div></div>' +
      (res.context
        ? '<div class="f"><label>Source observation / finding' + (res.category ? ' · ' + esc(res.category) : '') + '</label>' +
          '<div class="alert" style="background:#f8fafc;border-color:var(--line-2);color:var(--ink-2)">' + esc(res.context) + '</div></div>'
        : '') +
      '<div class="f"><label for="ca-act">Corrective action</label>' +
      '<textarea id="ca-act" rows="3" placeholder="Describe corrective action taken…" style="width:100%;padding:8px 11px;border:1px solid var(--line-2);border-radius:7px;background:#fafbfc;font-size:13.5px">' +
      esc(cur.action) + '</textarea></div>' +
      '<div class="f"><label for="ca-own">Owner</label>' +
      '<input type="text" id="ca-own" value="' + esc(cur.owner) + '"' +
      (res.ownerLocked ? ' disabled' : '') + '></div>' +
      '<div class="f"><label for="ca-st">Status</label><select id="ca-st">' +
      '<option value="open"' + (cur.status === 'open' ? ' selected' : '') + '>Open</option>' +
      '<option value="closed"' + (cur.status === 'closed' ? ' selected' : '') + '>Closed — verified</option>' +
      '</select></div>' +
      '<div class="f"><label>Photos of the fix</label>' +
      '<div id="ca-plist">' + (cur.photos || []).map(function (ph) {
        return '<span class="photochip">📷 ' + esc(ph) + '</span>';
      }).join('') + '</div>' +
      '<input type="file" id="ca-photos" multiple accept="image/*" style="margin-top:6px;font-size:12.5px"></div>' +
      '<p class="small" id="ca-err" style="color:var(--fail);min-height:1em;margin:.2rem 0 .6rem"></p>' +
      '<button class="btn btn-gold" id="ca-save" style="width:100%;justify-content:center">Save</button>';
    drawer('Corrective action', res.where, h);
    $('#ca-save').onclick = function () {
      var act = $('#ca-act').value.trim();
      if (!act) { $('#ca-err').textContent = 'Describe the corrective action.'; return; }
      var newPhotos = Array.prototype.map.call($('#ca-photos').files || [],
        function (f2) { return f2.name; });
      res.set({ action: act, owner: $('#ca-own').value.trim(),
        status: $('#ca-st').value, photos: (cur.photos || []).concat(newPhotos) });
      closeDrawer();
      toast('Saved' + (newPhotos.length ? ' · ' + newPhotos.length + ' photo' +
        (newPhotos.length === 1 ? '' : 's') + ' attached' : ''));
      go(page);
    };
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  /* ====================== boot ========================================== */
  function setWho() {
    var r = ROLES[ROLE] || ROLES.admin;
    if ($('#who')) $('#who').textContent = r.user + ' · ' + r.title;
  }
  function openApp(sess) {
    $('#gate').classList.add('hide');
    $('#app').classList.remove('hide');
    setWho();
    var rsel = $('#role-sel');
    if (rsel) { rsel.value = ROLE; rsel.onchange = function () { ROLE = this.value; setWho(); if (B) go(page); }; }
    Promise.all([
      post('cs_portal_bundle', { p_token: sess.session }),
      post('cs_portal_field_inspections', { p_token: sess.session }).catch(function () { return []; }),
      post('cs_portal_findings', { p_token: sess.session }).catch(function () { return []; }),
      post('cs_portal_incidents', { p_token: sess.session }).catch(function () { return []; })
    ]).then(function (res) {
      B = normalizeBundle(res[0], res[2], res[3]);
      CREW = crewFromField(res[1]);
      $('#side-co').textContent = (B.company && B.company.name) || C.contractor || '';
      var want = (location.hash || '').replace('#', '');
      go(PAGES.some(function (p) { return p.id === want; }) ? want : 'overview');
    }).catch(function (e) {
      $('#main').innerHTML = '<div class="empty">Could not load: ' + esc(e.message) + '</div>';
    });
  }

  function signIn() {
    var pin = $('#gate-in').value.trim();
    var err = $('#gate-err'), btn = $('#gate-go');
    if (!pin) { err.textContent = 'Enter your code'; return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    err.textContent = '';
    post('cs_portal_login', { p_slug: C.slug, p_pin: pin })
      .then(function (res) {
        if (!res || !res.ok) {
          err.textContent = (res && res.error) || 'Wrong code';
          $('#gate-in').value = ''; $('#gate-in').focus();
          return;
        }
        localStorage.setItem(SKEY, JSON.stringify(res));
        openApp(res);
      })
      .catch(function (e) { err.textContent = e.message; })
      .then(function () { btn.disabled = false; btn.textContent = 'Sign in'; });
  }

  $('#gate-co').textContent = C.contractor || C.brand || 'Greiner Brothers';
  $('#gate-by').textContent = 'Safety platform · Powered by ' + (C.poweredBy || 'NextGen Safety');
  $('#gate-go').onclick = signIn;
  $('#gate-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') signIn(); });
  $('#signout').onclick = function () {
    if (!confirm('Sign out?')) return;
    localStorage.removeItem(SKEY);
    location.reload();
  };
  // Collapsible sidebar: toggle in the header hides it; a floating button reopens.
  (function () {
    var app = $('#app'), tgl = $('#side-toggle'), rop = $('#side-reopen');
    function setCollapsed(v) {
      if (app) app.classList.toggle('nav-collapsed', v);
      if (rop) rop.classList.toggle('hide', !v);
    }
    if (tgl) tgl.onclick = function () { setCollapsed(true); };
    if (rop) rop.onclick = function () { setCollapsed(false); };
  })();
  window.addEventListener('hashchange', function () {
    var want = (location.hash || '').replace('#', '');
    if (B && want && want !== page && PAGES.some(function (p) { return p.id === want; })) go(want);
  });

  var s = getSession();
  if (s) openApp(s);
})();
