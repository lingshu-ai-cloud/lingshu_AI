import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,Record_,ListQuery} from '../storage/datastore.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {advanceWeeklyCandidatePostAnalysis,WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS} from './weeklyCandidatePostAnalysis.js';
import {CANDIDATE_SEMANTIC_OPERATIONS,CANDIDATE_SEMANTIC_ASSESSMENTS,CANDIDATE_SEMANTIC_PROVIDER_RECEIPTS} from '../socialDiscovery/candidateSemanticAssessment.js';
import {prepareWeeklyEnterpriseFactFixture,reopenWeeklyEnterpriseFactFixtureStore} from './weeklyEnterpriseFactSupplement.fixture.js';
import {readWeeklyPublicationProductSelectionChoices,issueWeeklyPublicationProductSelections} from '../socialPrograms/weeklyPublicationProductSelection.js';
import {CANDIDATE_CONTEXT_ASSESSMENTS} from '../socialDiscovery/candidateContextAssessment.js';
import {probeReferenceMediaClock} from '../lib/referenceMediaClock.js';
import {advanceWeeklyCandidatePostAnalysisChain,readWeeklyQualifiedDirectorAdmission} from './weeklyPreproductionProducer.js';
import {WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS} from './weeklyCandidateExactAnalysisOperation.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';

function store(initial:Record<string,Record_[]>):DataStore&{rows:Record<string,Record_[]>}{
 const rows=structuredClone(initial);
 return {rows,
  async getById<T>(collection:string,id:string){return structuredClone(rows[collection]?.find(row=>row.id===id)??null) as T|null;},
  async list<T>(collection:string,query:ListQuery={}){const found=(rows[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));const page=query.page??1,perPage=query.perPage??30;return {items:structuredClone(found.slice((page-1)*perPage,page*perPage)) as T[],totalItems:found.length,totalPages:Math.max(1,Math.ceil(found.length/perPage)),page,perPage};},
  async create<T>(collection:string,value:T){const row=structuredClone(value) as Record_;if(rows[collection]?.some(item=>item.id===row.id))return null;(rows[collection]??=[]).push(row);return row as T;},
  async update<T>(collection:string,id:string,value:Partial<T>){const row=rows[collection]?.find(item=>item.id===id);if(!row)return null;Object.assign(row,structuredClone(value));return row as T;},
  async delete(){throw Error('not used');},
 } as DataStore&{rows:Record<string,Record_[]>};
}
const key='weekly-root',runId=`weekly_discovery_${socialRequestHash({tenantId:'tenant',key})}`;
const origin={runId,scopeId:'scope',scopeVersion:1,mode:'account',queryRef:'https://www.tiktok.com/@factory',observedAt:'2026-10-19T00:00:00Z'};
const run={id:'run-row',tenant_id:'tenant',runId,status:'succeeded',discoveryScopeId:'scope',discoveryScopeVersion:1,scopeSnapshot:{weeklyProducer:{key},modePolicies:{account:{platforms:['tiktok']}}},queryBasis:{account:[origin.queryRef]},evidenceOutcomes:{account:{acceptedCandidateIds:['candidate'],acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}} as unknown as SocialInspirationCollectionRun;
const job={jobId:'job',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,consumerTaskId:'task',originalRunKey:key,actorUserId:'owner',authority:{scopeId:'scope',scopeVersion:1}} as WeeklyPreproductionJob;
const pkg={packageId:'package',programId:'program',version:1} as WeeklyOperatingPackage;
const video={id:'candidate',tenantId:'tenant',platform:'tiktok',sourceUrl:'https://www.tiktok.com/@factory/video/123456',aiAnalysis:JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[origin]})};

test('same-run metadata progress is durable and idempotent; no semantic paid operation or provider request',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('provider forbidden');});
 const firstStore=store({social_discovery_runs:[run as unknown as Record_],trend_videos:[video]});
 const input={store:firstStore,job,run,pkg,mediaRoot:'/no-such-media-root',acceptedCandidateIds:['candidate']};
 const first=await advanceWeeklyCandidatePostAnalysis(input);
 assert.equal(first[0]?.state,'blocked');assert.equal(first[0]?.code,'weekly_postanalysis_canonical_media_intervention_required');
 assert.deepEqual(await advanceWeeklyCandidatePostAnalysis(input),first);
 assert.equal(firstStore.rows[WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS]?.length,1);
 const reopened=store(firstStore.rows);
 assert.deepEqual(await advanceWeeklyCandidatePostAnalysis({...input,store:reopened}),first);
 assert.equal(reopened.rows[WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS]?.length,1);
 assert.equal(reopened.rows[CANDIDATE_SEMANTIC_OPERATIONS]?.length??0,0);
 assert.equal(requests,0);
});

