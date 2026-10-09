import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeFollowupSchedules, orderedFollowupItems } from './followupDraftFreeze.js';
test('each customer gets exactly one scheduling call from a frozen clock regardless of work performed', () => {
  const capturedAt = new Date('2026-10-06T08:59:59Z'); let calls = 0;
  const drafts = freezeFollowupSchedules([{ member:{id:'a'}, customer:{timeZone:'UTC'} },{member:{id:'b'},customer:{timeZone:'Asia/Shanghai'}}], (_zone, clock) => { calls++; const result=clock.toISOString(); clock.setDate(clock.getDate()+1); return result; }, capturedAt);
  assert.equal(calls,2); assert.equal(drafts[0]!.scheduledAt,capturedAt.toISOString()); assert.equal(drafts[1]!.scheduledAt,capturedAt.toISOString());
});
test('frozen member order survives arbitrary storage order while legacy batches preserve their existing order', () => {
  const items = [{segment_member_id:'b'},{segment_member_id:'a'}];
  assert.deepEqual(orderedFollowupItems(items,{frozenMemberOrder:['a','b']}).map(item=>item.segment_member_id),['a','b']);
  assert.deepEqual(orderedFollowupItems(items,{}),items);
  for (const policy of [{frozenMemberOrder:['a','a']},{frozenMemberOrder:['a']},{frozenMemberOrder:['a','c']}]) assert.throws(()=>orderedFollowupItems(items,policy));
});
