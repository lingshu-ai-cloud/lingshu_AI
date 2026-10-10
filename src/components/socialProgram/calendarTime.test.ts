import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarClock,calendarDateTime,frozenCalendarClock,calendarTimestampLabel} from './calendarTime';
import {calendarPendingReferences,type AgentCalendarTask} from '../smartBusiness/AgentWeeklyCalendar';
test('frozen New York publication offsets remain independent of Shanghai browser midnight',()=>{
 const clock=calendarClock('2026-10-10T12:00:00-04:00','publication_offset');
 assert.deepEqual(calendarDateTime('2026-10-10T02:30:00Z',clock),{date:'2026-10-09',time:'22:30'});
 assert.match(calendarTimestampLabel('2026-10-10T02:30:00Z',clock),/2026-10-09 22:30 · UTC-04:00/);
 const task={id:'original',date:'2026-10-09',agent:'content',status:'active',dueAt:'2026-10-09T20:00:00-04:00',calendarClock:clock} as AgentCalendarTask;
 assert.equal(calendarPendingReferences([task],Date.parse('2026-10-10T02:30:00Z')).length,0);
 assert.equal(calendarPendingReferences([task,task],Date.parse('2026-10-10T04:30:00Z')).length,1);
});
test('DST offsets come from frozen timestamp and never pretend a fixed offset is an IANA zone',()=>{
 const before=calendarClock('2026-11-01T01:30:00-04:00'),after=calendarClock('2026-11-01T01:30:00-05:00');
 assert.equal(calendarDateTime('2026-11-01T05:30:00Z',before).time,'01:30');
 assert.equal(calendarDateTime('2026-11-01T06:30:00Z',after).time,'01:30');
 assert.equal(before.label,'UTC-04:00'); assert.equal(after.label,'UTC-05:00');
 assert.equal(calendarClock().label,'UTC（冻结时区未知）');
});

test('actual frozen IANA zone uses DST while malformed zones fall back to explicit offset',()=>{
 const ny=frozenCalendarClock(['America/New_York'],'2026-11-01T01:30:00-04:00');
 assert.equal(ny.source,'frozen_iana');
 assert.equal(calendarDateTime('2026-11-01T05:30:00Z',ny).time,'01:30');
 assert.equal(calendarDateTime('2026-11-01T06:30:00Z',ny).time,'01:30');
 assert.equal(calendarDateTime('2026-11-01T07:30:00Z',ny).time,'02:30');
 assert.equal(frozenCalendarClock(['invalid zone'],'2026-10-09T10:00:00+08:00').label,'UTC+08:00');
});
test('timezone-missing legacy times use labelled UTC fallback rather than browser timezone',()=>{
 const unknown=calendarClock('2026-10-10T02:30:00');
 assert.equal(unknown.source,'utc_fallback');
 assert.deepEqual(calendarDateTime('2026-10-10T02:30:00',unknown),{date:'2026-10-10',time:'02:30'});
});