test('five newly accepted account metadata candidates do not silently become canonical media or director references',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('provider forbidden');});
 const ids=['candidate-a','candidate-b','candidate-c','candidate-d','candidate-e'];
 const fiveRun={...run,evidenceOutcomes:{account:{acceptedCandidateIds:ids,acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}} as unknown as SocialInspirationCollectionRun;
 const videos=ids.map((id,index)=>({...video,id,sourceUrl:`https://www.tiktok.com/@factory/video/${123456+index}`}));
 const firstStore=store({social_discovery_runs:[fiveRun as unknown as Record_],trend_videos:videos});
 const input={store:firstStore,job,run:fiveRun,pkg,mediaRoot:'/no-such-media-root',acceptedCandidateIds:ids};
 const first=await advanceWeeklyCandidatePostAnalysis(input);
 assert.equal(first.length,5);
 assert.deepEqual(first.map(item=>item.code),ids.map(()=> 'weekly_postanalysis_canonical_media_intervention_required'));
 assert.deepEqual(first.map(item=>item.state),ids.map(()=> 'blocked'));
 const reopened=store(firstStore.rows);
 assert.deepEqual(await advanceWeeklyCandidatePostAnalysis({...input,store:reopened}),first);
 assert.equal(reopened.rows[WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS]?.length,5);
 assert.equal(reopened.rows['social_weekly_candidate_analysis_operations']?.length??0,0);
 assert.equal(reopened.rows[CANDIDATE_SEMANTIC_OPERATIONS]?.length??0,0);
 assert.equal(requests,0);
});

test('five canonical same-run bytes survive disk restart and reach the exact authority gate without provider calls',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-five-canonical-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'store.json'),mediaRoot=path.join(directory,'media');
 const fixture=await prepareWeeklyEnterpriseFactFixture(t,{persistentFile:file});
 const tenantId='tenant-a',sourceKey='five-canonical-run',sourceRunId=`weekly_discovery_${socialRequestHash({tenantId,key:sourceKey})}`;
 const account='https://www.tiktok.com/@factory',ids=Array.from({length:5},(_,i)=>`canonical-${i+1}`);
 const sourceRun={runId:sourceRunId,status:'succeeded',discoveryScopeId:'scope',discoveryScopeVersion:1,
  scopeSnapshot:{weeklyProducer:{key:sourceKey},modePolicies:{account:{platforms:['tiktok']}}},queryBasis:{account:[account]},
  evidenceOutcomes:{account:{acceptedCandidateIds:ids,acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}} as unknown as SocialInspirationCollectionRun;
 await fixture.store.create('social_discovery_runs',{...sourceRun,id:'stored-run',tenant_id:tenantId});
 const originalJob={...job,tenantId,programId:'program-a',packageId:'package-a',jobId:'five-job',originalRunKey:sourceKey};
 assert(ffmpeg);
 for(const [index,id] of ids.entries()){
  const relative=`tenants/${tenantId}/reference-videos/${id}.mp4`,absolute=path.join(mediaRoot,relative);
  await fs.mkdir(path.dirname(absolute),{recursive:true});
  await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=${['red','blue','green','yellow','purple'][index]}:size=160x180:rate=10`,'-t','1','-c:v','libx264','-pix_fmt','yuv420p',absolute]);
  const mediaSha=createHash('sha256').update(await fs.readFile(absolute)).digest('hex');
  await fixture.store.create('trend_videos',{id,tenantId,platform:'tiktok',sourceUrl:`https://www.tiktok.com/@factory/video/${123456+index}`,videoFileId:relative,
   aiAnalysis:JSON.stringify({analysisQuality:'metadata',contentSha256:mediaSha,discoveryOrigins:[{runId:sourceRunId,scopeId:'scope',scopeVersion:1,mode:'account',queryRef:account,observedAt:'2026-10-19T00:00:00Z'}]})});
 }
 let requests=0,resolutions=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('provider forbidden');});
 const resolve=async(_job:WeeklyPreproductionJob,resolvedRun:SocialInspirationCollectionRun)=>{resolutions++;assert.equal(resolvedRun.runId,sourceRunId);return null;};
 const options={rootJob:originalJob,job:originalJob,run:sourceRun,pkg:fixture.pkg,mediaRoot,acceptedCandidateIds:ids,exactAnalysisPortsForRun:resolve};
 await advanceWeeklyCandidatePostAnalysisChain({store:fixture.store,...options});
 const reopened=reopenWeeklyEnterpriseFactFixtureStore(file);
 await advanceWeeklyCandidatePostAnalysisChain({store:reopened,...options});
 const progress=await reopened.list<Record_>(WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS,{where:{tenant_id:tenantId},perPage:10});
 assert.equal(progress.totalItems,5);
 assert.deepEqual(progress.items.map(row=>(row.payload as {code:string}).code).sort(),ids.map(()=> 'weekly_postanalysis_exact_analysis_authorization_required'));
 assert.equal((await reopened.list(WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS)).totalItems,0);
 const admission=await readWeeklyQualifiedDirectorAdmission({store:reopened,rootJob:originalJob,job:originalJob,run:sourceRun,mediaRoot,exactAnalysisPortsForRun:resolve});
 assert.deepEqual(admission.candidateIds,[],'canonical bytes alone cannot become Director references');
 assert.equal(resolutions,3);assert.equal(requests,0);
});

