import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { referenceSourcePolicy } from './referenceSourcePolicy.js';
import { buildWeeklyOperatingScheduleSkeleton } from './planningAuthority.js';
test('cold start remains external and incompatible profiles cannot override the route', () => {
  assert.equal(referenceSourcePolicy(undefined, 'cold_start')?.externalPercent, 100);
  assert.throws(() => referenceSourcePolicy({profile:'b2b_established',ownedPercent:40,externalPercent:60,allocationUnit:'mother_content'}, 'cold_start'));
  assert.throws(() => referenceSourcePolicy({profile:'b2b_cold_start',ownedPercent:20,externalPercent:80,allocationUnit:'mother_content'}, 'cold_start'));
});
test('confirmed 40/60 and 20/80 quotas count mothers rather than platform versions', () => {
  for (const ownedPercent of [40,20]) {
    const policy=referenceSourcePolicy({profile:'b2b_established',ownedPercent,externalPercent:100-ownedPercent,allocationUnit:'mother_content'},'account_repair')!;
    const publications=Array.from({length:10},(_,i)=>({publicationTaskId:`pub-${i}`,motherContentId:`mother-${Math.floor(i/2)}`,accountId:`account-${i%2}`,platform:'tiktok',publishWindow:'2026-10-07T10:00:00+08:00'}));
    const pkg={packageId:'week',version:1,createdAt:'2026-10-01T00:00:00Z',objective:'询盘',referenceSourcePolicy:policy,socialContentPackage:{publicationTasks:publications}} as unknown as WeeklyOperatingPackage;
    const skeleton=buildWeeklyOperatingScheduleSkeleton(pkg);
    assert.equal(skeleton.slots.length,5);
    assert.equal(skeleton.slots.filter(slot=>slot.referenceSource==='owned').length,ownedPercent===40?2:1);
    assert.equal(skeleton.slots.reduce((sum,slot)=>sum+slot.publicationTaskIds.length,0),10);
  }
});
