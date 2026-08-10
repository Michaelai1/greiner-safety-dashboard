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

  /* ---------- session + data access -----------------------------------
     There is no token in config.js. The PIN is verified server side and
     exchanged for a random 30-day session, kept in localStorage on this
     device only. Every read and write carries that session, which the
     database resolves to exactly one company_id. */
  var SESSION_KEY = 'cs_session_' + C.slug;

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s.session || (s.expires_at && new Date(s.expires_at) <= new Date())) {
        localStorage.removeItem(SESSION_KEY); return null;
      }
      return s.session;
    } catch (e) { return null; }
  }
  function setSession(obj) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function sessionUser() {
    try { return (JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') || {}).user || ''; }
    catch (e) { return ''; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function post(fn, body) {
    return fetch(C.creekside.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: C.creekside.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error((b && b.message) || ('request failed (' + r.status + ')'));
        return b;
      });
    });
  }

  // any call that comes back "invalid token" means the session died server
  // side, so drop it and show sign-in rather than leaving a broken screen
  function rpc(fn, args) {
    var sess = getSession();
    if (!sess) { showGate(); return Promise.reject(new Error('signed out')); }
    return post(fn, Object.assign({ p_token: sess }, args || {}))
      .catch(function (e) {
        if (/invalid token|insufficient scope/i.test(e.message)) {
          clearSession(); showGate();
          throw new Error('Session expired — sign in again');
        }
        throw e;
      });
  }

  function docsFn(action, body) {
    var sess = getSession();
    if (!sess) { showGate(); return Promise.reject(new Error('signed out')); }
    return fetch(C.creekside.url + '/functions/v1/' + C.docsFunction, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: sess, action: action }, body || {}))
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error((b && b.error) || 'request failed');
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

  /* Tie a free-text ToolGuard jobsite ("Purdue c800", "Purdue ASB", "Keith.
     Purdue 800") back to a real job. Job-number stem is decisive; name words
     back it up. Below the confidence bar we return null rather than guess —
     filing a form under the wrong job is worse than leaving it unmatched. */
  function jobFor(r) {
    var txt = String(r.jobsite || '').toLowerCase();
    if (!txt) return null;
    var best = null, bestScore = 0;
    ((STATE.bundle && STATE.bundle.jobs) || []).forEach(function (j) {
      var score = 0;
      var stem = String(j.job_number || '').toLowerCase().replace(/^c/, '').split('-')[0];
      if (stem && stem.length >= 3 && txt.indexOf(stem) > -1) score += 5;
      String(j.name || '').toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) {
        if (w.length >= 3 && txt.indexOf(w) > -1) score += 2;
      });
      if (score > bestScore) { bestScore = score; best = j; }
    });
    return bestScore >= 2 ? best : null;
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
      var PW = 612, PH = 792, M = 46, W = PW - M * 2, y = 0;
      var NAVY = '#0f172a', GOLD = '#eab308', INK = '#1f2937', GREY = '#6b7280',
          LITE = '#f3f4f6', LINE = '#e5e7eb', RED = '#b91c1c', GREEN = '#15803d';
      var title = templateTitle(rep.template_code);

      function ensure(h) { if (y + h > PH - 56) { doc.addPage(); y = M; } }
      function setF(size, bold, color) {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size); doc.setTextColor(color || INK);
      }
      function para(txt, size, bold, color, x, width, gap) {
        setF(size, bold, color);
        var lines = doc.splitTextToSize(String(txt), width || W);
        for (var i = 0; i < lines.length; i++) {
          ensure(size + 4);
          doc.text(lines[i], x || M, y); y += size + (gap == null ? 3.5 : gap);
        }
      }
      // small status chip; returns nothing, fixed 30pt wide
      function chip(x, cy, label, fg, bg) {
        doc.setFillColor(bg); doc.roundedRect(x, cy - 8, 30, 11.5, 2.5, 2.5, 'F');
        setF(6.6, true, fg);
        doc.text(label, x + 15, cy, { align: 'center' });
      }

      /* ---- header band ---- */
      doc.setFillColor(NAVY); doc.rect(0, 0, PW, 92, 'F');
      setF(17, true, GOLD);  doc.text(C.contractor, M, 36);
      setF(11, false, '#ffffff'); doc.text(title, M, 56);
      setF(8.5, false, '#94a3b8');
      doc.text('Prepared with ' + C.brand, PW - M, 36, { align: 'right' });
      doc.text(fmtDate(rep.report_date), PW - M, 56, { align: 'right' });

      /* ---- meta strip ---- */
      y = 116;
      var metas = [
        ['JOB', rep.job_id ? jobName(rep.job_id) : (rep.items && rep.items['Job site']) || '—'],
        ['INSPECTOR', rep.inspector_name || '—'],
        ['SIGNED', rep.signature_typed || '—']
      ];
      var mx = M;
      metas.forEach(function (mp) {
        setF(6.6, true, GREY); doc.text(mp[0], mx, y);
        setF(9.5, true, INK);
        var v = doc.splitTextToSize(String(mp[1]), 170)[0] || '—';
        doc.text(v, mx, y + 13);
        mx += 178;
      });
      y += 34;

      // result banner
      var flagged = rep.defect_count || 0;
      doc.setFillColor(flagged ? '#fef2f2' : '#f0fdf4');
      doc.roundedRect(M, y - 4, W, 26, 4, 4, 'F');
      setF(10, true, flagged ? RED : GREEN);
      doc.text(flagged
        ? flagged + ' item' + (flagged === 1 ? '' : 's') + ' flagged for correction'
        : 'All checked items passed', M + 12, y + 12.5);
      y += 40;

      var answers = rep.items || {};
      var secs = (rep.fields || {}).sections || [];
      var photos = [];
      (rep.photos || []).forEach(function (ph) {
        if (ph && ph.data && String(ph.data).indexOf('data:image') === 0) photos.push(ph);
      });
      function labelFor(itemId) {
        for (var i = 0; i < secs.length; i++) {
          var hit = (secs[i].items || []).filter(function (it) { return it.id === itemId; })[0];
          if (hit) return { label: hit.label, section: secs[i].title };
        }
        return { label: itemId, section: '' };
      }

      /* ---- sections ---- */
      if (secs.length) {
        var skipped = [];
        secs.forEach(function (sec) {
          var answered = (sec.items || []).filter(function (it) {
            var v = answers[it.id];
            return v != null && v !== '';
          });
          if (!answered.length && !sec.notes) { skipped.push(sec.title); return; }

          // count section problems (inverted items flag on yes)
          var probs = answered.filter(function (it) {
            return it.type !== 'multi' && it.type !== 'comment' &&
                   answers[it.id] === (it.invert ? 'yes' : 'no');
          }).length;

          ensure(30);
          doc.setFillColor(LITE); doc.rect(M, y - 10, W, 17, 'F');
          setF(9.5, true, NAVY); doc.text(sec.title, M + 8, y + 1.5);
          setF(7.5, true, probs ? RED : GREEN);
          doc.text(probs ? probs + ' FLAGGED' : 'CLEAR', PW - M - 8, y + 1.5, { align: 'right' });
          y += 18;

          answered.forEach(function (it) {
            var v = String(answers[it.id]);
            if (it.type === 'comment') {
              para(it.label + ' — ' + v, 8.5, false, GREY, M + 6, W - 12);
              y += 2; return;
            }
            var isYN = v === 'yes' || v === 'no' || v === 'na';
            var lines = doc.splitTextToSize(it.label, W - 48);
            ensure(lines.length * 12 + 4);
            if (isYN) {
              var bad = v === (it.invert ? 'yes' : 'no');
              var lbl = v === 'na' ? 'N/A' : v.toUpperCase();
              chip(M + 4, y, lbl,
                   v === 'na' ? GREY : bad ? RED : GREEN,
                   v === 'na' ? '#f3f4f6' : bad ? '#fee2e2' : '#dcfce7');
              setF(8.5, bad, bad ? RED : INK);
            } else {
              // multi select or free value — show the value after the label
              chip(M + 4, y, 'SEL', GREY, '#f3f4f6');
              setF(8.5, true, INK);
              lines = doc.splitTextToSize(it.label + ':  ' + v, W - 48);
            }
            for (var li = 0; li < lines.length; li++) {
              ensure(12);
              doc.text(lines[li], M + 42, y);
              y += 11;
            }
            y += 2.5;
          });

          if (sec.notes) {
            ensure(16);
            para('Notes: ' + sec.notes, 8.5, false, GREY, M + 6, W - 12);
          }
          y += 8;
        });

        if (skipped.length) {
          y += 2;
          para('Not covered on this visit: ' + skipped.join(' · '), 7.5, false, '#9ca3af');
          y += 4;
        }
      } else if ((rep.fields || {}).kv) {
        /* crew submission — label / value rows */
        (rep.fields.kv || []).forEach(function (row) {
          var v = String(row.value == null || row.value === '' ? '—' : row.value);
          var isYN = /^(yes|no|na|n\/a)$/i.test(v);
          ensure(14);
          if (isYN) {
            var lo = v.toLowerCase().replace('n/a', 'na');
            chip(M + 4, y, lo === 'na' ? 'N/A' : lo.toUpperCase(),
                 lo === 'no' ? RED : lo === 'yes' ? GREEN : GREY,
                 lo === 'no' ? '#fee2e2' : lo === 'yes' ? '#dcfce7' : '#f3f4f6');
            setF(8.5, false, INK);
            doc.text(doc.splitTextToSize(row.label, W - 48)[0], M + 42, y);
            y += 13.5;
          } else {
            setF(7, true, GREY); doc.text(row.label.toUpperCase(), M + 4, y); y += 10;
            para(v, 9, false, INK, M + 4, W - 8); y += 3;
          }
        });
      } else {
        Object.keys(answers).forEach(function (k) {
          para(k + ':  ' + answers[k], 8.5, false, INK, M + 4);
        });
      }

      /* ---- photos appendix ---- */
      if (photos.length) {
        // bring the first photo row with the header, or the header strands
        // alone at the bottom of a page
        y += 6; ensure(250);
        doc.setFillColor(LITE); doc.rect(M, y - 10, W, 17, 'F');
        setF(9.5, true, NAVY); doc.text('Photos (' + photos.length + ')', M + 8, y + 1.5);
        y += 22;
        var colW = (W - 16) / 2, col = 0, rowH = 0;
        photos.forEach(function (ph) {
          var w2 = colW, h2 = colW * 0.75;
          try {
            var props = doc.getImageProperties(ph.data);
            h2 = Math.min(200, colW * props.height / props.width);
          } catch (e) {}
          var meta = labelFor(ph.item_id);
          var capLines = doc.splitTextToSize(
            (meta.section ? meta.section + ' — ' : '') + meta.label, colW);
          var blockH = h2 + capLines.length * 9 + 14;
          if (col === 0) { ensure(blockH); rowH = blockH; }
          var x = M + col * (colW + 16);
          try { doc.addImage(ph.data, 'JPEG', x, y, w2, h2); } catch (e2) {
            setF(8, false, GREY); doc.text('(photo could not be embedded)', x, y + 10);
          }
          setF(7.5, false, GREY);
          for (var ci = 0; ci < capLines.length; ci++) {
            doc.text(capLines[ci], x, y + h2 + 10 + ci * 9);
          }
          if (col === 1) { y += Math.max(rowH, blockH); col = 0; }
          else { col = 1; rowH = Math.max(rowH, blockH); }
        });
        if (col === 1) y += rowH;
      }

      /* ---- footer on every page ---- */
      var total = doc.getNumberOfPages();
      for (var pg = 1; pg <= total; pg++) {
        doc.setPage(pg);
        doc.setDrawColor(LINE); doc.setLineWidth(0.6);
        doc.line(M, PH - 40, PW - M, PH - 40);
        setF(7.5, false, '#9ca3af');
        doc.text(C.contractor + '  ·  ' + title + '  ·  ' + fmtDate(rep.report_date), M, PH - 28);
        doc.text('Page ' + pg + ' of ' + total, PW - M, PH - 28, { align: 'right' });
      }
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
    // show the matched JOB, not the free-text site the inspector typed —
    // "C800-2025 — Purdue Academic Bldg." instead of "Keith. Purdue 800"
    var mj = jobFor(r);
    left.appendChild(el('div', 'card-s',
      fmtDate(r.inspection_date || r.submitted_at) +
      (r.inspector_name ? ' · ' + r.inspector_name : '') +
      (mj ? ' · ' + mj.job_number + ' — ' + mj.name
          : (r.jobsite ? ' · ' + r.jobsite : ''))));
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
  function humanize(k) {
    return String(k).replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function tgPdf(r, share) {
    var kv = [], photos = [];
    Object.keys(r.fields || {}).forEach(function (k) {
      var v = r.fields[k];
      if (typeof v === 'string' && v.indexOf('data:image') === 0) {
        photos.push({ item_id: k, data: v }); return;
      }
      if (v && typeof v === 'object') v = JSON.stringify(v);
      kv.push({ label: humanize(k), value: v });
    });
    var pseudo = {
      template_code: (r.inspection_subtype || r.form_type || 'inspection'),
      report_date: r.inspection_date || (r.submitted_at || '').slice(0, 10),
      inspector_name: r.inspector_name, overall: r.has_defects ? 'fail' : 'pass',
      has_defects: r.has_defects, defect_count: r.defect_count,
      items: { 'Job site': r.jobsite || '—' },
      fields: { kv: kv }, photos: photos, job_id: null
    };
    if (r.asset_id) kv.unshift({ label: 'Asset', value: r.asset_id });
    if (r.jobsite)  kv.unshift({ label: 'Job site', value: r.jobsite });
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
  /* ---------- findings & corrective actions ----------------------------
     Same rule as the desk: findings are DERIVED from what was flagged (report
     lines + crew forms), only the response is stored. Tony can close one out
     standing on site: what was done, photo, one tap. */
  var FINDINGS = [];
  function addDays(d, n) {
    var x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n);
    return x.toISOString().slice(0, 10);
  }
  function loadFindings() {
    var reps = ((STATE.bundle && STATE.bundle.reports) || [])
      .filter(function (r) { return (r.defect_count || 0) > 0; });
    var savedP = rpc('cs_portal_findings', {}).catch(function () { return {}; });
    Promise.all([savedP].concat(reps.map(function (r) {
      return rpc('cs_portal_report', { p_report_id: r.id }).catch(function () { return null; });
    }))).then(function (all) {
      var saved = all[0] || {};
      var rows = [];
      reps.forEach(function (r, i) {
        var d = all[i + 1];
        if (!d) return;
        var answers = d.items || {};
        ((d.fields || {}).sections || []).forEach(function (sec) {
          (sec.items || []).forEach(function (it) {
            var v = String(answers[it.id] == null ? '' : answers[it.id]).toLowerCase();
            if (v !== (it.invert ? 'yes' : 'no')) return;
            rows.push({ id: 'rf|' + r.id + '|' + it.id, description: it.label,
              job_id: r.job_id, date: r.report_date, due: addDays(r.report_date, 7),
              from: 'Safety report · ' + (r.inspector_name || ''), status: 'open' });
          });
        });
      });
      (STATE.tg || []).filter(function (r) { return r.has_defects; }).forEach(function (r) {
        var mj = jobFor(r);
        rows.push({ id: 'cf|' + r.id,
          description: (r.inspection_subtype || r.form_type || 'Inspection') + ' — ' +
            (r.defect_count || 1) + ' item' + ((r.defect_count || 1) === 1 ? '' : 's') + ' flagged',
          job_id: mj && mj.id, date: String(r.inspection_date || r.submitted_at).slice(0, 10),
          due: addDays(String(r.inspection_date || r.submitted_at).slice(0, 10), 7),
          from: 'Crew form · ' + (r.inspector_name || ''), status: 'open' });
      });
      rows.forEach(function (f) {
        var sv = saved[f.id];
        if (!sv) return;
        f.status = sv.status === 'closed' ? 'closed' : 'open';
        f.action = sv.action; f.photos = sv.photos || [];
        f.closed = String(sv.updated_at || '').slice(0, 10);
        f.closed_by = sv.closed_by || '';
      });
      rows.sort(function (x, y) {
        if (x.status !== y.status) return x.status === 'open' ? -1 : 1;
        return String(y.date).localeCompare(String(x.date));
      });
      FINDINGS = rows;
      renderFindings();
    });
  }
  function shrinkPhoto(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var max = 1200, w = img.width, h2 = img.height;
        if (w > max || h2 > max) {
          var k = Math.min(max / w, max / h2);
          w = Math.round(w * k); h2 = Math.round(h2 * k);
        }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h2;
        cv.getContext('2d').drawImage(img, 0, 0, w, h2);
        resolve(cv.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function () { resolve(null); };
      img.src = URL.createObjectURL(file);
    });
  }
  function renderFindings() {
    var w = $('#list-findings'); if (!w) return;
    w.innerHTML = '';
    var open = FINDINGS.filter(function (f) { return f.status === 'open'; }).length;
    $('#n-findings').textContent = FINDINGS.length
      ? (open ? open + ' open' : 'all closed') : '';
    if (!FINDINGS.length) {
      w.appendChild(el('div', 'empty', 'Nothing flagged. That is the goal.'));
      return;
    }
    FINDINGS.forEach(function (f, i) {
      var card = el('div', 'card');
      var btn = el('button', 'acc');
      btn.setAttribute('aria-expanded', 'false');
      var row = el('div', 'row');
      var left = el('div');
      left.appendChild(el('div', 'card-t', f.description));
      left.appendChild(el('div', 'card-s',
        (f.job_id ? jobName(f.job_id) + ' · ' : '') + fmtDate(f.date) + ' · ' + f.from));
      row.appendChild(left);
      var right = el('div', 'row');
      var overdue = f.status === 'open' && new Date(f.due) < new Date();
      right.appendChild(el('span', 'pill ' + (f.status === 'closed' ? 'p-ok'
        : overdue ? 'p-bad' : 'p-warn'),
        f.status === 'closed' ? 'Closed' : overdue ? 'Overdue' : 'Open'));
      right.appendChild(el('span', 'chev', '›'));
      row.appendChild(right);
      btn.appendChild(row);

      var body = el('div', 'acc-body hide');
      if (f.status === 'closed') {
        body.appendChild(el('div', 'card-s', '✓ Closed ' + fmtDate(f.closed) +
          (f.closed_by ? ' by ' + f.closed_by : '')));
        if (f.action) body.appendChild(el('div', null, f.action));
        (f.photos || []).forEach(function (p2) {
          var img = el('img');
          img.src = p2;
          img.style.cssText = 'max-width:100%;border-radius:10px;border:1px solid var(--navy-3);margin-top:.5rem';
          body.appendChild(img);
        });
      } else {
        var lab = el('label', null, 'What was done about it');
        lab.style.cssText = 'display:block;font-size:.75rem;color:var(--grey);margin-bottom:.25rem';
        var ta = el('textarea');
        ta.placeholder = 'e.g. Restocked the first-aid kit and mounted it at the gate';
        /* No capture attribute: on iOS that forces camera-only. Without it,
           tapping gives the native sheet — Photo Library / Take Photo. The
           raw file input stays hidden; the button is the whole control. */
        var pin = el('input');
        pin.type = 'file'; pin.accept = 'image/*';
        pin.className = 'file-in';
        var pbtn = el('button', 'btn btn-out btn-sm', '📷 Add a photo of the fix');
        pbtn.style.cssText = 'margin-top:.6rem;width:100%';
        var pprev = el('div');
        pbtn.onclick = function (ev) { ev.preventDefault(); pin.click(); };
        pin.onchange = function () {
          pprev.innerHTML = '';
          var f2 = pin.files && pin.files[0];
          if (!f2) { pbtn.textContent = '📷 Add a photo of the fix'; return; }
          var img = el('img');
          img.src = URL.createObjectURL(f2);
          img.style.cssText = 'max-width:100%;border-radius:10px;border:1px solid var(--navy-3);margin-top:.5rem';
          pprev.appendChild(img);
          pbtn.textContent = 'Change photo';
        };
        var errP = el('p', 'err small'); errP.style.minHeight = '1em';
        var save = el('button', 'btn btn-gold btn-sm', 'Close it out');
        save.style.marginTop = '.6rem';
        save.onclick = function () {
          var action = ta.value.trim();
          if (!action) { errP.textContent = 'Say what was done.'; return; }
          errP.textContent = '';
          save.disabled = true; save.textContent = 'Saving…';
          var file = pin.files && pin.files[0];
          (file ? shrinkPhoto(file) : Promise.resolve(null)).then(function (dataUrl) {
            return rpc('cs_portal_save_finding', {
              p_key: f.id, p_action: action,
              p_photos: dataUrl ? [dataUrl] : [],
              p_by: sessionUser() || C.inspector
            });
          }).then(function (res) {
            if (res && res.ok === false) throw new Error(res.error || 'save failed');
            f.status = 'closed'; f.action = action;
            f.closed = new Date().toISOString().slice(0, 10);
            f.closed_by = sessionUser() || C.inspector;
            toast('Finding closed');
            renderFindings();
          }).catch(function (e) {
            errP.textContent = /find the function|does not exist|schema cache/i.test(e.message)
              ? 'Run sql/2026-08-10-findings.sql in Supabase first.'
              : e.message;
            save.disabled = false; save.textContent = 'Close it out';
          });
        };
        body.appendChild(lab); body.appendChild(ta);
        body.appendChild(pin); body.appendChild(pbtn); body.appendChild(pprev);
        body.appendChild(errP); body.appendChild(save);
      }
      btn.onclick = function () {
        var o = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!o));
        body.classList.toggle('hide', o);
      };
      card.appendChild(btn); card.appendChild(body); w.appendChild(card);
    });
  }

  /* ---------- add a certification --------------------------------------
     The common construction certs, each with its usual renewal cycle so
     Expires prefills from Issued (editable — the card wins over the rule). */
  var CERT_TYPES = [
    ['OSHA 10', 5], ['OSHA 30', 5], ['First Aid / CPR', 2], ['Fall Protection', 2],
    ['Forklift Operator', 3], ['Aerial / Scissor Lift', 3], ['Excavation Competent Person', 2],
    ['Confined Space', 1], ['Hot Work', 1], ['Rigging & Signal Person', 2], ['Other…', 2]
  ];
  function wireCertForm() {
    var btn = $('#cert-add-toggle'), form = $('#cert-form');
    if (!btn || !form) return;
    var typeSel = $('#c-type');
    if (!typeSel.options.length) {
      CERT_TYPES.forEach(function (t) {
        var o = el('option', null, t[0]); o.value = t[0]; typeSel.appendChild(o);
      });
    }
    function prefillExpiry() {
      var iss = $('#c-issued').value;
      if (!iss) return;
      var years = (CERT_TYPES.filter(function (t) { return t[0] === typeSel.value; })[0] || [0, 2])[1];
      var d = new Date(iss + 'T12:00:00');
      d.setFullYear(d.getFullYear() + years);
      $('#c-expires').value = d.toISOString().slice(0, 10);
    }
    typeSel.onchange = function () {
      $('#c-other-wrap').classList.toggle('hide', typeSel.value !== 'Other…');
      prefillExpiry();
    };
    $('#c-issued').onchange = prefillExpiry;
    btn.onclick = function () {
      form.classList.toggle('hide');
      if (!$('#c-issued').value) {
        $('#c-issued').value = new Date().toISOString().slice(0, 10);
        prefillExpiry();
      }
      // names already on file, so the same worker is never typed two ways
      var dl = $('#cert-names');
      dl.innerHTML = '';
      var seen = {};
      ((STATE.bundle && STATE.bundle.certs) || []).forEach(function (c2) { seen[c2.worker] = 1; });
      ((STATE.bundle && STATE.bundle.jobs) || []).forEach(function (j) {
        if (j.foreman_name) seen[j.foreman_name] = 1;
      });
      Object.keys(seen).sort().forEach(function (n) {
        var o = el('option'); o.value = n; dl.appendChild(o);
      });
    };
    $('#c-cancel').onclick = function () { form.classList.add('hide'); };
    $('#c-save').onclick = function () {
      var worker = $('#c-worker').value.trim();
      var type = typeSel.value === 'Other…' ? $('#c-other').value.trim() : typeSel.value;
      var err = $('#c-err');
      if (!worker) { err.textContent = 'Whose certification is it?'; return; }
      if (!type)   { err.textContent = 'Name the certification.'; return; }
      if (!$('#c-expires').value) { err.textContent = 'When does it expire?'; return; }
      err.textContent = '';
      var save = $('#c-save');
      save.disabled = true; save.textContent = 'Saving…';
      rpc('cs_portal_add_cert', {
        p_worker: worker, p_cert_type: type,
        p_issued: $('#c-issued').value || null, p_expires: $('#c-expires').value
      }).then(function (res) {
        if (res && res.ok === false) throw new Error(res.error || 'save failed');
        form.classList.add('hide');
        $('#c-worker').value = ''; $('#c-other').value = '';
        toast('Certification added');
        return refresh();
      }).catch(function (e) {
        err.textContent = /find the function|does not exist|schema cache|404/i.test(e.message)
          ? 'Server function missing — run sql/2026-08-10-add-cert.sql in Supabase first.'
          : e.message;
      }).then(function () { save.disabled = false; save.textContent = 'Save'; });
    };
  }

  /* ---------- send the crew forms link ---------------------------------
     Name + phone, nothing else: the QR app carries every form (JHA, hot
     work, equipment checks), so one link is the whole ask. The full Safety
     Inspection stays off this path — that is Tony's own walk. */
  function wireSendForm() {
    var btn = $('#send-insp'), form = $('#send-form');
    if (!btn || !form) return;
    btn.onclick = function () { form.classList.toggle('hide'); };
    $('#si-cancel').onclick = function () { form.classList.add('hide'); };
    $('#si-send').onclick = function () {
      var name  = $('#si-name').value.trim();
      var phone = $('#si-phone').value.trim();
      var err = $('#si-err');
      if (!phone) { err.textContent = 'A phone number is required.'; return; }
      err.textContent = '';
      var msg = (name ? 'Hi ' + name + ', ' : '') + C.contractor +
        ' site forms — JHA, hot work, equipment checks are all at this link: ' +
        (C.qrUrl || location.origin);
      location.href = 'sms:' + phone.replace(/[^+\d]/g, '') +
        '?&body=' + encodeURIComponent(msg);
      toast('Opening Messages…');
      form.classList.add('hide');
    };
  }

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
      // crew inspections tied to this job via the jobsite matcher
      var crewOn = (STATE.tg || []).filter(function (r) {
        var m = jobFor(r); return m && m.id === j.id;
      });
      var ci = el('div', 'cert');
      ci.appendChild(el('div', null, 'Crew inspections on this job'));
      ci.appendChild(el('div', 'card-s', crewOn.length +
        (crewOn.length ? ' · last ' + fmtDate(crewOn[0].inspection_date || crewOn[0].submitted_at) : '')));
      body.appendChild(ci);

      // edit the job in place: address, foreman, phone, name, number
      var editBtn = el('button', 'btn btn-out btn-sm', 'Edit job');
      editBtn.style.marginTop = '.6rem';
      var editForm = el('div', 'hide');
      editForm.style.marginTop = '.6rem';
      function field(lbl, val, type) {
        var wrap2 = el('div');
        var l2 = el('label', null, lbl);
        l2.style.cssText = 'display:block;font-size:.75rem;color:var(--grey);margin:.5rem 0 .25rem';
        var inp = el('input');
        inp.type = type || 'text'; inp.value = val || '';
        wrap2.appendChild(l2); wrap2.appendChild(inp);
        return { wrap: wrap2, inp: inp };
      }
      var fName = field('Job name', j.name), fNum = field('Job number', j.job_number),
          fAddr = field('Address', j.address),
          fFore = field('Foreman', j.foreman_name),
          fPhone = field('Foreman phone', j.foreman_phone, 'tel');
      [fName, fNum, fAddr, fFore, fPhone].forEach(function (f) { editForm.appendChild(f.wrap); });
      var eErr = el('p', 'err small'); eErr.style.minHeight = '1em';
      editForm.appendChild(eErr);
      var eRow = el('div', 'btn-row');
      var eSave = el('button', 'btn btn-gold btn-sm', 'Save');
      var eCancel = el('button', 'btn btn-out btn-sm', 'Cancel');
      eRow.appendChild(eSave); eRow.appendChild(eCancel);
      editForm.appendChild(eRow);
      editBtn.onclick = function () { editForm.classList.toggle('hide'); };
      eCancel.onclick = function () { editForm.classList.add('hide'); };
      eSave.onclick = function () {
        if (!fName.inp.value.trim()) { eErr.textContent = 'Job name is required.'; return; }
        eErr.textContent = '';
        eSave.disabled = true; eSave.textContent = 'Saving…';
        rpc('cs_portal_update_job', {
          p_job_id: j.id, p_name: fName.inp.value.trim(),
          p_job_number: fNum.inp.value.trim(), p_address: fAddr.inp.value.trim(),
          p_foreman_name: fFore.inp.value.trim(), p_foreman_phone: fPhone.inp.value.trim()
        }).then(function () {
          toast('Job updated');
          return refresh();
        }).catch(function (e) {
          eErr.textContent = e.message;
          eSave.disabled = false; eSave.textContent = 'Save';
        });
      };
      body.appendChild(editBtn);
      body.appendChild(editForm);
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
    ['home', 'findings', 'jobs', 'certs'].forEach(function (t) {
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
    var who = sessionUser();
    $('#app-by').textContent = who
      ? 'Signed in as ' + who + ' · ' + C.brand
      : 'Prepared by ' + C.brand;

    $('#signout').onclick = function () {
      if (!confirm('Sign out of this dashboard?')) return;
      var sess = getSession();
      clearSession();
      if (sess) post('cs_portal_logout', { p_token: sess }).catch(function () {});
      location.reload();
    };
    document.title = C.pageTitle;
    $('#start-inspection').href = 'inspect.html?k=' + encodeURIComponent(C.inspectKey);

    Promise.all([refresh(), toolguard().then(function (r) { STATE.tg = r; })])
      .then(renderHome)
      .then(loadFindings)
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
    wireSendForm();
    wireCertForm();

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

  /* ---------- sign in ---------------------------------------------------
     The old version compared a string in this file. That stopped nobody who
     opened devtools. Now the code goes to the server, is checked against a
     bcrypt hash, is rate limited by IP, and comes back as a session. */
  var booted = false;

  function showGate() {
    $('#app').classList.add('hide');
    $('#gate').classList.remove('hide');
    var i = $('#gate-in');
    if (i) { i.value = ''; }
  }
  function openApp() {
    $('#gate').classList.add('hide');
    $('#app').classList.remove('hide');
    if (!booted) { booted = true; boot(); }
  }

  function signIn() {
    var pin = $('#gate-in').value.trim();
    var err = $('#gate-err');
    var btn = $('#gate-go');
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
        setSession(res);
        openApp();
      })
      .catch(function (e) { err.textContent = e.message; })
      .then(function () { btn.disabled = false; btn.textContent = 'Sign in'; });
  }

  $('#gate-co').textContent = C.contractor;
  $('#gate-by').textContent = 'Safety dashboard · ' + C.brand;
  $('#gate-go').onclick = signIn;
  $('#gate-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') signIn(); });

  if (getSession()) openApp(); else showGate();
})();