test('a canonical locator without verifiable bytes is an evidence intervention, not analysis success',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('provider forbidden');});
 const candidate={...video,videoFileId:'tenants/tenant/reference-videos/candidate.mp4',aiAnalysis:JSON.stringify({analysisQuality:'metadata',contentSha256:'a'.repeat(64),discoveryOrigins:[origin]})};
 const s=store({social_discovery_runs:[run as unknown as Record_],trend_videos:[candidate]});
 const [progress]=await advanceWeeklyCandidatePostAnalysis({store:s,job,run,pkg,mediaRoot:'/no-such-media-root',acceptedCandidateIds:['candidate']});
 assert.equal(progress?.state,'blocked');assert.equal(progress?.code,'weekly_postanalysis_canonical_evidence_intervention_required');
 assert.equal(s.rows[CANDIDATE_SEMANTIC_OPERATIONS]?.length??0,0);assert.equal(requests,0);
});

test('foreign candidate cannot create a post-analysis receipt',async()=>{
 const wrong={...video,aiAnalysis:JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[{...origin,runId:'other-run'}]})};
 const s=store({social_discovery_runs:[run as unknown as Record_],trend_videos:[wrong]});
 await assert.rejects(advanceWeeklyCandidatePostAnalysis({store:s,job,run,pkg,mediaRoot:'/no-such-media-root',acceptedCandidateIds:['candidate']}),/origin_invalid/);
 assert.equal(s.rows[WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS]?.length??0,0);
});

