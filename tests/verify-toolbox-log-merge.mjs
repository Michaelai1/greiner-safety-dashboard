/* A texted Toolbox Talk that the foreman submitted must appear in the Log and
 * count toward the cards.
 *
 * It used to live only in the "Sent by text" panel, so on a day a talk had
 * actually been held the Log still read "No toolbox talks logged" and all four
 * cards showed 0. This exercises the mapper that feeds the Log, against the same
 * row shape cs_portal_tbt_texts returns.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../office.js', import.meta.url), 'utf8');

const m = src.match(/function tbtxAsLoggedTalks\(\) \{[\s\S]*?\n    \}/);
assert.ok(m, 'tbtxAsLoggedTalks not found in office.js');

const TBTX = { rows: [
  // Foreman-led, submitted: 2 marked present + 1 typed in = 3 attended.
  { id: 'lead-1', talk_title: 'Fall Protection', recipient_name: 'Foreman One (Test)',
    role: 'leader', crew_job_id: 'job-purdue', is_test: false,
    submitted_at: '2026-10-05T14:24:00Z', active_ms: 9 * 60000, presenter: 'Foreman One (Test)',
    attendees: ['A (Test)', 'B (Test)'], manual_attendees: ['C (Test)'] },
  // Individual, submitted: counts as the one person who acknowledged it.
  { id: 'solo-1', talk_title: 'Ladder Safety', recipient_name: 'Worker Two (Test)',
    role: 'participant', is_test: false, submitted_at: '2026-10-04T13:00:00Z',
    active_ms: 30000, attendees: [], manual_attendees: [] },
  // Not submitted yet: still only "awaiting", never a held talk.
  { id: 'open-1', talk_title: 'Fall Protection', recipient_name: 'Worker Three (Test)',
    role: 'participant', is_test: false, submitted_at: null, attendees: [], manual_attendees: [] },
  // A test send is not a talk anybody attended.
  { id: 'test-1', talk_title: 'Fall Protection', recipient_name: 'Office Copy (Test)',
    role: 'leader', is_test: true, submitted_at: '2026-10-05T12:00:00Z',
    attendees: ['X (Test)'], manual_attendees: [] }
] };

const tbtxCount = (x) => (x.attendees || []).length + (x.manual_attendees || []).length;
const fn = eval(`(${m[0].replace('function tbtxAsLoggedTalks', 'function _f')})`);
const out = fn();

assert.equal(out.length, 2, 'only submitted, non-test sends become logged talks');

const lead = out.find((t) => t.topic === 'Fall Protection');
assert.ok(lead, 'the foreman-led talk is present');
assert.equal(lead.attendees, 3, 'attendance counts marked plus typed-in names');
assert.equal(lead.date, '2026-10-05', 'dated by submission, matching the "held today" basis');
assert.equal(lead.job_id, 'job-purdue', 'carries the crew job so the jobsite filter works');
assert.equal(lead.presented_by, 'Foreman One (Test)');
assert.equal(lead.minutes, 9);
assert.equal(lead.from_text, true, 'flagged so the row opens the text record');
assert.equal(lead.tbtx_id, 'lead-1', 'keeps the id the detail view needs');
assert.ok(String(lead.id).startsWith('tbt:'), 'namespaced id cannot collide with a logged talk');
assert.equal(lead.archived, false, 'not archived, so it reaches the Log');

const solo = out.find((t) => t.topic === 'Ladder Safety');
assert.equal(solo.attendees, 1, 'an individual talk counts as one attendee');
assert.equal(solo.minutes, 1, 'under a minute still reads as 1 min, not 0');

assert.ok(!out.some((t) => t.tbtx_id === 'open-1'), 'an unsubmitted talk is excluded');
assert.ok(!out.some((t) => t.tbtx_id === 'test-1'), 'a test send is excluded');

/* The cards: these are what showed 0 on a day a talk had happened. */
const today = '2026-10-05';
assert.equal(out.filter((t) => t.date === today).length, 1, 'held today');
assert.equal(out.reduce((a, t) => a + t.attendees, 0), 4, 'total attendance');

console.log('Toolbox Talk log merge verified '
  + '(submitted texts reach the Log, attendance counted, tests and unsubmitted excluded).');
