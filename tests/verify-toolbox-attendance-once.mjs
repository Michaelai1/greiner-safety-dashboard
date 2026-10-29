/* Total attendance counts a worker once per talk and week (Oct 29, 2026).
 *
 * Westin now has two foremen (Roger and Matt) recording attendance for the same
 * talk, and at IU a crew member can complete the talk himself while his foreman
 * also marks him present. Each record keeps what its foreman marked; the
 * "total attendance" card must not count the same worker twice.
 * Same extraction approach as verify-toolbox-log-merge.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../office.js', import.meta.url), 'utf8');
const m = src.match(/function tbtxAsLoggedTalks\(\) \{[\s\S]*?\n    \}/);
assert.ok(m, 'tbtxAsLoggedTalks not found in office.js');
assert.match(src, /var att = all\.reduce\(function \(a, t\) \{ return a \+ \(t\.attendees_counted != null \? t\.attendees_counted : t\.attendees\); \}, 0\);/,
  'the total-attendance card sums the once-per-talk count');

const W = '2026-10-26', K = 'hot-work-general-awareness';
const TBTX = { rows: [
  { id: 'roger', talk_key: K, week_start: W, talk_title: 'Hot Work', recipient_name: 'Roger (Test)', role: 'leader', crew_job_id: 'westin',
    is_test: false, submitted_at: '2026-10-30T11:00:00Z', presenter: 'Roger (Test)', attendees: ['A (Test)', 'B (Test)', 'C (Test)'], manual_attendees: [] },
  { id: 'matt', talk_key: K, week_start: W, talk_title: 'Hot Work', recipient_name: 'Matt (Test)', role: 'leader', crew_job_id: 'westin',
    is_test: false, submitted_at: '2026-10-30T11:20:00Z', presenter: 'Matt (Test)', attendees: ['b (test)', 'D (Test)'], manual_attendees: ['C (Test) '] },
  { id: 'jason', talk_key: K, week_start: W, talk_title: 'Hot Work', recipient_name: 'Jason (Test)', role: 'leader', crew_job_id: 'iu',
    is_test: false, submitted_at: '2026-10-30T10:30:00Z', presenter: 'Jason (Test)', attendees: ['Dakota (Test)', 'E (Test)'], manual_attendees: [] },
  { id: 'dakota', talk_key: K, week_start: W, talk_title: 'Hot Work', recipient_name: 'Dakota (Test)', role: 'participant',
    is_test: false, submitted_at: '2026-10-30T12:00:00Z', attendees: [], manual_attendees: [] },
  { id: 'nextweek', talk_key: 'other-talk', week_start: '2026-11-02', talk_title: 'Other', recipient_name: 'Roger (Test)', role: 'leader', crew_job_id: 'westin',
    is_test: false, submitted_at: '2026-11-06T11:00:00Z', presenter: 'Roger (Test)', attendees: ['A (Test)'], manual_attendees: [] },
  { id: 'test', talk_key: K, week_start: W, talk_title: 'Hot Work', recipient_name: 'Office (Test)', role: 'leader', is_test: true,
    submitted_at: '2026-10-30T09:00:00Z', attendees: ['A (Test)', 'Z (Test)'], manual_attendees: [] }
] };
const tbtxCount = (x) => (x.attendees || []).length + (x.manual_attendees || []).length;
const out = eval(`(${m[0].replace('function tbtxAsLoggedTalks', 'function _f')})`)();
const by = Object.fromEntries(out.map((t) => [t.tbtx_id, t]));

assert.equal(by.roger.attendees, 3, 'Roger’s record shows the 3 he marked');
assert.equal(by.matt.attendees, 3, 'Matt’s record shows the 3 he marked (2 picked + 1 typed in)');
assert.equal(by.roger.attendees_counted, 3);
assert.equal(by.matt.attendees_counted, 1, 'only D is new: B and C were already counted (case and spaces ignored)');
assert.equal(by.jason.attendees_counted, 2);
assert.equal(by.dakota.attendees_counted, 0, 'Dakota completing it himself is not a second attendance when Jason already marked him');
assert.equal(by.nextweek.attendees_counted, 1, 'another week’s talk counts on its own');
assert.ok(!by.test, 'test sends stay out');
const total = out.reduce((a, t) => a + (t.attendees_counted != null ? t.attendees_counted : t.attendees), 0);
assert.equal(total, 3 + 1 + 2 + 0 + 1, 'distinct worker-sessions: A B C D (Westin) + Dakota E (IU) + A next week');
console.log('Toolbox Talk attendance-once verification passed (7 records, total ' + total + ').');
