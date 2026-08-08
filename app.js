/* Greiner Brothers Safety Dashboard.
   Contractor-specific values all live in config.js — nothing below is Greiner
   specific, so this file is copied verbatim for the next contractor. */
(function () {
  'use strict';
  var C = window.CONFIG;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (t, c, txt) {
    var n = document.createElement(t);
    if (c) n.className = c;
    if (txt != null) n.textContent = txt;
    return n;
  };
  var esc = function (s) { return String(s == null ? '' : s); };

  /* ---------- data access -------------------------------------------
     Every Creekside read/write goes through a security-definer RPC that
     resolves portalToken to one company_id server side. There is no code
     path here that can reach another contractor's rows. */
  function rpc(fn, args) {
    return fetch(C.creekside.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: C.creekside.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ p_token: C.portalToken }, args || {}))
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error((b && b.message) || ('request failed (' + r.status + ')'));
        return b;
      });
    });
  }


  // ToolGuard QR project — separate Supabase, read only.
  function toolguard() {
    var q = '?select=*&order=submitted_at.desc&limit=100';
    if (C.toolguard.jobsiteMatch) q += '&jobsite=ilike.*' + encodeURIComponent(C.toolguard.jobsiteMatch) + '*';
    return fetch(C.toolguard.url + '/rest/v1/' + C.toolguard.table + q, {
      headers: { apikey: C.toolguard.anonKey, Authorization: 'Bearer ' + C.toolguard.anonKey }
    }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }

  /* ---------- small helpers ------------------------------------------ */
  var STATE = {
    bundle: null, tg: [],
    // one filter per list, so narrowing reports does not move the inspections
    filters: {
      rep:  { range: 'all', from: null, to: null },
      insp: { range: 'all', from: null, to: null }
    }
  };

  function toast(msg) {
    var t = el('div', 'toast', msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function fmtDate(d) {
    if (!d) return '';
    var x = new Date(String(d).length <= 10 ? d + 'T12:00:00' : d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function daysUntil(d) {
    if (!d) return null;
    return Math.round((new Date(d + 'T12:00:00') - new Date()) / 86400000);
  }
  // template_code is a slug; show something a superintendent recognises
  var TITLES = { site_safety_v2: 'Site Safety Inspection', safety101: 'Safety 101 Inspection' };
  function templateTitle(code) {
    if (!code) return 'Report';
    return TITLES[code] || String(code).replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function jobName(id) {
    var j = (STATE.bundle.jobs || []).filter(function (x) { return x.id === id; })[0];
    return j ? (j.job_number + ' — ' + j.name) : '';
  }

  /* ---------- PDF ------------------------------------------------------
     Built as a real Blob so the iPhone share sheet can attach the file
     itself. Sharing a link instead would hand the portal token to whoever
     the report is texted to. jsPDF is loaded on demand; if it cannot load
     we fall back to the print sheet, which is the Creekside convention. */
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

  function buildPdf(rep) {
    return loadJsPDF().then(function (ns) {
      var doc = new ns.jsPDF({ unit: 'pt', format: 'letter' });
      var M = 48, W = 612 - M * 2, y = M;
      function line(txt, size, bold, color) {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size || 10);
        doc.setTextColor(color || '#111111');
        var parts = doc.splitTextToSize(String(txt), W);
        for (var i = 0; i < parts.length; i++) {
          if (y > 720) { doc.addPage(); y = M; }
          doc.text(parts[i], M, y); y += (size || 10) + 4;
        }
      }
      doc.setFillColor('#0f172a'); doc.rect(0, 0, 612, 76, 'F');
      doc.setTextColor('#eab308'); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
      doc.text(C.contractor, M, 34);
      doc.setTextColor('#ffffff'); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text((rep.template_code || 'Report') + '  ·  ' + fmtDate(rep.report_date), M, 54);
      doc.setFontSize(8); doc.setTextColor('#94a3b8');
      doc.text('Prepared by ' + C.brand, 612 - M, 54, { align: 'right' });
      y = 110;

      line('Inspector: ' + (rep.inspector_name || '—'), 10, true);
      if (rep.job_id) line('Job: ' + jobName(rep.job_id), 10);
      line('Result: ' + String(rep.overall || '').toUpperCase() +
           (rep.defect_count ? ('   ·   ' + rep.defect_count + ' item(s) marked No') : ''), 10, true,
           rep.has_defects ? '#b91c1c' : '#15803d');
      y += 8;

      var f = rep.fields || {}, items = rep.items || {};
      var secs = (f.sections || []);
      if (secs.length) {
        secs.forEach(function (sec) {
          line(sec.title, 12, true, '#0f172a');
          (sec.items || []).forEach(function (it) {
            var v = items[it.id];
            if (it.type === 'comment') { if (v) line('• ' + it.label + ': ' + v, 9); return; }
            if (!v) return;
            line('• [' + String(v).toUpperCase() + ']  ' + it.label, 9,
                 false, v === 'no' ? '#b91c1c' : '#111111');
          });
          if (sec.notes) line('   Notes: ' + sec.notes, 9, false, '#475569');
          y += 6;
        });
      } else {
        Object.keys(items).forEach(function (k) { line('• ' + k + ': ' + items[k], 9); });
      }
      if (rep.signature_typed) { y += 10; line('Signed: ' + rep.signature_typed, 10, true); }
      return doc.output('blob');
    });
  }

  function reportFilename(rep) {
    return (C.contractor + '-' + (rep.template_code || 'report') + '-' + (rep.report_date || ''))
      .replace(/[^A-Za-z0-9-]+/g, '-') + '.pdf';
  }

  function withReport(id, fn) {
    toast('Preparing…');
    rpc('cs_portal_report', { p_report_id: id }).then(fn).catch(function (e) { toast(e.message); });
  }

  function downloadReport(id) {
    withReport(id, function (rep) {
      buildPdf(rep).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = el('a'); a.href = url; a.download = reportFilename(rep);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }).catch(function () { printFallback(rep); });
    });
  }

  function shareReport(id) {
    withReport(id, function (rep) {
      buildPdf(rep).then(function (blob) {
        var file = new File([blob], reportFilename(rep), { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({
            files: [file],
            title: C.contractor + ' safety report',
            text: (rep.template_code || 'Report') + ' — ' + fmtDate(rep.report_date)
          }).catch(function () {});
        }
        // no file sharing (desktop, older iOS) — hand them the download
        var url = URL.createObjectURL(blob);
        var a = el('a'); a.href = url; a.download = reportFilename(rep);
        document.body.appendChild(a); a.click(); a.remove();
        toast('Sharing not supported here — downloaded instead');
      }).catch(function () { printFallback(rep); });
    });
  }

  function printFallback(rep) {
    var w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print'); return; }
    var rows = '';
    var items = rep.items || {};
    ((rep.fields || {}).sections || []).forEach(function (sec) {
      rows += '<h3>' + esc(sec.title) + '</h3><ul>';
      (sec.items || []).forEach(function (it) {
        var v = items[it.id]; if (!v) return;
        rows += '<li><b>' + esc(String(v).toUpperCase()) + '</b> — ' + esc(it.label) + '</li>';
      });
      if (sec.notes) rows += '<li><i>Notes: ' + esc(sec.notes) + '</i></li>';
      rows += '</ul>';
    });
    w.document.write('<title>' + esc(reportFilename(rep)) + '</title>' +
      '<body style="font:13px system-ui;padding:28px;max-width:760px;margin:auto">' +
      '<h1 style="margin:0">' + esc(C.contractor) + '</h1>' +
      '<p style="color:#555">' + esc(rep.template_code) + ' · ' + esc(fmtDate(rep.report_date)) +
      ' · Inspector ' + esc(rep.inspector_name || '—') + '</p>' + rows + '</body>');
    w.document.close();
    setTimeout(function () { w.print(); }, 300);
  }

  /* ---------- renderers ---------------------------------------------- */
  function reportCard(r) {
    var c = el('div', 'card');
    var row = el('div', 'row');
    var left = el('div');
    left.appendChild(el('div', 'card-t', templateTitle(r.template_code)));
    left.appendChild(el('div', 'card-s',
      fmtDate(r.report_date) + (r.inspector_name ? ' · ' + r.inspector_name : '') +
      (r.job_id ? ' · ' + jobName(r.job_id) : '')));
    row.appendChild(left);
    var ok = !r.has_defects;
    row.appendChild(el('span', 'pill ' + (ok ? 'p-ok' : 'p-bad'),
      ok ? 'Pass' : (r.defect_count || 0) + ' flagged'));
    c.appendChild(row);
    var br = el('div', 'btn-row');
    var d = el('button', 'btn btn-out btn-sm', 'Download PDF');
    d.onclick = function () { downloadReport(r.id); };
    var s = el('button', 'btn btn-gold btn-sm', 'Share');
    s.onclick = function () { shareReport(r.id); };
    br.appendChild(d); br.appendChild(s); c.appendChild(br);
    return c;
  }

  function inspCard(r) {
    var c = el('div', 'card');
    var row = el('div', 'row');
    var left = el('div');
    var title = (r.inspection_subtype ? String(r.inspection_subtype).toUpperCase() : 'Inspection') +
      (r.asset_id ? ' · ' + r.asset_id : '');
    left.appendChild(el('div', 'card-t', title));
    left.appendChild(el('div', 'card-s',
      fmtDate(r.inspection_date || r.submitted_at) +
      (r.inspector_name ? ' · ' + r.inspector_name : '') +
      (r.jobsite ? ' · ' + r.jobsite : '')));
    row.appendChild(left);
    row.appendChild(el('span', 'pill ' + (r.has_defects ? 'p-bad' : 'p-ok'),
      r.has_defects ? (r.defect_count || 0) + ' defect' : 'Clear'));
    c.appendChild(row);
    var br = el('div', 'btn-row');
    var d = el('button', 'btn btn-out btn-sm', 'Download PDF');
    d.onclick = function () { tgPdf(r, false); };
    var s = el('button', 'btn btn-gold btn-sm', 'Share');
    s.onclick = function () { tgPdf(r, true); };
    br.appendChild(d); br.appendChild(s); c.appendChild(br);
    return c;
  }

  // ToolGuard rows have a free-form `fields` object rather than a template.
  function tgPdf(r, share) {
    var pseudo = {
      template_code: (r.inspection_subtype || r.form_type || 'inspection'),
      report_date: r.inspection_date || (r.submitted_at || '').slice(0, 10),
      inspector_name: r.inspector_name, overall: r.has_defects ? 'fail' : 'pass',
      has_defects: r.has_defects, defect_count: r.defect_count,
      items: {}, fields: {}, job_id: null
    };
    Object.keys(r.fields || {}).forEach(function (k) { pseudo.items[k] = r.fields[k]; });
    if (r.asset_id) pseudo.items['Asset'] = r.asset_id;
    if (r.jobsite) pseudo.items['Job site'] = r.jobsite;
    buildPdf(pseudo).then(function (blob) {
      var name = reportFilename(pseudo);
      var file = new File([blob], name, { type: 'application/pdf' });
      if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: C.contractor + ' inspection' }).catch(function () {});
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = el('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      if (share) toast('Sharing not supported here — downloaded instead');
    }).catch(function () { printFallback(pseudo); });
  }

  /* ---------- date filtering ------------------------------------------
     One control, mounted twice. Reports date off report_date, crew rows off
     inspection_date (falling back to when it was submitted). */
  function repDate(r)  { return r.report_date ? String(r.report_date).slice(0, 10) : null; }
  function inspDate(r) {
    var d = r.inspection_date || r.submitted_at;
    return d ? String(d).slice(0, 10) : null;
  }

  function inRange(dateStr, f) {
    if (!dateStr) return f.range === 'all';
    if (f.range === 'all') return true;
    if (f.range === 'custom') {
      if (f.from && dateStr < f.from) return false;
      if (f.to   && dateStr > f.to)   return false;
      return true;
    }
    var cut = new Date();
    cut.setDate(cut.getDate() - Number(f.range));
    return dateStr >= cut.toISOString().slice(0, 10);
  }

  // Builds the segmented control + custom range into a mount point. Ids are
  // namespaced by key so two of them can live on the same screen.
  function mountFilter(host, key, onChange) {
    var f = STATE.filters[key];
    host.innerHTML =
      '<div class="filter-row"><div class="segbar" role="group" aria-label="Filter by date">' +
        [['7', 'Week'], ['30', 'Month'], ['all', 'All'], ['custom', 'Custom']].map(function (o) {
          return '<button class="seg" type="button" data-range="' + o[0] + '"' +
                 (f.range === o[0] ? ' aria-pressed="true"' : '') + '>' + o[1] + '</button>';
        }).join('') +
      '</div></div>' +
      '<div class="range hide" data-role="range">' +
        '<div class="range-f"><label for="' + key + '-from">From</label>' +
          '<input id="' + key + '-from" type="date" aria-label="From date"></div>' +
        '<div class="range-f"><label for="' + key + '-to">To</label>' +
          '<input id="' + key + '-to" type="date" aria-label="To date"></div>' +
      '</div>' +
      '<p class="range-note hide" data-role="note"><span data-role="txt"></span>' +
        '<button class="range-clear hide" type="button" data-role="clear">Clear</button></p>';

    var rangeBox = host.querySelector('[data-role=range]');
    var fromIn   = host.querySelector('#' + key + '-from');
    var toIn     = host.querySelector('#' + key + '-to');

    function apply() {
      var a = fromIn.value || null, b = toIn.value || null;
      if (a && b && a > b) { toast('From date is after To date'); return; }
      f.from = a; f.to = b;
      onChange();
    }
    Array.prototype.forEach.call(host.querySelectorAll('.seg'), function (btn) {
      btn.onclick = function () {
        f.range = btn.dataset.range;
        Array.prototype.forEach.call(host.querySelectorAll('.seg'), function (x) {
          x.setAttribute('aria-pressed', String(x.dataset.range === f.range));
        });
        rangeBox.classList.toggle('hide', f.range !== 'custom');
        onChange();
      };
    });
    fromIn.onchange = apply;
    toIn.onchange = apply;
    host.querySelector('[data-role=clear]').onclick = function () {
      fromIn.value = ''; toIn.value = '';
      f.from = f.to = null;
      onChange();
    };
  }

  function paintNote(host, key, shown) {
    var f = STATE.filters[key];
    var note = host.querySelector('[data-role=note]');
    var txt = '';
    if (f.range === '7')  txt = 'Last 7 days';
    if (f.range === '30') txt = 'Last 30 days';
    if (f.range === 'custom') {
      txt = (f.from || f.to)
        ? (f.from ? fmtDate(f.from) : 'Anything') + ' to ' + (f.to ? fmtDate(f.to) : 'today')
        : 'Pick a start and end date';
    }
    if (txt && f.range !== 'all') {
      txt += '  \u00b7  ' + shown + (shown === 1 ? ' result' : ' results');
    }
    host.querySelector('[data-role=txt]').textContent = txt;
    note.classList.toggle('hide', !txt);
    host.querySelector('[data-role=clear]')
        .classList.toggle('hide', !(f.range === 'custom' && (f.from || f.to)));
  }

  function countLabel(key, shown, total) {
    return STATE.filters[key].range === 'all'
      ? (total ? total + ' total' : '')
      : shown + ' of ' + total;
  }

  function renderHome() {
    var hostRep  = document.querySelector('[data-filter=rep]');
    var hostInsp = document.querySelector('[data-filter=insp]');

    var reps  = (STATE.bundle.reports || []).filter(function (r) {
      return inRange(repDate(r), STATE.filters.rep);
    });
    var lr = $('#list-reports'); lr.innerHTML = '';
    $('#n-reports').textContent = countLabel('rep', reps.length, (STATE.bundle.reports || []).length);
    if (!reps.length) {
      lr.appendChild(el('div', 'empty', (STATE.bundle.reports || []).length
        ? 'No reports in this date range.'
        : 'No reports yet. They appear here as Creekside completes them.'));
    }
    reps.forEach(function (r) { lr.appendChild(reportCard(r)); });
    if (hostRep) paintNote(hostRep, 'rep', reps.length);

    var all = STATE.tg || [];
    var shown = all.filter(function (r) { return inRange(inspDate(r), STATE.filters.insp); });
    var li = $('#list-insp'); li.innerHTML = '';
    $('#n-insp').textContent = countLabel('insp', shown.length, all.length);
    if (!shown.length) {
      li.appendChild(el('div', 'empty', all.length
        ? 'No crew inspections in this date range.'
        : 'No crew inspections yet.'));
    }
    shown.forEach(function (r) { li.appendChild(inspCard(r)); });
    if (hostInsp) paintNote(hostInsp, 'insp', shown.length);
  }

  function renderJobs() {
    var jobs = STATE.bundle.jobs || [];
    var w = $('#list-jobs'); w.innerHTML = '';
    $('#n-jobs').textContent = jobs.length + ' active';
    if (!jobs.length) w.appendChild(el('div', 'empty', 'No active jobs.'));
    jobs.forEach(function (j, i) {
      var c = el('div', 'card');
      var btn = el('button', 'acc');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', 'job-' + i);
      var row = el('div', 'row');
      var left = el('div');
      left.appendChild(el('div', 'card-t', j.name));
      left.appendChild(el('div', 'card-s', j.job_number + (j.address ? ' · ' + j.address : '')));
      row.appendChild(left);
      var right = el('div', 'row');
      right.appendChild(el('span', 'pill p-ok', 'Active'));
      right.appendChild(el('span', 'chev', '›'));
      row.appendChild(right);
      btn.appendChild(row);

      var body = el('div', 'acc-body hide');
      body.id = 'job-' + i;
      // foreman shows as name and number, plain text — no call button
      var foreman = [j.foreman_name, j.foreman_phone].filter(Boolean).join('  ·  ');
      [['Job number', j.job_number], ['Address', j.address],
       ['Started', j.start_date ? fmtDate(j.start_date) : null],
       ['Foreman', foreman], ['Project manager', j.pm_name],
       ['General contractor', j.gc_name]].forEach(function (p) {
        if (!p[1]) return;
        var r = el('div', 'cert');
        r.appendChild(el('div', null, p[0]));
        r.appendChild(el('div', 'card-s', p[1]));
        body.appendChild(r);
      });
      var reps = (STATE.bundle.reports || []).filter(function (r) { return r.job_id === j.id; });
      var sum = el('div', 'cert');
      sum.appendChild(el('div', null, 'Reports on this job'));
      sum.appendChild(el('div', 'card-s', String(reps.length)));
      body.appendChild(sum);
      btn.onclick = function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        body.classList.toggle('hide', open);
      };
      c.appendChild(btn); c.appendChild(body); w.appendChild(c);
    });
  }

  function renderCerts() {
    var certs = STATE.bundle.certs || [];
    var w = $('#list-certs'); w.innerHTML = '';
    var byWorker = {};
    certs.forEach(function (c) { (byWorker[c.worker] = byWorker[c.worker] || []).push(c); });
    var names = Object.keys(byWorker).sort();
    $('#n-certs').textContent = names.length ? names.length + ' workers' : '';
    if (!names.length) {
      w.appendChild(el('div', 'empty', 'No certifications on file yet.'));
      return;
    }
    names.forEach(function (name, i) {
      var list = byWorker[name];
      var soon = list.filter(function (c) {
        var d = daysUntil(c.expires); return d !== null && d <= 60;
      }).length;
      var card = el('div', 'card');
      var btn = el('button', 'acc');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', 'cert-' + i);
      var row = el('div', 'row');
      var left = el('div');
      left.appendChild(el('div', 'card-t', name));
      left.appendChild(el('div', 'card-s', list.length + ' certification' + (list.length === 1 ? '' : 's')));
      row.appendChild(left);
      var right = el('div', 'row');
      if (soon) right.appendChild(el('span', 'pill p-warn', soon + ' expiring'));
      right.appendChild(el('span', 'chev', '›'));
      row.appendChild(right);
      btn.appendChild(row);
      var body = el('div', 'acc-body hide'); body.id = 'cert-' + i;
      list.forEach(function (c) {
        var d = daysUntil(c.expires);
        var isSoon = d !== null && d <= 60;
        var r = el('div', 'cert' + (isSoon ? ' soon' : ''));
        var l = el('div');
        l.appendChild(el('div', null, c.cert_type));
        l.appendChild(el('div', 'd',
          'Completed ' + (c.issued ? fmtDate(c.issued) : 'not recorded') +
          (c.expires ? '  ·  Expires ' + fmtDate(c.expires) : '  ·  No expiry')));
        r.appendChild(l);
        if (c.expires) {
          r.appendChild(el('span', 'pill ' + (d < 0 ? 'p-bad' : isSoon ? 'p-warn' : 'p-grey'),
            d < 0 ? 'Expired' : d <= 60 ? d + 'd left' : 'Current'));
        }
        body.appendChild(r);
      });
      btn.onclick = function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        body.classList.toggle('hide', open);
      };
      card.appendChild(btn); card.appendChild(body); w.appendChild(card);
    });
  }




  /* ---------- tabs ---------------------------------------------------- */
  function show(tab) {
    ['home', 'jobs', 'certs'].forEach(function (t) {
      $('#p-' + t).classList.toggle('hide', t !== tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
    window.scrollTo(0, 0);
  }

  /* ---------- load ---------------------------------------------------- */
  function refresh() {
    return rpc('cs_portal_bundle').then(function (b) {
      STATE.bundle = b;
      renderHome(); renderJobs(); renderCerts();
      return b;
    });
  }

  function boot() {
    $('#app-title').textContent = C.pageTitle;
    $('#app-by').textContent = 'Prepared by ' + C.brand;
    document.title = C.pageTitle;
    $('#start-inspection').href = 'inspect.html?k=' + encodeURIComponent(C.inspectKey);

    Promise.all([refresh(), toolguard().then(function (r) { STATE.tg = r; })])
      .then(renderHome)
      .catch(function (e) {
        $('#list-reports').innerHTML = '';
        $('#list-reports').appendChild(el('div', 'empty', 'Could not load: ' + e.message));
      });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.onclick = function () { show(b.dataset.tab); };
    });

    Array.prototype.forEach.call(document.querySelectorAll('.filter-mount'), function (host) {
      mountFilter(host, host.dataset.filter, renderHome);
    });

    $('#job-add-toggle').onclick = function () { $('#job-form').classList.toggle('hide'); };
    $('#j-cancel').onclick = function () { $('#job-form').classList.add('hide'); };
    $('#j-save').onclick = function () {
      var name = $('#j-name').value.trim();
      var addr = $('#j-addr').value.trim();
      if (!name) { toast('Job name is required'); return; }
      if (!addr) { toast('Address is required'); return; }
      $('#j-save').disabled = true;
      rpc('cs_portal_add_job', {
        p_job_number: $('#j-num').value.trim() || 'NEW',
        p_name: name, p_address: addr,
        p_foreman_name: $('#j-fore').value.trim() || null,
        p_foreman_phone: $('#j-phone').value.trim() || null
      }).then(refresh).then(function () {
        $('#j-name').value = $('#j-num').value = $('#j-addr').value = '';
        $('#j-fore').value = $('#j-phone').value = '';
        $('#job-form').classList.add('hide'); toast('Job added');
      }).catch(function (e) { toast(e.message); })
        .then(function () { $('#j-save').disabled = false; });
    };

  }

  /* ---------- gate ------------------------------------------------------
     Convenience only. See config.js. Real scoping is the portal token. */
  function openApp() {
    $('#gate').classList.add('hide');
    $('#app').classList.remove('hide');
    boot();
  }
  function tryGate() {
    if ($('#gate-in').value === C.gatePassword) {
      try { sessionStorage.setItem('cs_gate', '1'); } catch (e) {}
      openApp();
    } else {
      $('#gate-err').textContent = 'Wrong code';
      $('#gate-in').value = '';
      $('#gate-in').focus();
    }
  }
  $('#gate-co').textContent = C.contractor;
  $('#gate-by').textContent = 'Safety dashboard · ' + C.brand;
  $('#gate-go').onclick = tryGate;
  $('#gate-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryGate(); });
  try { if (sessionStorage.getItem('cs_gate') === '1') openApp(); } catch (e) {}
})();
