import assert from 'node:assert/strict';
import test from 'node:test';
import { freezePresenterMotherSegments, type PresenterMotherSlotInput } from '../../shared/contracts/presenterMotherSegments.js';
import { executePresenterMotherSegments, verifyPresenterMotherExecutionResult, type PresenterMotherProviderRequest } from './presenterMotherSegmentExecution.js';
import {presenterMotherLineageByScene} from './socialContentInitialSceneCache.js';

const slots:PresenterMotherSlotInput[]=[
 {slotId:'s1',referenceShotId:'r1',startSeconds:0,endSeconds:.4,spokenText:'Beauty brand owners,',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s2',referenceShotId:'r2',startSeconds:.4,endSeconds:4.83,spokenText:'stop guessing.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s30',referenceShotId:'r30',startSeconds:26.6,endSeconds:28.7,spokenText:'Tell us the market',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s31',referenceShotId:'r31',startSeconds:28.7,endSeconds:29.2,spokenText:'you need.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s36',referenceShotId:'r36',startSeconds:34.3,endSeconds:37.23,spokenText:'DM for the catalog.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
];

test('three mother provider calls yield five hash-bound crop receipts',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots}),calls:PresenterMotherProviderRequest[]=[];
 const result=await executePresenterMotherSegments({grouping,provider:async request=>{calls.push(request);return{providerId:'controlled',providerReceiptRef:`receipt:${request.segmentHash}`,outputRef:`output:${request.segmentId}`,outputSha256:String(request.segmentId.at(-1)).repeat(64),durationSeconds:request.durationSeconds,dynamicQa:{identitySimilarity:.99,identityThreshold:.9,lipSyncScore:.96,lipSyncThreshold:.9,receiptRef:'qa:controlled',reportHash:'e'.repeat(64)}};}});
 assert.equal(calls.length,3);assert.equal(result.providerReceipts.length,3);assert.equal(result.slotCropReceipts.length,5);
 assert.deepEqual(calls.map(call=>call.memberSlotIds),[['s1','s2'],['s30','s31'],['s36']]);
 assert.deepEqual(result.slotCropReceipts.map(receipt=>[receipt.slotId,receipt.cropStartSeconds,receipt.cropEndSeconds]),[['s1',0,.4],['s2',.4,4.83],['s30',0,2.099999999999998],['s31',2.099999999999998,2.599999999999998],['s36',0,2.9299999999999997]]);
 for(const crop of result.slotCropReceipts){const mother=result.providerReceipts.find(receipt=>receipt.segmentId===crop.segmentId)!;assert.equal(crop.segmentHash,mother.segmentHash);assert.equal(crop.providerReceiptHash,mother.receiptHash);assert.equal(crop.sourceOutputSha256,mother.outputSha256);assert.match(crop.receiptHash,/^[a-f0-9]{64}$/);}
 assert.equal(result.groupingHash,grouping.recordHash);assert.match(result.recordHash,/^[a-f0-9]{64}$/);
 assert.equal(verifyPresenterMotherExecutionResult(result),true);
 const baseline={scenes:slots.map(slot=>({sceneId:slot.slotId}))} as any,lineage=presenterMotherLineageByScene({taskId:'task',baseline,execution:result});
 assert.equal(lineage.size,5);assert.equal(lineage.get('s2')!.slotCropReceipt.slotId,'s2');assert.equal(lineage.get('s2')!.providerReceipt.segmentId,'presenter-mother-1');
 assert.notEqual('s2','production-scene-s2','cache lineage keys stay on baseline slots while productionSceneId remains independently assigned');
 const changed=structuredClone(result);changed.slotCropReceipts[0]!.providerReceiptHash='f'.repeat(64);assert.equal(verifyPresenterMotherExecutionResult(changed),false);assert.throws(()=>presenterMotherLineageByScene({taskId:'task',baseline,execution:changed}),/execution_invalid/);
});

test('invalid or too-short provider output fails before crop receipts can be issued',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots});
 await assert.rejects(executePresenterMotherSegments({grouping,provider:async()=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:'output',outputSha256:'b'.repeat(64),durationSeconds:.1,dynamicQa:{identitySimilarity:.99,identityThreshold:.9,lipSyncScore:.96,lipSyncThreshold:.9,receiptRef:'qa:controlled',reportHash:'e'.repeat(64)}})}),/provider_result_invalid/);
});

test('cache mapping refuses crop receipts for an unknown scene identity',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots}),execution=await executePresenterMotherSegments({grouping,provider:async request=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:'output',outputSha256:'c'.repeat(64),durationSeconds:request.durationSeconds,dynamicQa:{identitySimilarity:.99,identityThreshold:.9,lipSyncScore:.96,lipSyncThreshold:.9,receiptRef:'qa:controlled',reportHash:'e'.repeat(64)}})});
 assert.throws(()=>presenterMotherLineageByScene({taskId:'task',baseline:{scenes:[{sceneId:'other'}]} as any,execution}),/scene_invalid/);
});

test('failed identity or lip-sync QA cannot issue execution or cache receipts',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots});
 await assert.rejects(executePresenterMotherSegments({grouping,provider:async request=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:'output',outputSha256:'c'.repeat(64),durationSeconds:request.durationSeconds,dynamicQa:{identitySimilarity:.89,identityThreshold:.9,lipSyncScore:.96,lipSyncThreshold:.9,receiptRef:'qa:controlled',reportHash:'e'.repeat(64)}})}),/dynamic_qa_failed/);
});

test('unconfigured optional SyncNet does not block an identity-approved mother segment',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots:[slots[0]!]});
 const execution=await executePresenterMotherSegments({grouping,provider:async request=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:'output',outputSha256:'d'.repeat(64),durationSeconds:request.durationSeconds,dynamicQa:{identitySimilarity:.99,identityThreshold:.9,lipSyncStatus:'skipped_unconfigured',receiptRef:'qa:visual-semantic',reportHash:'f'.repeat(64)}})});
 assert.equal(execution.providerReceipts[0]?.dynamicQa.lipSyncStatus,'skipped_unconfigured');
 assert.equal(verifyPresenterMotherExecutionResult(execution),true);
});
