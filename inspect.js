/* Safety 101 inspection form.
   Opens preloaded as the configured inspector. No login, no time tracking.
   Identity comes from ?k=<inspectKey>; without a matching key nothing renders
   and no data is fetched. Contractor values live in config.js only. */
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

  var KEY = new URLSearchParams(location.search).get('k');
  if (KEY !== C.inspectKey) { $('#deny').classList.remove('hide'); return; }

  var OUTBOX = 'cs_outbox_' + C.creekside.templateCode;
  var state = { tpl: null, jobs: [], answers: {}, notes: {}, photos: {} };

  function rpc(fn, args) {
    return fetch(C.creekside.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: C.creekside.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ p_token: C.portalToken }, args || {}))
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error((b && b.message) || 'request failed');
        return b;
      });
    });
  }

  function toast(m) {
    var t = el('div', 'toast', m);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  /* ---------- offline outbox ----------------------------------------
     phone.html in the Creekside codebase keeps unsent work in localStorage
     and retries. Same idea here: a submit that fails is queued and flushed
     on the next load or when the browser comes back online. */
  function queue(payload) {
    try {
      var q = JSON.parse(localStorage.getItem(OUTBOX) || '[]');
      q.push({ at: Date.now(), payload: payload });
      localStorage.setItem(OUTBOX, JSON.stringify(q));
    } catch (e) {}
  }
  function flush() {
    var q;
    try { q = JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch (e) { return; }
    if (!q.length) return;
    var rest = [];
    var chain = Promise.resolve();
    q.forEach(function (entry) {
      chain = chain.then(function () {
        return rpc('cs_portal_submit', entry.payload)
          .catch(function () { rest.push(entry); });
      });
    });
    chain.then(function () {
      try { localStorage.setItem(OUTBOX, JSON.stringify(rest)); } catch (e) {}
      if (q.length > rest.length) toast((q.length - rest.length) + ' queued inspection(s) sent');
    });
  }
  window.addEventListener('online', flush);

  /* ---------- render -------------------------------------------------- */
  function counts() {
    var answered = 0, total = 0, no = 0;
    (state.tpl.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (it) {
        if (it.type === 'comment') return;
        total++;
        var v = state.answers[it.id];
        if (v) { answered++; if (v === 'no') no++; }
      });
    });
    return { answered: answered, total: total, no: no };
  }

  function updateProgress() {
    var c = counts();
    $('#prog').style.width = (c.total ? (c.answered / c.total * 100) : 0) + '%';
    $('#sum').textContent = c.answered + ' of ' + c.total + ' answered' +
      (c.no ? '  ·  ' + c.no + ' marked No' : '');
    Array.prototype.forEach.call(document.querySelectorAll('[data-seccount]'), function (n) {
      var sec = state.tpl.sections[+n.dataset.seccount];
      var a = 0, t = 0;
      (sec.items || []).forEach(function (it) {
        if (it.type === 'comment') return;
        t++; if (state.answers[it.id]) a++;
      });
      n.textContent = a + '/' + t;
      n.style.color = (t && a === t) ? 'var(--ok)' : '';
    });
  }

  function photoBlock(itemId) {
    var wrap = el('div', 'photo');
    var btn = el('button', null, '📷  Add photo of this item');
    var thumbs = el('div', 'thumbs');
    function paint() {
      thumbs.innerHTML = '';
      (state.photos[itemId] || []).forEach(function (src) {
        var i = new Image(); i.src = src; i.alt = 'Attached photo'; thumbs.appendChild(i);
      });
    }
    btn.onclick = function () {
      var cam = $('#cam');
      cam.value = '';
      cam.onchange = function () {
        var files = Array.prototype.slice.call(cam.files || []);
        var left = files.length;
        if (!left) return;
        files.forEach(function (f) {
          var fr = new FileReader();
          fr.onload = function () {
            // downscale so a full inspection of photos still posts from a phone
            var img = new Image();
            img.onload = function () {
              var max = 1200;
              var sc = Math.min(1, max / Math.max(img.width, img.height));
              var cv = document.createElement('canvas');
              cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
              cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
              (state.photos[itemId] = state.photos[itemId] || []).push(cv.toDataURL('image/jpeg', 0.7));
              if (--left === 0) paint();
            };
            img.src = fr.result;
          };
          fr.readAsDataURL(f);
        });
      };
      cam.click();
    };
    wrap.appendChild(btn); wrap.appendChild(thumbs);
    return wrap;
  }

  function renderItem(it) {
    var box = el('div', 'item');

    if (it.type === 'comment') {
      box.appendChild(el('p', null, it.label));
      var ta = el('textarea');
      ta.id = 'c_' + it.id;
      ta.placeholder = 'Notes';
      ta.oninput = function () { state.answers[it.id] = ta.value; };
      box.appendChild(ta);
      return box;
    }

    if (it.type === 'choice' && Array.isArray(it.options)) {
      box.appendChild(el('p', null, it.label));
      var sel = el('select');
      sel.appendChild(el('option', null, '— select —'));
      it.options.forEach(function (o) {
        var op = el('option', null, o); op.value = o; sel.appendChild(op);
      });
      sel.onchange = function () { state.answers[it.id] = sel.value; updateProgress(); };
      box.appendChild(sel);
      return box;
    }

    // default: yes / no / n-a
    box.appendChild(el('p', null, it.label));
    var yn = el('div', 'yn');
    var ph = null;
    [['yes', 'Yes'], ['no', 'No'], ['na', 'N/A']].forEach(function (o) {
      var b = el('button', null, o[1]);
      b.type = 'button'; b.dataset.v = o[0];
      b.setAttribute('aria-pressed', 'false');
      b.onclick = function () {
        state.answers[it.id] = o[0];
        Array.prototype.forEach.call(yn.children, function (x) {
          x.setAttribute('aria-pressed', String(x.dataset.v === o[0]));
        });
        // photo prompt only on a failed item
        if (o[0] === 'no' && !ph) { ph = photoBlock(it.id); box.appendChild(ph); }
        if (o[0] !== 'no' && ph) { ph.remove(); ph = null; delete state.photos[it.id]; }
        updateProgress();
      };
      yn.appendChild(b);
    });
    box.appendChild(yn);
    return box;
  }

  function render() {
    $('#who-name').textContent = C.inspector;
    $('#who-co').textContent = C.contractor;
    $('#tpl-name').textContent = state.tpl.name || 'Inspection';
    $('#tpl-date').textContent = new Date().toLocaleDateString('en-US',
      { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $('#sig').value = C.inspector;

    var jobSel = $('#job');
    jobSel.innerHTML = '';
    state.jobs.forEach(function (j) {
      var o = el('option', null, j.job_number + ' — ' + j.name);
      o.value = j.id;
      if (j.job_number === C.defaultJobNumber) o.selected = true;
      jobSel.appendChild(o);
    });

    var wrap = $('#sections');
    wrap.innerHTML = '';
    (state.tpl.sections || []).forEach(function (sec, i) {
      var box = el('div', 'secw');
      var head = el('button', 'sech');
      head.type = 'button';
      head.setAttribute('aria-expanded', i === 0 ? 'true' : 'false');
      var t = el('div');
      t.appendChild(el('div', 't', sec.title));
      head.appendChild(t);
      var cnt = el('div', 'c');
      cnt.dataset.seccount = i;
      head.appendChild(cnt);

      var body = el('div', 'secb');
      if (i !== 0) body.classList.add('hide');
      (sec.items || []).forEach(function (it) { body.appendChild(renderItem(it)); });

      var nb = el('div', 'item');
      nb.appendChild(el('p', null, 'Section notes'));
      var ta = el('textarea');
      ta.placeholder = 'Optional';
      ta.oninput = function () { state.notes[sec.title] = ta.value; };
      nb.appendChild(ta);
      body.appendChild(nb);

      head.onclick = function () {
        var open = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!open));
        body.classList.toggle('hide', open);
      };
      box.appendChild(head); box.appendChild(body);
      wrap.appendChild(box);
    });
    updateProgress();
  }

  /* ---------- submit --------------------------------------------------- */
  function submit() {
    var c = counts();
    if (!c.answered) { toast('Answer at least one item first'); return; }
    if (c.answered < c.total &&
        !confirm(c.total - c.answered + ' item(s) unanswered. Submit anyway?')) return;

    var photos = [];
    Object.keys(state.photos).forEach(function (id) {
      (state.photos[id] || []).forEach(function (src) { photos.push({ item_id: id, data: src }); });
    });

    var payload = {
      p_job_id: $('#job').value || null,
      p_template_code: state.tpl.code,
      p_inspector_name: C.inspector,
      p_signature_typed: $('#sig').value.trim(),
      p_fields: {
        items: state.answers,
        notes: state.notes,
        header: {
          h_title: state.tpl.name,
          h_inspector: C.inspector,
          h_location: $('#job').selectedOptions[0] ? $('#job').selectedOptions[0].textContent : '',
          h_detail: $('#h_location').value.trim(),
          h_time: new Date().toISOString()
        },
        sections: (state.tpl.sections || []).map(function (s) {
          return { title: s.title, items: s.items, notes: state.notes[s.title] || '' };
        })
      },
      p_photos: photos
    };

    $('#submit').disabled = true;
    $('#submit').textContent = 'Submitting…';
    rpc('cs_portal_submit', payload)
      .then(function (id) {
        $('#form').classList.add('hide');
        $('#done').classList.remove('hide');
        $('#done-ref').textContent = 'Reference ' + String(id).slice(0, 8).toUpperCase();
      })
      .catch(function (e) {
        queue(payload);
        $('#form').classList.add('hide');
        $('#done').classList.remove('hide');
        $('#done-ref').textContent = 'Saved on this phone — it will send when you have signal.';
        console.warn('queued:', e.message);
      });
  }

  /* ---------- boot ----------------------------------------------------- */
  flush();
  Promise.all([
    rpc('cs_portal_template', { p_code: C.creekside.templateCode }),
    rpc('cs_portal_bundle')
  ]).then(function (r) {
    state.tpl = r[0];
    state.jobs = r[1].jobs || [];
    $('#form').classList.remove('hide');
    render();
  }).catch(function (e) {
    $('#deny').classList.remove('hide');
    $('#deny').querySelector('p').textContent = 'Could not load the form: ' + e.message;
  });

  $('#submit').onclick = submit;
  $('#again').onclick = function () { location.reload(); };
})();
