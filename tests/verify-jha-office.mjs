/* Office side of the Tony JHA feedback — driven in a real browser (WebKit).
 *
 *  - jha-model.js is byte-identical to the phone's JHA-MODEL block, so the
 *    office, the phone review and the PDF all render from one model.
 *  - The JHA revision drawer shows every answer of every version, exactly the
 *    model's list, including retired variance answers on an old record.
 *  - Hot Work and Forklift office details carry the new questions.
 *  - No horizontal overflow at 390 / 820 / 1024 / 1440 px.
 *  - Nothing leaves the machine.
 *
 * Needs playwright-webkit (set PLAYWRIGHT_NODE_MODULES); otherwise the browser
 * part reports a skip. PHONE_INDEX points at the phone index.html (defaults to
 * the sibling phone worktree).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../', import.meta.url).pathname);
let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`); }
}

/* ---------- one model, two repos ---------- */
const model = fs.readFileSync(path.join(ROOT, 'jha-model.js'), 'utf8');
await check('jha-model.js is the shared JHA-MODEL block', async () => {
  assert.ok(model.startsWith('/* JHA-MODEL:BEGIN') && model.trimEnd().endsWith('/* JHA-MODEL:END */'));
});
const PHONE_INDEX = process.env.PHONE_INDEX ||
  path.resolve(ROOT, '../greiner-qr-tony-feedback-2026-10-02/index.html');
if (fs.existsSync(PHONE_INDEX)) {
  await check('jha-model.js matches the phone copy byte for byte', async () => {
    const html = fs.readFileSync(PHONE_INDEX, 'utf8');
    const a = html.indexOf('/* JHA-MODEL:BEGIN'), b = html.indexOf('/* JHA-MODEL:END */') + '/* JHA-MODEL:END */\n'.length;
    assert.equal(html.slice(a, b), model, 'the office and phone JHA models have drifted');
  });
} else {
  console.log('  --  phone index.html not found; model sync not checked (set PHONE_INDEX).');
}
await check('office.html loads the model before the demo fixtures and the office', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'office.html'), 'utf8');
  const m = html.indexOf('jha-model.js'), d = html.indexOf('office-demo.js'), o = html.indexOf('office.js?');
  assert.ok(m > -1 && m < d && d < o);
});

const req = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'));
let webkit;
try { ({ webkit } = req('playwright-webkit')); } catch {
  console.log(`JHA office verification: ${checks} static checks passed; browser part skipped (set PLAYWRIGHT_NODE_MODULES).`);
  process.exit(failures ? 1 : 0);
}

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'office.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const PRODUCTION = /supabase|creekside|greiner|n8n|github\.io|workers\.dev|confirmsafety/i;
const offMachine = [];

const browser = await webkit.launch();
async function open(hash, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    offMachine.push(u); return r.abort();
  });
  await page.goto(BASE + 'office.html?demo=1' + (hash === '#jha' ? '#obs' : hash));
  await page.waitForTimeout(700);
  if (hash === '#jha') {   // JHA Review is a view inside Safety Inspections
    await page.locator('button, a').filter({ hasText: /^JHA Review$/ }).first().click();
    await page.waitForSelector('[data-jha-hist]', { timeout: 5000 });
  }
  return page;
}
const drawerText = (p) => p.locator('.drawer').last().innerText();

