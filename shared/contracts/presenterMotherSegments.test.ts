import assert from 'node:assert/strict';
import test from 'node:test';
import { freezePresenterMotherSegments, verifyFrozenPresenterMotherSegments, type PresenterMotherSlotInput } from './presenterMotherSegments.js';

const slots: PresenterMotherSlotInput[] = [
  {slotId:'slot-1',referenceShotId:'reference-shot-1',startSeconds:0,endSeconds:.4,spokenText:'Beauty brand owners,',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
  {slotId:'slot-2',referenceShotId:'reference-shot-2',startSeconds:.4,endSeconds:4.83,spokenText:'stop launching products based only on guesswork.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
  {slotId:'slot-30',referenceShotId:'reference-shot-30',startSeconds:26.6,endSeconds:28.7,spokenText:'Tell us what market',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
  {slotId:'slot-31',referenceShotId:'reference-shot-31',startSeconds:28.7,endSeconds:29.2,spokenText:'you want to sell in.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
  {slotId:'slot-36',referenceShotId:'reference-shot-36',startSeconds:34.3,endSeconds:37.23,spokenText:'DM me for the latest OEM catalog.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
];

test('five presenter slots freeze into three contiguous mother segments',()=>{
  const frozen=freezePresenterMotherSegments({taskId:'socialtask_ea31ab88b2a46bb4b72d3b21',referenceAnalysisHash:'b10fd5b6050396719e93aba198cd56bade24e9ed7d202442a680287fe940de7e',slots});
  assert.deepEqual(frozen.groups.map(group=>({range:[group.startSeconds,group.endSeconds],members:group.memberSlotIds,script:group.mergedSpokenText})),[
    {range:[0,4.83],members:['slot-1','slot-2'],script:'Beauty brand owners, stop launching products based only on guesswork.'},
    {range:[26.6,29.2],members:['slot-30','slot-31'],script:'Tell us what market you want to sell in.'},
    {range:[34.3,37.23],members:['slot-36'],script:'DM me for the latest OEM catalog.'},
  ]);
  assert.match(frozen.recordHash,/^[a-f0-9]{64}$/);
  assert.equal(new Set(frozen.groups.map(group=>group.contentHash)).size,3);
  assert.equal(verifyFrozenPresenterMotherSegments(frozen),true);
});

test('hashes bind membership, range and merged words',()=>{
  const frozen=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots});
  for(const mutate of [
    (copy:any)=>copy.groups[0].memberSlotIds.reverse(),
    (copy:any)=>copy.groups[0].endSeconds=4.8,
    (copy:any)=>copy.groups[0].mergedSpokenText+=' changed',
  ]){const copy=structuredClone(frozen);mutate(copy);assert.equal(verifyFrozenPresenterMotherSegments(copy),false);}
});

test('B-roll people are excluded unless front-facing lip sync is explicitly required',()=>{
  const frozen=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots:[...slots,{slotId:'broll',referenceShotId:'reference-shot-11',startSeconds:9.9,endSeconds:14.3,spokenText:'voice over',materialType:'talking_head',frontFacing:true,lipSyncRequired:false}].sort((a,b)=>a.startSeconds-b.startSeconds)});
  assert.equal(frozen.groups.length,3);
  assert.equal(frozen.groups.flatMap(group=>group.memberSlotIds).includes('broll'),false);
});

test('overlap and unstable slot identity fail closed before hashing',()=>{
  assert.throws(()=>freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots:[slots[0]!,{...slots[1]!,startSeconds:.3}]}),/slot_overlap/);
  assert.throws(()=>freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots:[slots[0]!,{...slots[1]!,slotId:'slot-1'}]}),/slot_id_duplicate/);
  assert.throws(()=>freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'bad',slots}),/reference_hash_invalid/);
});

test('v2 splits adjacent shots by frozen visual compatibility and preserves v1 hashes',()=>{
 const keyed=slots.map((slot,index)=>({...slot,visualCompatibilityHash:(index===1?'b':'a').repeat(64)}));
 const frozen=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'c'.repeat(64),slots:keyed});
 assert.equal(frozen.schemaVersion,'presenter-mother-segments.v2');
 assert.deepEqual(frozen.groups.map(group=>group.memberSlotIds),[['slot-1'],['slot-2'],['slot-30','slot-31'],['slot-36']]);
 assert.equal(verifyFrozenPresenterMotherSegments(frozen),true);
 const changed=structuredClone(frozen);changed.groups[0]!.visualCompatibilityHash='d'.repeat(64);assert.equal(verifyFrozenPresenterMotherSegments(changed),false);
 const downgrade=structuredClone(frozen);downgrade.schemaVersion='presenter-mother-segments.v1';assert.equal(verifyFrozenPresenterMotherSegments(downgrade),false);
 assert.throws(()=>freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'c'.repeat(64),slots:[keyed[0]!,slots[1]!]}),/visual_compatibility_missing/);
 const legacy=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'c'.repeat(64),slots});
 assert.equal(legacy.schemaVersion,'presenter-mother-segments.v1');assert.equal(legacy.groups.length,3);assert.equal(verifyFrozenPresenterMotherSegments(legacy),true);
});
