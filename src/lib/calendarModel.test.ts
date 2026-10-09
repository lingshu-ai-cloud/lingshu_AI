import assert from 'node:assert/strict';
import { calendarDateTimeValue, calendarDayKey, calendarInstant, calendarMovedInstant, calendarPublishStatus, canMoveCalendarPost } from './calendarModel';

assert.equal(calendarDayKey('2026-10-08T18:30:00Z'), '2026-10-09', 'publishing dates use Beijing time, independent of the browser timezone');
assert.equal(calendarDateTimeValue('2026-10-08T18:30:00Z'), '2026-10-09T02:30');
assert.equal(calendarInstant('2026-10-09T02:30').toISOString(), '2026-10-08T18:30:00.000Z');
assert.equal(calendarDayKey('2026-10-09'), '2026-10-09', 'date-only business deadlines do not change timezone');
assert.equal(calendarInstant('2026-07-01T10:00', 'America/New_York').toISOString(), '2026-07-01T14:00:00.000Z');
assert.equal(calendarInstant('2026-12-01T10:00', 'America/New_York').toISOString(), '2026-12-01T15:00:00.000Z');
assert.throws(() => calendarInstant('2026-03-08T02:30', 'America/New_York'), 'a nonexistent DST clock time must not silently change the schedule');
assert.throws(() => calendarInstant('2026-11-01T01:30', 'America/New_York'), 'an ambiguous DST clock time must require an explicit different time');
assert.equal(calendarMovedInstant({ start: '2026-10-09T18:30:00+08:00', timeZone: 'Asia/Shanghai' }, '2026-10-10T00:00:00+08:00', true), '2026-10-10T10:30:00.000Z', 'dropping a timed event onto a day preserves the original clock time');
assert.equal(calendarMovedInstant({ start: '2026-10-09T18:30:00+08:00', timeZone: 'Asia/Shanghai' }, '2026-10-10T11:00:00+08:00', false), '2026-10-10T03:00:00.000Z', 'dropping into an hour slot uses the explicitly selected time');
const post = { id: 'post-1', status: 'scheduled' };
assert.equal(canMoveCalendarPost(post, false), false, 'read-only users cannot drag or use the move form');
assert.equal(canMoveCalendarPost(post, true), true);
for (const status of ['published', 'needs_attention', 'publishing', 'finalize_pending', 'partial', 'awaiting_reapproval']) {
  assert.equal(canMoveCalendarPost({ ...post, status }, true), false, `${status} must retain its execution/approval boundary`);
}
assert.equal(canMoveCalendarPost({ ...post, scheduleLocked: true }, true), false);
assert.equal(canMoveCalendarPost({ ...post, platformPostId: 'receipt-1' }, true), false);
assert.equal(canMoveCalendarPost({ ...post, id: 'demo-calendar-1' }, true), false, 'preview events never persist');
assert.equal(calendarPublishStatus({ status: 'needs_attention', platformPostId: 'receipt-1' }), 'needs_action', 'receipt recovery must remain visible even if a receipt exists');
assert.equal(calendarPublishStatus({ status: 'finalize_pending', platformPostId: 'receipt-1' }), 'working');
assert.equal(calendarPublishStatus({ status: 'scheduled', platformPostId: 'receipt-1' }), 'done');
console.log('Calendar timezone and schedule boundary tests passed');
