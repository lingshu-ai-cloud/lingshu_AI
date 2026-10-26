import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import ffmpeg from 'ffmpeg-static';
import {freezePresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import {presenterProductionRoute} from '../../shared/contracts/presenterProductionRoute.js';
import {inspectPresenterMotherSpeechQa} from './presenterMotherSpeechQa.js';
import {preparePresenterMotherSupply} from './presenterMotherSupplyBridge.js';
import {assertRestoredPresenterMotherExecution,executePresenterMotherSegments,verifyPresenterMotherExecutionResult} from './presenterMotherSegmentExecution.js';
import {parseCreateSocialTask,parseUpdateSocialTask} from './socialContentValidation.js';
import {defaultBrief} from './socialContentTaskSupport.js';
import {parseSocialTaskBrief} from './socialContentRecordProjection.js';
import {assertSocialPresenterRouteAvailable} from './socialContentPresenterRouteAdmission.js';
import {initialVoicePlanReadOptions} from './socialContentProductionBudgetPreflight.js';

const policy='heygen_native_human_review' as const,hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex'),run=promisify(execFile);
test('explicit native review policy persists through the original contract and only enables HeyGen',()=>{
 const parsed=parseCreateSocialTask({title:'native',objective:'native',mode:'instant',presenterSpeechReviewPolicy:policy});
 assert.equal(defaultBrief(parsed).presenterSpeechReviewPolicy,policy);
 assert.equal(parseSocialTaskBrief(JSON.stringify(defaultBrief(parsed))).presenterSpeechReviewPolicy,policy);
 assert.equal(parseUpdateSocialTask({expectedVersion:'1',changes:{presenterSpeechReviewPolicy:policy}}).changes.presenterSpeechReviewPolicy,policy);
 assert.throws(()=>parseUpdateSocialTask({expectedVersion:'1',changes:{presenterSpeechReviewPolicy:'skip_all'}}),/policy_invalid/);
 for(const provider of [undefined,'seedance'])assert.equal(presenterProductionRoute({sourceStrategy:'authorized_digital_presenter',provider,speechReviewPolicy:policy}).executable,false);
 assert.equal(presenterProductionRoute({sourceStrategy:'authorized_digital_presenter',provider:'heygen',speechReviewPolicy:policy}).executable,true);
 assert.equal(presenterProductionRoute({sourceStrategy:'authorized_digital_presenter',provider:'heygen'}).executable,false);
 const supply={shots:[{shotId:'speech',sourceStrategy:'authorized_digital_presenter',digitalHumanPlan:{method:'talking_head'}}]} as never;
 assert.doesNotThrow(()=>assertSocialPresenterRouteAvailable(supply,new Set(),{policy,heyGenShotIds:new Set(['speech'])}));
 assert.throws(()=>assertSocialPresenterRouteAvailable(supply,new Set(),{policy,heyGenShotIds:new Set()}),/route_unavailable/);
});

test('only an explicitly frozen new-task route selects native HeyGen during initial budget planning',()=>{
 assert.deepEqual(initialVoicePlanReadOptions('native_video'),{heygenSpeechMode:'native_video'});
 assert.equal(initialVoicePlanReadOptions(undefined),undefined);
});

test('native mother audio remains hash/measured; lip evidence remains pending through crops and restart',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'native-heygen-review-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const wav=path.join(root,'speech.wav'),video=path.join(root,'native.mp4');
 await run(String(ffmpeg),['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1.2:sample_rate=24000','-ac','1','-y',wav]);
 await run(String(ffmpeg),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=black:s=160x160:r=25:d=1.2','-i',wav,'-shortest','-c:v','libx264','-c:a','aac','-y',video]);
 const audioSha=hash(await readFile(wav)),videoSha=hash(await readFile(video));
 const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots:[{slotId:'s1',referenceShotId:'r1',startSeconds:0,endSeconds:1.2,spokenText:'Hello',materialType:'talking_head',frontFacing:true,lipSyncRequired:true}]});
 const provider=async(request:{segmentHash:string})=>{
  const qa=await inspectPresenterMotherSpeechQa({reviewPolicy:policy,segmentHash:request.segmentHash,outputPath:video,outputSha256:videoSha,frozenAudioPath:wav,frozenAudioSha256:audioSha,workDir:path.join(root,'qa'),inspectLipSync:async()=>{throw Error('native policy must not invoke SyncNet');}});
  assert.equal(qa.lipSyncStatus,'pending_human_review');assert.equal(qa.lipSyncScore,null);
  return{providerId:'heygen',providerReceiptRef:'controlled-provider-receipt',outputRef:video,outputSha256:videoSha,durationSeconds:1.2,dynamicQa:{identitySimilarity:.99,identityThreshold:.9,receiptRef:'visual-fixture',reportHash:'c'.repeat(64),...qa}};
 };
 const supply=await preparePresenterMotherSupply({speechReviewPolicy:policy,grouping,outputDirectory:path.join(root,'crops'),provider});
 const execution=supply.presenterMotherExecution,qa=execution.providerReceipts[0]!.dynamicQa;
 assert.equal(qa.passed,false);assert.equal(qa.technicalPassed,true);assert.equal(qa.requiresHumanReview,true);
 assert.equal(verifyPresenterMotherExecutionResult(execution),true);
 const restored={speechReviewPolicy:policy,grouping,execution,frozenAudioSha256BySegment:new Map([[grouping.groups[0]!.segmentId,audioSha]]),assets:supply.assets};
 await assertRestoredPresenterMotherExecution(restored);
 await assert.rejects(assertRestoredPresenterMotherExecution({...restored,speechReviewPolicy:undefined}),/cached_qa_unverified/);
 await assert.rejects(executePresenterMotherSegments({speechReviewPolicy:policy,grouping,provider:async r=>({...await provider(r),providerId:'seedance'})}),/dynamic_qa_failed/);
 const lip=qa.lipSyncReceiptRef!;const original=await readFile(lip,'utf8');await writeFile(lip,original.replace('pending_human_review','passed'));
 await assert.rejects(assertRestoredPresenterMotherExecution(restored),/cached_qa_unverified/);
});