test('real canonical bytes and authenticated product selection create one local context; restart keeps semantic budget gap without POST',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-postanalysis-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'store.json'),mediaRoot=path.join(directory,'media');
 const f=await prepareWeeklyEnterpriseFactFixture(t,{persistentFile:file});
 const pkgRow=(await f.store.list<Record_>('social_weekly_operating_packages')).items[0]!;
 const publication={...f.pkg.socialContentPackage.publicationTasks[0]!,motherContentId:'mother',status:'planned' as const};
 const currentPkg={...f.pkg,socialContentPackage:{...f.pkg.socialContentPackage,publicationTasks:[publication]}};
 await f.store.update('social_weekly_operating_packages',pkgRow.id,{payload:currentPkg});
 const scope={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1};
 const profile=(await f.store.list<Record_>('tenant_profiles')).items[0]!.profile as {products:{items:Array<{id:string;name:string}>}};
 const choice=await readWeeklyPublicationProductSelectionChoices(f.store,scope);
 await issueWeeklyPublicationProductSelections(f.store,scope,'owner',{expectedContextHash:choice.contextHash,productId:profile.products.items[0]!.id,publicationTaskIds:[publication.publicationTaskId]});
 const mp4=path.join(mediaRoot,'tenants/tenant-a/reference-videos/candidate.mp4');await fs.mkdir(path.dirname(mp4),{recursive:true});
 assert(ffmpeg);await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=size=160x180:rate=10','-t','2','-c:v','libx264','-pix_fmt','yuv420p',mp4]);
 const sha=createHash('sha256').update(await fs.readFile(mp4)).digest('hex'),clock=await probeReferenceMediaClock(mp4);
 const actualRunId=`weekly_discovery_${socialRequestHash({tenantId:'tenant-a',key})}`;
 const actualOrigin={runId:actualRunId,scopeId:'scope',scopeVersion:1,mode:'account',queryRef:'https://www.tiktok.com/@factory',observedAt:'2026-10-19T00:00:00Z'};
 const analysis={analysisRunId:'canonical',analysisQuality:'video',analysisMode:'exact',contentSha256:sha,discoveryOrigins:[actualOrigin],gemini:{theme:'真实产品展示',sourceMediaClock:{...clock,analysisRunId:'canonical',sourceSha256:sha},scriptDetails15s:[{time:'0-1',materialType:'product',visual:'真实产品瓶',observedFacts:'画面可见护肤品瓶身'}]}};
 const candidate={id:'candidate',tenantId:'tenant-a',platform:'tiktok',sourceUrl:'https://www.tiktok.com/@factory/video/123456',videoFileId:'tenants/tenant-a/reference-videos/candidate.mp4',aiAnalysis:JSON.stringify(analysis)};
 await f.store.create('trend_videos',candidate);
 const canonical={candidateId:'candidate',operationId:'canonical',status:'completed',recordSnapshotHash:socialRequestHash(candidate),mediaSha256:sha};
 await f.store.create('social_weekly_candidate_revised_analysis_receipts',{id:'canonical',tenant_id:'tenant-a',record_hash:socialRequestHash(canonical),payload:canonical});
 await f.store.create('social_discovery_scopes',{id:'scope',tenant_id:'tenant-a',version:1,payload:{keywordRecommendation:{},keywordSet:{scope:{audienceRole:'brand_buyer'}}}});
 const actualRun={id:'run',tenant_id:'tenant-a',runId:actualRunId,status:'succeeded',discoveryScopeId:'scope',discoveryScopeVersion:1,scopeSnapshot:{weeklyProducer:{key},modePolicies:{account:{platforms:['tiktok']}}},queryBasis:{account:[actualOrigin.queryRef]},evidenceOutcomes:{account:{acceptedCandidateIds:['candidate'],acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}} as unknown as SocialInspirationCollectionRun;
 await f.store.create('social_discovery_runs',actualRun as unknown as Record_);
 const actualJob={...job,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',jobId:'job-a',originalRunKey:key,actorUserId:'owner'};
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('no provider request');});
 const input={job:actualJob,run:actualRun,pkg:currentPkg,mediaRoot,acceptedCandidateIds:['candidate']};
 const first=await advanceWeeklyCandidatePostAnalysis({store:f.store,...input});
 assert.equal(first[0]?.state,'blocked');assert.equal(first[0]?.code,'candidate_context_semantic_budget_authorization_required');assert.ok(first[0]?.contextAssessmentId);
 const reopened=reopenWeeklyEnterpriseFactFixtureStore(file);
 const second=await advanceWeeklyCandidatePostAnalysis({store:reopened,...input});assert.deepEqual(second,first);
 assert.equal((await reopened.list(CANDIDATE_CONTEXT_ASSESSMENTS)).totalItems,1);
 assert.equal((await reopened.list(WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS)).totalItems,1);
 assert.equal((await reopened.list(CANDIDATE_SEMANTIC_OPERATIONS)).totalItems,0);
 assert.equal(requests,0);
  const context=(await reopened.list<Record_>(CANDIDATE_CONTEXT_ASSESSMENTS)).items[0]!.payload as {assessmentId:string;recordHash:string;productFacts:Array<{ref:{type:string;id:string;version:number}}>};
  const operationId=`candidate-semantic:${context.assessmentId}`,operation={operationId,contextHash:context.recordHash};
  await reopened.create(CANDIDATE_SEMANTIC_OPERATIONS,{id:operationId,tenant_id:'tenant-a',record_hash:socialRequestHash(operation),payload:operation});
  await reopened.create(CANDIDATE_SEMANTIC_PROVIDER_RECEIPTS,{id:operationId,tenant_id:'tenant-a',record_hash:socialRequestHash(operation),payload:operation});
  const fact=context.productFacts[0]!.ref;
  const semantic={schema:'candidate-semantic-assessment.v1',assessmentId:'semantic',contextAssessmentId:context.assessmentId,contextHash:context.recordHash,tenantId:'tenant-a',candidateId:'candidate',operationId,providerReceiptRef:operationId,dimensions:{relevance:{value:.9,state:'assessed',evidence:[{factRef:`${fact.type}:${fact.id}@${fact.version}`,shotIndex:1,quote:'画面可见护肤品瓶身',reason:'真实瓶身展示'}],reasons:[]},transferability:{value:null,state:'unknown',evidence:[],reasons:['resource mapping required']}},decision:'review',gaps:['resource mapping required'],costCny:null,costState:'retained_unknown',recordHash:''};
  semantic.recordHash=socialRequestHash({...semantic,recordHash:''});
  await reopened.create(CANDIDATE_SEMANTIC_ASSESSMENTS,{id:'semantic',tenant_id:'tenant-a',candidate_id:'candidate',context_id:context.assessmentId,record_hash:semantic.recordHash,payload:semantic});
  const existingSemantic=await advanceWeeklyCandidatePostAnalysis({store:reopened,...input});
  assert.equal(existingSemantic[0]?.state,'semantic_assessed');
  assert.equal(existingSemantic[0]?.code,'candidate_reference_scope_revoked','reference-only handoff remains gated on an actual approved scope');
  assert.equal((await reopened.list(CANDIDATE_SEMANTIC_OPERATIONS)).totalItems,1);
  assert.equal(requests,0);
});
