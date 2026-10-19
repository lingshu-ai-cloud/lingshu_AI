import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import ffmpeg from 'ffmpeg-static';
import {prepareWeeklyEnterpriseFactFixture} from './weeklyEnterpriseFactSupplement.fixture.js';
import {reassessWeeklyCandidates,readWeeklyCandidateReassessment,CANDIDATE_ANALYSIS_OPERATIONS,CANDIDATE_ANALYSIS_RECEIPTS} from './weeklyCandidateReassessment.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';import type {Record_} from '../storage/datastore.js';
import {probeReferenceMediaClock} from '../lib/referenceMediaClock.js';import {socialRequestHash} from '../starter198/socialContentValidation.js';
const job={jobId:'child',tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,consumerTaskId:'consumer',consumerInputHash:'frozen',authority:{scopeId:'scope',scopeVersion:1,requestedModes:['momentum']},retry:{sourceSelection:[{mode:'momentum',platform:'tiktok',queryRef:'OEM supplier'}]}} as WeeklyPreproductionRetryAttempt;
const run={runId:'original-run',status:'failed',evidenceOutcomes:{momentum:{suggestionCandidateIds:['candidate'],acceptedCandidateIds:[],acceptedEvidenceRefs:[],failedCandidateIds:[]}}} as unknown as SocialInspirationCollectionRun;
const origins=[{runId:run.runId,scopeId:'scope',scopeVersion:1,mode:'momentum',queryRef:'OEM supplier',observedAt:'2026-10-16T00:00:00Z'}];
test('definite model rejection opens exact-attempt circuit without submitting another candidate or altering original operation',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),two={...run,evidenceOutcomes:{momentum:{...run.evidenceOutcomes!.momentum!,suggestionCandidateIds:['candidate','candidate-2']}}};
 for(const id of ['candidate','candidate-2'])await store.create('trend_videos',{id,tenantId:'tenant-a',platform:'tiktok',sourceUrl:`https://www.tiktok.com/@factory/video/${id}`,aiAnalysis:JSON.stringify({downloadStatus:'queued',geminiStatus:'waiting_for_video',discoveryOrigins:origins})});
 let calls=0;const ports={async analyze(){calls++;throw Error('exact_analysis_retryable: 404 Model not exist.');}};
 assert.equal((await reassessWeeklyCandidates(store,job,two,ports)).code,'model_unavailable');
 // Even absent a mutable read-model error, the immutable rejection receipt
 // alone must prevent a subsequent candidate submission.
 const before=await store.list(CANDIDATE_ANALYSIS_OPERATIONS);
 assert.equal((await reassessWeeklyCandidates(store,job,two,ports)).code,'model_unavailable');assert.equal(calls,1);assert.deepEqual(await store.list(CANDIDATE_ANALYSIS_OPERATIONS),before);
});
test('existing exact-attempt media is byte/clock verified and appended reassessment never rewrites run or recollects',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),mediaRoot=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-candidate-'));t.after(()=>fs.rm(mediaRoot,{recursive:true,force:true}));
 const relative='tenants/tenant-a/reference-videos/candidate.mp4',file=path.join(mediaRoot,relative);await fs.mkdir(path.dirname(file),{recursive:true});assert(ffmpeg);
 await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x180:rate=10','-t','2','-c:v','libx264','-pix_fmt','yuv420p',file]);
 const sha=createHash('sha256').update(await fs.readFile(file)).digest('hex'),clock=await probeReferenceMediaClock(file),analysis={analysisQuality:'video',analysisMode:'exact',analysisRunId:'actual-analysis',contentSha256:sha,taskRelevance:1,transferability:1,views:1000000,accountPlatformBaseline:100,followers:1000,uploadedAt:'2026-10-15T00:00:00Z',mechanisms:['supplier demonstration'],discoveryOrigins:origins,gemini:{summary:'OEM supplier factory wholesale product manufacturing',sourceMediaClock:{...clock,sourceSha256:sha,analysisRunId:'actual-analysis'},scriptDetails15s:[{time:'0-1',visual:'first real frames'},{time:'1-2',visual:'next real frames'}]}};
 await store.create('trend_videos',{id:'candidate',tenantId:'tenant-a',platform:'tiktok',title:'OEM factory wholesale supplier',sourceUrl:'https://www.tiktok.com/@factory/video/1',videoFileId:relative,crawledAt:'2026-10-16T00:00:00Z',aiAnalysis:JSON.stringify(analysis)});
 let downloads=0;const before=structuredClone(run),result=await reassessWeeklyCandidates(store,job,run,{mediaRoot,analyze:async()=>{downloads++;throw Error('must reuse existing media');}});
 assert.equal(result.ready,true,JSON.stringify(result));assert(result.item);assert.equal(downloads,0);assert.equal(result.item.newCollectionRequests,0);assert.deepEqual(run,before);
 const read=await readWeeklyCandidateReassessment(store,job,run,{type:'social_discovery_candidate_reassessment',id:result.item.id,version:1},mediaRoot);assert.equal(read.parentRunHash,socialRequestHash(run));
 await fs.appendFile(file,'changed');await assert.rejects(readWeeklyCandidateReassessment(store,job,run,{type:'social_discovery_candidate_reassessment',id:result.item.id,version:1},mediaRoot),/source_changed/);
});
test('metadata cannot be accepted; known failure is retained and next candidate progresses without repeating first model request',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),two={...run,evidenceOutcomes:{momentum:{...run.evidenceOutcomes!.momentum!,suggestionCandidateIds:['candidate','candidate-2']}}};
 for(const id of ['candidate','candidate-2'])await store.create('trend_videos',{id,tenantId:'tenant-a',platform:'tiktok',title:'OEM',sourceUrl:`https://www.tiktok.com/@factory/video/${id}`,aiAnalysis:JSON.stringify({analysisQuality:'metadata',downloadStatus:'queued',geminiStatus:'waiting_for_video',discoveryOrigins:origins})});
 const calls:string[]=[];const ports={async analyze(r:Record_){calls.push(r.id);throw Error('video_downloader_not_installed');}};
 assert.equal((await reassessWeeklyCandidates(store,job,two,ports)).ready,false);assert.deepEqual(calls,['candidate']);
 const next=await reassessWeeklyCandidates(store,job,two,ports);assert.equal(next.ready,false);assert.equal(next.code,'downloader_missing');assert.deepEqual(calls,['candidate','candidate-2']);
 await reassessWeeklyCandidates(store,job,two,ports);assert.deepEqual(calls,['candidate','candidate-2']);assert.equal((await store.list(CANDIDATE_ANALYSIS_OPERATIONS)).totalItems,2);assert.equal((await store.list(CANDIDATE_ANALYSIS_RECEIPTS)).totalItems,2);
 await assert.rejects(reassessWeeklyCandidates(store,{...job,tenantId:'foreign'},two,ports),/source_scope_changed/);
});
