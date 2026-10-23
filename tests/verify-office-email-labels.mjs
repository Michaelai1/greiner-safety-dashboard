/* office.js, Toolbox Talks "Sent by text" panel: channel and format labels, with and without the
 * email-channel columns. Slices the tbtx* functions out of office.js (same approach as
 * tests/verify-office-demo.mjs) and runs them with stubbed helpers. No browser, no network.
 * Ported Oct 22 (release candidate) from the delivery worktree's
 * delivery-readiness/tests/office-email-labels.mjs; only the path to office.js changed.
 *   node tests/verify-office-email-labels.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const js = fs.readFileSync(path.join(ROOT, 'office.js'), 'utf8');
const slice = (name, endName) => {
  const i = js.indexOf(`  function ${name}(`); assert.ok(i > -1, `${name} missing from office.js`);
  const j = js.indexOf(`\n  function ${endName}(`, i); assert.ok(j > -1, `${endName} missing from office.js`);
  return js.slice(i, j);
};
const after = (name) => { const i = js.indexOf(`  function ${name}(`); const j = js.indexOf('\n  function ', i + 10); return js.slice(i, j > -1 ? j : undefined); };

const M = new Function(`
  var drawers = [];
  function esc(s){ return String(s == null ? '' : s); }
  function pill(c, t){ return '[' + t + ']'; }
  function fmtWhen(t){ return 'at ' + String(t); }
  function kv(k, v, bad){ return k + ': ' + v + (bad ? ' (bad)' : '') + '\\n'; }
  function drawer(title, sub, body){ drawers.push({ title: title, sub: sub, body: body }); }
  function jobName(){ return 'Job'; } function jobNum(){ return 'C1'; }
  function tableWrap(cols, rows, empty){ return rows.length ? rows.join('\\n') : empty; }
  var TBTX = { state: 'ok', rows: [] };
  ${slice('tbtxWhen', 'openTbtx')}
  ${after('openTbtx')}
  return { tbtxFormatLabel: tbtxFormatLabel, tbtxDelivery: tbtxDelivery, tbtxProgress: tbtxProgress,
           tbtxPanelHtml: tbtxPanelHtml, openTbtx: openTbtx, TBTX: TBTX, drawers: drawers };
`)();

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`PASS ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } };
const base = { id: 'x', talk_title: 'Falls from Ladder', recipient_name: 'Demo Person (fictional)', role: 'participant', is_test: true,
  attendees: [], manual_attendees: [] };
const drawerFor = (row) => { M.TBTX.rows = [row]; M.drawers.length = 0; M.openTbtx(row.id); return M.drawers[0].body; };

// ---- today's rows (no channel column): behaviour unchanged ----
check('legacy sent text: Texted pill, no channel needed', () => assert.equal(M.tbtxDelivery({ ...base, send_status: 'sent', sent_at: 'T1' }), '[Texted at T1]'));
check('legacy held text: On hold', () => assert.equal(M.tbtxDelivery({ ...base, send_status: 'held' }), '[On hold (not sent)]'));
check('legacy cancelled text still reads Cancelled (a real cancelled text)', () => assert.equal(M.tbtxDelivery({ ...base, send_status: 'cancelled' }), '[Cancelled]'));
check('legacy row without any send: Not texted', () => assert.equal(M.tbtxDelivery({ ...base }), '[Not texted]'));
check('format labels: guided / doc / video / unknown', () => {
  assert.equal(M.tbtxFormatLabel('guided'), 'Guided talk'); assert.equal(M.tbtxFormatLabel('guided', true), 'Guided Talk');
  assert.equal(M.tbtxFormatLabel('doc'), 'Original document'); assert.equal(M.tbtxFormatLabel('video'), 'Video');
  assert.equal(M.tbtxFormatLabel(undefined), 'Original document');
});
check('drawer, legacy guided submit: Presented as Guided Talk, Format Guided talk, Text section', () => {
  const d = drawerFor({ ...base, send_status: 'sent', sent_at: 'T1', submitted_at: 'T2', format_used: 'guided', phone_last4: '0101' });
  assert.match(d, /Presented as: Guided Talk/); assert.match(d, /Format: Guided talk/); assert.match(d, /sec-h">Text</); assert.match(d, /ends 0101/);
  assert.match(d, /Text status: Sent at T1/);
});
check('drawer, legacy doc submit: Original document', () => {
  const d = drawerFor({ ...base, send_status: 'sent', submitted_at: 'T2', format_used: 'doc' });
  assert.match(d, /Presented as: Original document/); assert.match(d, /Format: Original document/);
});
check('drawer, legacy video submit (format_used null before the migration): Not recorded, not "Original document"', () => {
  const d = drawerFor({ ...base, send_status: 'sent', submitted_at: 'T2', format_used: null });
  assert.match(d, /Presented as: Not recorded/); assert.ok(!/Format: Original document/.test(d));
});

// ---- after the migration: channel + video ----
check('video submit is labelled Video in the drawer (both places)', () => {
  const d = drawerFor({ ...base, channel: 'sms', send_status: 'sent', submitted_at: 'T2', format_used: 'video' });
  assert.match(d, /Presented as: Video/); assert.match(d, /Format: Video/); assert.ok(!/Original document/.test(d));
});
check('email row: Email pill, never a send status, never Cancelled', () => {
  const p = M.tbtxDelivery({ ...base, channel: 'email', send_status: null });
  assert.equal(p, '[Email]');
  assert.equal(M.tbtxDelivery({ ...base, channel: 'email', send_status: 'cancelled' }), '[Email]');
});
check('email row in the list: "by email", no phone digits, Email pill', () => {
  M.TBTX.rows = [{ ...base, channel: 'email', phone_last4: '', send_at: 'T0' }];
  const h = M.tbtxPanelHtml();
  assert.match(h, /by email/); assert.match(h, /\[Email\]/); assert.ok(!/ends /.test(h)); assert.ok(!/Cancelled/.test(h));
});
check('sms row with channel present: unchanged (ends last4, Texted)', () => {
  M.TBTX.rows = [{ ...base, channel: 'sms', phone_last4: '0102', send_status: 'sent', sent_at: 'T1' }];
  const h = M.tbtxPanelHtml();
  assert.match(h, /ends 0102/); assert.match(h, /\[Texted at T1\]/); assert.ok(!/by email/.test(h));
});
check('drawer, email row: Email section, Delivery by n8n, no Text status, no address', () => {
  const d = drawerFor({ ...base, channel: 'email', send_at: 'T0', opened_at: 'T1', submitted_at: 'T2', format_used: 'video' });
  assert.match(d, /sec-h">Email</); assert.match(d, /\(by email\)/); assert.match(d, /Delivery: Email link \(sent by n8n/);
  assert.ok(!/Text status/.test(d)); assert.ok(!/@/.test(d)); assert.match(d, /Presented as: Video/);
});
check('email row progress: opened / submitted pills work; no "Not opened yet" claim without a send record', () => {
  assert.equal(M.tbtxProgress({ ...base, channel: 'email' }), '<span class="muted">—</span>');
  assert.match(M.tbtxProgress({ ...base, channel: 'email', opened_at: 'T1' }), /Opened at T1/);
  assert.match(M.tbtxProgress({ ...base, channel: 'email', submitted_at: 'T2' }), /Submitted at T2/);
});
check('office.js is valid JavaScript', () => new Function(js));

console.log(`\nOFFICE EMAIL LABELS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
