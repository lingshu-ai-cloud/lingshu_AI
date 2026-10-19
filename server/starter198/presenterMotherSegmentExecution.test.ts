import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { freezePresenterMotherSegments, type PresenterMotherSlotInput } from '../../shared/contracts/presenterMotherSegments.js';
import { assertRestoredPresenterMotherExecution,executePresenterMotherSegments, verifyPresenterMotherExecutionResult, type PresenterMotherProviderRequest } from './presenterMotherSegmentExecution.js';
import {presenterMotherLineageByScene} from './socialContentInitialSceneCache.js';

const slots:PresenterMotherSlotInput[]=[
 {slotId:'s1',referenceShotId:'r1',startSeconds:0,endSeconds:.4,spokenText:'Beauty brand owners,',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s2',referenceShotId:'r2',startSeconds:.4,endSeconds:4.83,spokenText:'stop guessing.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s30',referenceShotId:'r30',startSeconds:26.6,endSeconds:28.7,spokenText:'Tell us the market',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s31',referenceShotId:'r31',startSeconds:28.7,endSeconds:29.2,spokenText:'you need.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s36',referenceShotId:'r36',startSeconds:34.3,endSeconds:37.23,spokenText:'DM for the catalog.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
];
const qa=(segmentHash:string,outputVideoSha256:string)=>({identitySimilarity:.99,identityThreshold:.9,segmentHash,outputVideoSha256,frozenAudioSha256:'a'.repeat(64),outputAudioSha256:'b'.repeat(64),audioTrackMatchesFrozen:true,audioTrackReceiptRef:'audio:measured',audioTrackReportHash:'c'.repeat(64),lipSyncStatus:'passed' as const,lipSyncModelSha256:'d'.repeat(64),lipSyncReceiptRef:'sync:measured',lipSyncScore:.96,lipSyncThreshold:.9,receiptRef:'qa:controlled',reportHash:'e'.repeat(64)});

test('three mother provider calls yield five hash-bound crop receipts',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots}),calls:PresenterMotherProviderRequest[]=[];
 const result=await executePresenterMotherSegments({grouping,provider:async request=>{calls.push(request);const outputSha256=String(request.segmentId.at(-1)).repeat(64);return{providerId:'controlled',providerReceiptRef:`receipt:${request.segmentHash}`,outputRef:`output:${request.segmentId}`,outputSha256,durationSeconds:request.durationSeconds,dynamicQa:qa(request.segmentHash,outputSha256)};}});
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
 await assert.rejects(executePresenterMotherSegments({grouping,provider:async request=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:'output',outputSha256:'b'.repeat(64),durationSeconds:.1,dynamicQa:qa(request.segmentHash,'b'.repeat(64))})}),/provider_result_invalid/);
});

test('cache mapping refuses crop receipts for an unknown scene identity',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots}),execution=await executePresenterMotherSegments({grouping,provider:async request=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:'output',outputSha256:'c'.repeat(64),durationSeconds:request.durationSeconds,dynamicQa:qa(request.segmentHash,'c'.repeat(64))})});
 assert.throws(()=>presenterMotherLineageByScene({taskId:'task',baseline:{scenes:[{sceneId:'other'}]} as any,execution}),/scene_invalid/);
});

test('failed identity or lip-sync QA cannot issue execution or cache receipts',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots});
 await assert.rejects(executePresenterMotherSegments({grouping,provider:async request=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:'output',outputSha256:'c'.repeat(64),durationSeconds:request.durationSeconds,dynamicQa:{...qa(request.segmentHash,'c'.repeat(64)),identitySimilarity:.89}})}),/dynamic_qa_failed/);
});

test('unconfigured lip-sync or missing frozen audio evidence blocks a mother segment',async()=>{
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots:[slots[0]!]});
 for(const bad of [{lipSyncStatus:'skipped_unconfigured' as const},{audioTrackMatchesFrozen:false},{lipSyncModelSha256:undefined},{audioTrackReportHash:undefined},{outputVideoSha256:'f'.repeat(64)},{segmentHash:'f'.repeat(64)}]){
  await assert.rejects(executePresenterMotherSegments({grouping,provider:async request=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:'output',outputSha256:'d'.repeat(64),durationSeconds:request.durationSeconds,dynamicQa:{...qa(request.segmentHash,'d'.repeat(64)),...bad}})}),/dynamic_qa_failed/);
 }
});

