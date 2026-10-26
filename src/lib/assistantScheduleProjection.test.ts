import assert from 'node:assert/strict';
import test from 'node:test';
import type {DigitalEmployeeOverview,ContentQueueItem} from './digitalEmployees';
import {assistantScheduleProjection,calendarWeek,beijingDay} from './assistantScheduleProjection';
const item={id:'row',title:'视频',status:'completed',plannedPublishDate:'2026-10-27',socialContentTaskId:'task-1'} as ContentQueueItem;
const overview={contentQueue:{sourceStatus:'available',items:[item,{...item,id:'undated',plannedPublishDate:''}]}} as DigitalEmployeeOverview;
test('calendar respects Beijing week and never invents time or a published receipt',()=>{
  assert.equal(beijingDay('2026-10-25T17:00:00Z'),'2026-10-26');
  assert.deepEqual(calendarWeek('2026-10-28'),{start:'2026-10-26',end:'2026-11-01'});
  const result=assistantScheduleProjection(overview,'2026-10-28');
  assert.equal(result.events[0].start,'2026-10-27');assert.equal(result.events[0].allDay,true);
  assert.equal(result.events[0].editable,false);assert.match(result.events[0].statusLabel!,/发布待核验/);
  assert.equal(result.undated.length,1);
  assert.equal(assistantScheduleProjection(overview,'2026-11-04').events.length,0);
});
test('unavailable schedule remains a read error instead of a false empty week',()=>{
  assert.throws(()=>assistantScheduleProjection({...overview,contentQueue:{...overview.contentQueue!,sourceStatus:'unavailable',sourceNote:'连接失败'}},'2026-10-28'),/连接失败/);
});
