/* Browser regression for the Greiner site-only safety history. All RPCs are
   mocked; no customer records or production sessions are touched. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ROOT, 'noop.js'));
const { chromium } = require('playwright');
const WESTIN = 'job-westin';
const records = [
  { id: 'jha-1', source: 'field', kind: 'jha', title: 'JHA', person: 'Crew A',
    occurred_at: '2026-10-28T12:00:00Z', status: 'Filed', form_type: 'jha', pdf_path: null },
  { id: 'lift-1', source: 'field', kind: 'inspection', title: 'Lift Inspection', person: 'Crew B',
    occurred_at: '2026-10-27T12:00:00Z', status: 'Filed', form_type: 'aerial_platform', pdf_path: null },
  { id: 'talk-1', source: 'talk', kind: 'talk', title: 'Toolbox Talk 1', person: 'Crew C',
    occurred_at: '2026-10-26T12:00:00Z', status: 'Completed' }
].concat(Array.from({ length: 26 }, (_, i) => ({
  id: `jha-${i + 2}`, source: 'field', kind: 'jha', title: `JHA ${i + 2}`,
  person: 'Crew A', occurred_at: '2026-10-25T12:00:00Z', status: 'Filed',
  form_type: 'jha', pdf_path: null
})));
const requests = [];
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://local').pathname;
  const file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404); response.end(); return;
  }
  const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
  response.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  const match = url.match(/supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (!match) return route.abort();
  const fn = match[1];
  const body = JSON.parse(route.request().postData() || '{}');
  requests.push({ fn, body });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  let data = null;
  if (fn === 'cs_portal_login') {
    data = { ok: true, session: 'test-session', user: 'Westin Test', role: 'field',
      expires_at: new Date(Date.now() + 86400000).toISOString(), job_ids: [WESTIN] };
  } else if (fn === 'cs_portal_field_home') {
    data = { user: 'Westin Test', company: 'Greiner Brothers',
      jobs: [{ id: WESTIN, name: 'Westin Airport Hotel', job_number: 'W1', user_forms: ['jha','aerial'] }],
      people: [], equipment: [], recent: [] };
  } else if (fn === 'cs_portal_site_safety') {
    if (body.p_job_id !== WESTIN) return route.fulfill({ status: 400, headers: cors,
      contentType: 'application/json', body: JSON.stringify({ message: 'job not permitted' }) });
    const rows = records.filter(r => body.p_kind === 'all' || r.kind === body.p_kind);
    data = { job_id: WESTIN, kind: body.p_kind, total: rows.length, offset: body.p_offset,
      items: rows.slice(body.p_offset, body.p_offset + body.p_limit) };
  } else if (fn === 'cs_portal_job_docs') data = [];
  else if (fn === 'cs_portal_field_doc') data = { id: body.p_id, form_type: 'jha', form_title: 'JHA',
    inspector_name: 'Crew A', has_defects: false, doc: { sections: [] } };
  return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
});

try {
  await page.goto(BASE);
  await page.locator('#gate-in').fill('9137');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Site safety records' }).waitFor();
  assert.equal(await page.locator('#f-site-list .card').count(), 25);
  await page.getByRole('button', { name: 'Show more' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#f-site-list .card').length === 29);
  assert.equal(await page.locator('#f-recent-sec').isVisible(), false);
  await page.getByRole('button', { name: 'Toolbox Talks' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#f-site-list .card').length === 1);
  assert.equal(await page.locator('#f-site-list .card').count(), 1);
  assert.equal(await page.getByText('JHA', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'JHAs' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#f-site-list .card').length === 25 &&
    document.querySelector('#f-site-list')?.textContent.includes('Crew A'));
  await page.getByRole('button', { name: 'Show more' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#f-site-list .card').length === 27);
  await page.getByRole('button', { name: 'View details' }).first().click();
  await page.locator('#fielddetail').waitFor();
  assert.ok(requests.some(r => r.fn === 'cs_portal_field_doc' && r.body.p_id === 'jha-1'));
  assert.ok(requests.filter(r => r.fn === 'cs_portal_site_safety').every(r => r.body.p_job_id === WESTIN));
  await page.locator('#fd-back').click();
  const phoneOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(phoneOverflow, false, 'phone has no sideways scrolling');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#f-site-list .card').length === 25);
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(desktopOverflow, false, 'desktop has no sideways scrolling');
  assert.deepEqual(errors, []);
  console.log('Site safety browser checks passed: job scope, pagination, categories, details, phone and desktop layout.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