try {
  const page = await open('#jha');

  await check('25. The revision drawer lists exactly the model answers for every version', async () => {
    await page.click('[data-jha-hist="jha-a-1"]');
    await page.waitForTimeout(200);
    const result = await page.evaluate(() => {
      const fam = window.DEMO.jha.filter((r) => r.root_jha_id === 'jha-a-1')
        .sort((a, b) => a.revision_number - b.revision_number);
      const shown = [...document.querySelectorAll('.jha-tl > li')].map((li) =>
        [...li.querySelectorAll('[data-ans-key]')].map((row) =>
          row.querySelector('.k').textContent + ' = ' + row.querySelector('.v').textContent));
      const expected = fam.map((r) => window.JhaModel.jhaSections(r.data, { crew: { employees: r.employees, groups: [] } })
        .flatMap((s) => s.items.map((i) => i.label + ' = ' + i.value)));
      return { shown, expected };
    });
    assert.equal(result.shown.length, 4, 'original plus three revisions');
    assert.deepEqual(result.shown, result.expected);
    const all = result.shown.flat().join('\n');
    assert.ok(all.includes('Estimated Time of Completion = 15:30'));
    assert.ok(all.includes('Who will conduct the lift inspections? = Demo Foreman, Alex Rivera (Demo)'));
    assert.ok(all.includes('Which ladder or ladders will be used today? = LAD-101'));
    assert.ok(all.includes('Ladder LAD-101 \u2014 Inspected by = Alex Rivera (Demo)'));
    assert.ok(all.includes('Ladder LAD-101 \u2014 Inspection for today\u2019s use = Confirmed safe for use by Demo Foreman'));
    assert.ok(all.includes('Which ladder or ladders will be used today? = LAD-101, LAD-204'), 'multiple ladders');
    assert.ok(/Ladder LAD-317 \u2014 Defect reported = Cracked right side rail below the third step \u00b7 marked Do Not Use and removed from service/.test(all),
      'a defect reported on the JHA stays visible in office detail');
    const t = await drawerText(page);
    assert.ok(!t.includes('What changed:'), 'no manual change category');
    const diffs = await page.$$eval('[data-rev-diff]', (d) => d.map((x) => x.textContent));
    assert.equal(diffs.length, 3, 'each revision shows its stored field-level difference');
    assert.ok(diffs.every((x) => /Fields changed \(\d+\)/.test(x)));
    assert.ok(t.includes('Revision note: Crew moved to the west corridor after lunch.'), 'the optional note shows');
    const stored = await page.evaluate(() => window.DEMO.jha.filter((r) => r.root_jha_id === 'jha-a-1' && r.revision_number > 1)
      .map((r) => r.revision_diff.length));
    assert.ok(stored.every((n) => n > 0), 'diffs are stored on the revision records');
    assert.ok(!/one-man scissor lift|Above-ceiling/.test(all), 'current JHAs carry no retired questions');
  });

  await check('11. An older JHA still shows its original variance questions and answers', async () => {
    await page.click('.drawer .x').catch(() => {});
    await page.evaluate(() => document.querySelectorAll('.drawer-wrap, .drawer').forEach((d) => d.remove()));
    await page.click('[data-jha-hist="jha-a-4"]');
    await page.waitForTimeout(200);
    const t = await drawerText(page);
    assert.ok(t.includes('Can this work be done safely from a ladder?'));
    assert.ok(t.includes('Corridor too narrow for a scissor lift at this location.'));
    assert.ok(t.includes('Above-ceiling hindrances / obstacles 1') && t.includes('Sprinkler main'));
    assert.ok(t.includes('New or Revised'), 'the old New/Revised answer still shows on the old record');
  });

  await check('26. Hot Work office detail shows the type above the description', async () => {
    const p = await open('#permits');
    await p.click('[data-hotwork="hw-1"]');
    await p.waitForSelector('#crew-doc .kv', { timeout: 5000 });
    const doc = await p.locator('#crew-doc').innerText();
    const ti = doc.indexOf('Type of Hot Work Being Performed'), di = doc.indexOf('Description of Work Being Performed');
    assert.ok(ti > -1 && di > ti, doc);
    await p.close();
  });

  await check("27. Forklift office detail shows the operator's-manual answer", async () => {
    const p = await open('#insp');
    const found = await p.evaluate(() => {
      const r = document.querySelector('[data-crewi="fl-1"]'); if (r) r.click(); return !!r;
    });
    assert.ok(found, 'the forklift inspection is listed');
    await p.waitForSelector('#crew-doc .kv', { timeout: 5000 });
    const doc = await p.locator('#crew-doc').innerText();
    assert.ok(doc.includes("Manufacturer Operator's Manual Present and Readable") && doc.includes('Yes'), doc);
    await p.close();
  });

  await check('30. Toolbox rollout: lead presentation and each acknowledgment are separate', async () => {
    const p = await open('#talks');
    await p.click('[data-tbt-tab="completion"]');
    await p.waitForSelector('#tbtRollout', { timeout: 5000 });
    const t = await p.locator('#tbtRollout').innerText();
    for (const bit of ['Fall Protection', 'Purdue Academic Building', 'Designated lead', 'Demo Lead Foreman',
      'Lead presentation', 'Marked present by the lead', 'Individual acknowledgments', '2 of 3', 'Still outstanding', 'Jordan Blake (Demo)',
      'Active engagement']) {
      assert.ok(t.toLowerCase().includes(bit.toLowerCase()), `rollout panel is missing "${bit}"`);
    }
    const jordan = await p.locator('[data-rollout-person="Jordan Blake (Demo)"]').innerText();
    assert.ok(/Marked present by lead/i.test(jordan) && /Outstanding/i.test(jordan),
      'present per the lead but not yet acknowledged must read as outstanding, not complete');
    const alex = await p.locator('[data-rollout-person="Alex Rivera (Demo)"]').innerText();
    assert.ok(/short/.test(alex), 'very short engagement is flagged');
    await p.close();
  });

  await check('The checklist JHA is no longer offered to assign', async () => {
    const r = await page.evaluate(() => window.DEMO.call('cs_portal_user_forms_set',
      { p_user_id: window.DEMO.fieldUsers[0].id, p_job_id: window.DEMO.fieldUsers[0].job_id,
        p_form_keys: ['jha', 'jobsiteanalysis'] }));
    assert.deepEqual(r.form_keys, ['jha']);
  });

  await check('29. No horizontal overflow at 390, 820, 1024 and 1440 px', async () => {
    for (const w of [390, 820, 1024, 1440]) {
      const p = await open('#jha', w);
      const pageOver = await p.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
      await p.click('[data-jha-hist="jha-a-4"]');
      await p.waitForTimeout(150);
      const drawerOver = await p.evaluate(() => {
        const d = [...document.querySelectorAll('.drawer')].pop();
        return d ? d.scrollWidth - d.clientWidth : 0;
      });
      assert.ok(pageOver <= 1 && drawerOver <= 1, `${w}px: page ${pageOver}, drawer ${drawerOver}`);
      await p.close();
    }
  });

  await check('No page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.close();
}

await check('30. No production request was made (nothing left the machine)', async () => {
  const prod = offMachine.filter((u) => PRODUCTION.test(u));
  assert.deepEqual(prod, [], 'production requests: ' + prod.join(', '));
  assert.deepEqual(offMachine, [], 'other off-machine requests: ' + offMachine.join(', '));
});

if (failures) { console.log(`JHA office verification FAILED (${failures} of ${checks + failures}).`); process.exit(1); }
console.log(`JHA office verification passed (${checks} checks).`);
