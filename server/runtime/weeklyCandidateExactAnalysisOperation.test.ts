import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import type {DataStore,Record_,ListQuery} from '../storage/datastore.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {advanceWeeklyCandidateExactAnalysis,readWeeklyCandidateExactAnalysisSettlement,verifiedWeeklyCandidateCanonicalMedia,WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS,WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS} from './weeklyCandidateExactAnalysisOperation.js';
import {probeReferenceMediaClock} from '../lib/referenceMediaClock.js';

function store(rows:Record<string,Record_[]>={}):DataStore&{rows:Record<string,Record_[]>}{
 return {rows,
  async getById<T>(name:string,id:string){return structuredClone(rows[name]?.find(r=>r.id===id)??null) as T|null;},
  async list<T>(name:string,query:ListQuery={}){const items=(rows[name]??[]).filter(r=>Object.entries(query.where??{}).every(([k,v])=>r[k]===v));return {items:structuredClone(items) as T[],totalItems:items.length,totalPages:1,page:1,perPage:query.perPage??30};},
  async create<T>(name:string,value:T){const row=structuredClone(value) as Record_;if(rows[name]?.some(r=>r.id===row.id))return null;(rows[name]??=[]).push(row);return row as T;},
  async update<T>(name:string,id:string,value:Partial<T>){const r=rows[name]?.find(r=>r.id===id);if(!r)return null;Object.assign(r,structuredClone(value));return r as T;},
  async delete(){throw Error('unused');},
 } as DataStore&{rows:Record<string,Record_[]>};
}
test('canonical bytes need independent exact authorization; unknown execution is never repeated after restart',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-exact-operation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const relative='tenants/tenant/reference-videos/candidate.mp4',file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});
 assert(ffmpeg);await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=size=160x180:rate=10','-t','2','-c:v','libx264','-pix_fmt','yuv420p',file]);
 const sha=createHash('sha256').update(await fs.readFile(file)).digest('hex');
 const record={id:'candidate',tenantId:'tenant',sourceUrl:'https://www.tiktok.com/@factory/video/123456',videoFileId:relative,aiAnalysis:JSON.stringify({analysisQuality:'metadata',contentSha256:sha})};
 const job={jobId:'job',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,authority:{scopeId:'scope',scopeVersion:1}} as WeeklyPreproductionJob;
 const run={runId:'run',discoveryScopeId:'scope',discoveryScopeVersion:1,status:'running',modeStats:{}} as SocialInspirationCollectionRun;
 const s=store({trend_videos:[record]});const input={store:s,job,run,record,mediaRoot:root};
 assert.equal((await verifiedWeeklyCandidateCanonicalMedia(record,root))?.sha256,sha);
 assert.equal((await advanceWeeklyCandidateExactAnalysis(input)).code,'weekly_postanalysis_exact_analysis_authorization_required');
 assert.equal(s.rows[WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS]?.length??0,0);
 let authorized=0,executed=0;
 const ports={authorize:async()=>{authorized++;return {authorizationId:'explicit-test-only',authorizationHash:socialRequestHash('separate paid authorization')};},execute:async()=>{executed++;throw Error('simulated transport timeout after possible POST');},readSettledReceipt:async()=>null};
 assert.equal((await advanceWeeklyCandidateExactAnalysis({...input,ports:{authorize:ports.authorize,execute:ports.execute}})).code,'weekly_postanalysis_exact_analysis_authorization_required');
 assert.equal(authorized,0);assert.equal(executed,0);assert.equal(s.rows[WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS]?.length??0,0);
 await assert.rejects(advanceWeeklyCandidateExactAnalysis({...input,ports}),/simulated transport timeout/);
 assert.equal(authorized,1);assert.equal(executed,1);assert.equal(s.rows[WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS]?.length,1);
 const legacy=store(structuredClone(s.rows));
 const legacyOp=legacy.rows[WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS]![0]!;
 const legacyPayload=legacyOp.payload as Record<string,unknown>;
 legacyPayload.runHash=socialRequestHash(run);
 legacyPayload.recordHash=socialRequestHash({...legacyPayload,recordHash:''});
 legacyOp.record_hash=legacyPayload.recordHash;
 await assert.rejects(advanceWeeklyCandidateExactAnalysis({...input,store:legacy,ports}),/operation_changed/,'old full-run hash is not silently migrated or resubmitted');
 assert.equal(authorized,1);assert.equal(executed,1);
 const reopened=store(structuredClone(s.rows));
 const evolvedRun={...run,status:'succeeded' as const,modeStats:{},evidenceOutcomes:{account:{acceptedCandidateIds:['candidate'],acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}},finishedAt:new Date().toISOString()};
 const result=await advanceWeeklyCandidateExactAnalysis({...input,run:evolvedRun,store:reopened,ports});
 assert.deepEqual({state:result.state,code:result.code},{state:'unknown',code:'weekly_postanalysis_exact_analysis_original_receipt_pending'});
 assert.equal(authorized,1);assert.equal(executed,1);
 await assert.rejects(advanceWeeklyCandidateExactAnalysis({...input,run:{...evolvedRun,discoveryScopeVersion:2},store:reopened,ports}),/scope_invalid/);
 const clock=await probeReferenceMediaClock(file);
 await reopened.update('trend_videos','candidate',{aiAnalysis:JSON.stringify({analysisRunId:'another-operation',analysisQuality:'video',analysisMode:'exact',contentSha256:sha,gemini:{sourceMediaClock:{...clock,sourceSha256:sha,analysisRunId:'another-operation'},scriptDetails15s:[{time:'0-2',visual:'controlled test frames'}]}})});
 const foreign=await advanceWeeklyCandidateExactAnalysis({...input,store:reopened,ports});
 assert.deepEqual({state:foreign.state,code:foreign.code},{state:'unknown',code:'weekly_postanalysis_exact_analysis_original_receipt_pending'});
 assert.equal(reopened.rows[WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS]?.length??0,0,'a separate analysis cannot settle the unknown paid operation');
 const foreignRecord=await reopened.getById<Record_>('trend_videos','candidate');
 assert(foreignRecord);
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:reopened,job,run,record:foreignRecord,mediaRoot:root}),false);
 await reopened.update('trend_videos','candidate',{aiAnalysis:JSON.stringify({analysisRunId:result.operationId,analysisQuality:'video',analysisMode:'exact',contentSha256:sha,gemini:{sourceMediaClock:{...clock,sourceSha256:sha,analysisRunId:result.operationId},scriptDetails15s:[{time:'0-2',visual:'controlled test frames'}]}})});
 const copiedId=await advanceWeeklyCandidateExactAnalysis({...input,store:reopened,ports});
 assert.deepEqual({state:copiedId.state,code:copiedId.code},{state:'unknown',code:'weekly_postanalysis_exact_analysis_original_receipt_pending'});
 assert.equal(reopened.rows[WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS]?.length??0,0,'a copied operation ID cannot replace independent provider and ledger settlement');
 const copiedRecord=await reopened.getById<Record_>('trend_videos','candidate');assert(copiedRecord);
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:reopened,job,run,record:copiedRecord,mediaRoot:root}),false);
 assert.equal(authorized,1);assert.equal(executed,1);
 const settlement={operationId:result.operationId!,authorizationHash:socialRequestHash('separate paid authorization'),mediaSha256:sha,providerRequestHash:socialRequestHash('original provider request'),providerReceiptRef:'original-provider-receipt',ledgerOutcomeHash:socialRequestHash('original paid ledger outcome'),status:'completed' as const};
 const trustedRead={readSettledReceipt:async()=>settlement};
 assert.equal((await advanceWeeklyCandidateExactAnalysis({...input,run:evolvedRun,store:reopened,ports:trustedRead})).state,'completed');
 assert.equal((await reopened.list(WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS)).totalItems,1);
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:reopened,job,run,record:copiedRecord,mediaRoot:root}),false,'durable receipt alone cannot replace live independent settlement');
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:reopened,job,run,record:copiedRecord,mediaRoot:root,ports:trustedRead}),true);
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:store(structuredClone(reopened.rows)),job,run,record:copiedRecord,mediaRoot:root,ports:trustedRead}),true,'settled read survives store restart');
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:store(structuredClone(reopened.rows)),job,run:evolvedRun,record:copiedRecord,mediaRoot:root,ports:trustedRead}),true,'normal run outcome updates preserve original settlement');
 await reopened.update('trend_videos','candidate',{title:'Updated discovery display title',playCount:42});
 const retitled=await reopened.getById<Record_>('trend_videos','candidate');assert(retitled);
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:store(structuredClone(reopened.rows)),job,run:evolvedRun,record:retitled,mediaRoot:root,ports:trustedRead}),true,'display metadata changes cannot strand settled original');
 const legacyReceiptStore=store(structuredClone(reopened.rows)),legacyReceipt=legacyReceiptStore.rows[WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS]![0]!;
 (legacyReceipt.payload as Record<string,unknown>).recordSnapshotHash=socialRequestHash(copiedRecord);
 legacyReceipt.record_hash=socialRequestHash(legacyReceipt.payload);
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:legacyReceiptStore,job,run:evolvedRun,record:retitled,mediaRoot:root,ports:trustedRead}),false,'a legacy whole-row receipt is not silently rewritten');
 const alteredAnalysis={...JSON.parse(String(retitled.aiAnalysis)),gemini:{...JSON.parse(String(retitled.aiAnalysis)).gemini,theme:'substituted model output'}};
 const tampered={...retitled,aiAnalysis:JSON.stringify(alteredAnalysis)};
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:reopened,job,run:evolvedRun,record:tampered,mediaRoot:root,ports:trustedRead}),false,'model output changes still revoke admission');
 await assert.rejects(readWeeklyCandidateExactAnalysisSettlement({store:reopened,job,run:{...evolvedRun,planId:'other'},record:copiedRecord,mediaRoot:root,ports:trustedRead}),/operation_changed/);
 assert.equal(await readWeeklyCandidateExactAnalysisSettlement({store:reopened,job,run,record:copiedRecord,mediaRoot:root,ports:{readSettledReceipt:async()=>({...settlement,ledgerOutcomeHash:socialRequestHash('different ledger')})}}),false,'original paid ledger drift revokes admission');
});
test('canonical SHA mismatch and symlink escape are not admitted',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-exact-media-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const outside=path.join(root,'outside.mp4');await fs.writeFile(outside,'not a video');
 const file=path.join(root,'tenants/tenant/reference-videos/candidate.mp4');await fs.mkdir(path.dirname(file),{recursive:true});await fs.symlink(outside,file);
 const record={id:'candidate',tenantId:'tenant',videoFileId:'tenants/tenant/reference-videos/candidate.mp4',aiAnalysis:JSON.stringify({contentSha256:createHash('sha256').update('not a video').digest('hex')})};
 assert.equal(await verifiedWeeklyCandidateCanonicalMedia(record,root),null);
});
