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
