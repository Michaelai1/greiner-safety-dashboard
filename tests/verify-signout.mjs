import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const req = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'));
const { webkit } = req('playwright-webkit');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const SKEY = 'cs_session_greiner';
const session = (token, role = 'full') => ({ session: token, role, user: 'Logout Test', expires_at: '2099-01-01T00:00:00Z', job_ids: role === 'field' ? ['job-1'] : [] });

let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`  ok  ${name}`); }
const browser = await webkit.launch(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE }
  : {});

async function open(file, token, role, width, logoutMode = 'hold') {
  const ctx = await browser.newContext({ viewport: { width, height: 820 } });
  await ctx.addInitScript(([k, v]) => {
    if (!sessionStorage.getItem('logout-test-seeded')) {
      localStorage.setItem(k, JSON.stringify(v));
      sessionStorage.setItem('logout-test-seeded', '1');
    }
    window.confirm = () => true;
  }, [SKEY, session(token, role)]);
  const valid = new Set([token]);
  let releaseLogout;
  const held = new Promise((resolve) => { releaseLogout = resolve; });
  const page = await ctx.newPage();
  await page.route('**/*', async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const m = url.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!m) return route.abort();
    const body = JSON.parse(req.postData() || '{}');
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (m[1] === 'cs_portal_logout') {
      if (logoutMode === 'fail') return route.fulfill({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ message: 'temporarily unavailable' }) });
      await held;
      valid.delete(body.p_token);
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: 'true' });
    }
    if (!valid.has(body.p_token)) return route.fulfill({ status: 400, headers, contentType: 'application/json', body: JSON.stringify({ message: 'invalid token' }) });
    const payload = m[1] === 'cs_portal_field_home'
      ? { user: 'Logout Test', company: 'Greiner Brothers', jobs: [{ id: 'job-1', name: 'Own Job', job_number: 'T-1', user_forms: ['jha'] }], people: [], equipment: [], recent: [], hotwork_locations: [] }
      : m[1] === 'cs_portal_bundle'
        ? { company: { name: 'Greiner Brothers' }, jobs: [{ id: 'job-1', name: 'Secret Job' }], reports: [], certs: [], stats: [], docs: [] }
        : [];
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.goto(BASE + file);
  await page.waitForSelector(role === 'field' ? '#f-signout' : '#signout');
  return { page, ctx, valid, releaseLogout };
}

try {
  for (const spec of [
    { label: 'desktop office', file: 'office.html', role: 'full', width: 1440, button: '#signout' },
    { label: 'phone field', file: 'index.html', role: 'field', width: 390, button: '#f-signout' }
  ]) {
    await check(`${spec.label}: waits for server logout, then rejects the old and copied session`, async () => {
      const token = `old-${spec.role}`;
      const { page, ctx, valid, releaseLogout } = await open(spec.file, token, spec.role, spec.width);
      await page.evaluate((button) => document.querySelector(button).click(), spec.button);
      await page.waitForFunction((button) => document.querySelector(button).textContent.includes('Signing out'), spec.button);
      assert.equal(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).session, SKEY), token, 'session stays until server answers');
      assert.ok(valid.has(token), 'server token is still valid while logout is pending');
      releaseLogout();
      await page.waitForFunction((k) => !localStorage.getItem(k), SKEY);
      await page.waitForSelector('#gate:not(.hide)');
      assert.ok(!valid.has(token), 'server token is invalid before browser state is cleared');
      const direct = await page.evaluate(async ([url, key, old]) => {
        const r = await fetch(url, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: old }) });
        return { status: r.status, text: await r.text() };
      }, ['https://gvfolfzseqwhhimbxgjv.supabase.co/rest/v1/rpc/cs_portal_bundle', 'test', token]);
      assert.equal(direct.status, 400);
      assert.match(direct.text, /invalid token/);
      await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [SKEY, session(token, spec.role)]);
      await page.reload();
      await page.waitForSelector('#gate:not(.hide)');
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), SKEY), null, 'copied stale session is removed');
      await ctx.close();
    });
  }

  await check('failed logout keeps the office session and offers a retry', async () => {
    const { page, ctx, valid } = await open('office.html', 'retry-token', 'full', 1440, 'fail');
    await page.evaluate(() => document.querySelector('#signout').click());
    await page.waitForFunction(() => document.querySelector('.toast') && /Could not sign out/.test(document.querySelector('.toast').textContent));
    assert.equal(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).session, SKEY), 'retry-token');
    assert.ok(valid.has('retry-token'));
    assert.equal(await page.locator('#signout').isEnabled(), true);
    await ctx.close();
  });
} finally {
  await browser.close();
  server.close();
}

console.log(`Sign-out verification passed (${checks} checks).`);