test('cached mother result requires current grouping, frozen audio, readable measured reports and crop bytes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mother-restore-'));
 try{
  const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots:[slots[0]!]}),group=grouping.groups[0]!;
  const output=path.join(root,'mother.mp4'),audio=path.join(root,'audio.json'),lip=path.join(root,'lip.json');
  const outputBytes=Buffer.from('actual mother bytes'),outputSha=createHash('sha256').update(outputBytes).digest('hex');await writeFile(output,outputBytes);
  const audioBody={schemaVersion:'presenter-mother-audio-track.v1',segmentHash:group.contentHash,outputVideoSha256:outputSha,frozenAudioSha256:'a'.repeat(64),outputAudioSha256:'b'.repeat(64),sampleRate:8000,comparison:{passed:true,correlation:.95,offsetMs:0,durationDriftMs:0}};
  const audioHash=createHash('sha256').update(JSON.stringify(audioBody)).digest('hex');await writeFile(audio,JSON.stringify({...audioBody,reportHash:audioHash}));
  const lipBody={schemaVersion:'presenter-mother-syncnet.v1',segmentHash:group.contentHash,outputVideoSha256:outputSha,outputAudioSha256:'b'.repeat(64),sync:{version:1,detector:'official_syncnet',modelSha256:'d'.repeat(64),passed:true,confidence:8,avOffsetFrames:0,thresholds:{confidenceMin:7,absoluteOffsetFramesMax:1},failures:[]}};
  const lipHash=createHash('sha256').update(JSON.stringify(lipBody)).digest('hex');await writeFile(lip,JSON.stringify({...lipBody,reportHash:lipHash}));
  const execution=await executePresenterMotherSegments({grouping,provider:async request=>({providerId:'controlled',providerReceiptRef:'receipt',outputRef:output,outputSha256:outputSha,durationSeconds:request.durationSeconds,dynamicQa:{...qa(request.segmentHash,outputSha),audioTrackReceiptRef:audio,audioTrackReportHash:audioHash,lipSyncReceiptRef:lip,lipSyncScore:8,lipSyncThreshold:7}})});
  const crop=execution.slotCropReceipts[0]!,cropPath=path.join(root,'crop.mp4'),cropBytes=Buffer.from('actual crop bytes'),cropSha=createHash('sha256').update(cropBytes).digest('hex');await writeFile(cropPath,cropBytes);
  const assets=[{id:`presenter-mother-crop-${crop.receiptHash.slice(0,24)}`,sourceId:crop.slotId,localPath:cropPath,contentHash:cropSha,authorizationRef:`presenter-mother:${grouping.recordHash}`,segments:[{slotCropReceiptHash:crop.receiptHash}]}] as any;
  const verify=(value=execution,sha='a'.repeat(64))=>assertRestoredPresenterMotherExecution({grouping,execution:value,frozenAudioSha256BySegment:new Map([[group.segmentId,sha]]),assets});
  await verify();
  await assert.rejects(verify(null as any),/cached_qa_unverified/);
  await assert.rejects(verify(execution,'f'.repeat(64)),/cached_qa_unverified/);
  await writeFile(lip,JSON.stringify({...lipBody,reportHash:'f'.repeat(64)}));await assert.rejects(verify(),/cached_qa_unverified/);
  await writeFile(lip,JSON.stringify({...lipBody,reportHash:lipHash}));await writeFile(cropPath,'changed');await assert.rejects(verify(),/cached_qa_unverified/);
  await writeFile(cropPath,cropBytes);await rm(audio);await assert.rejects(verify(),/cached_qa_bytes_unavailable/);
 }finally{await rm(root,{recursive:true,force:true});}
});
