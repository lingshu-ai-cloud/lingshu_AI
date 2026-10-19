import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {DataStore,Record_,ListQuery} from '../storage/datastore.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {ensureWeeklyQualifiedContinuationStage,WEEKLY_QUALIFIED_CONTINUATION_STAGES} from './weeklyQualifiedContinuationStage.js';
import {ensureWeeklyQualifiedContinuationAttempt} from './weeklyQualifiedContinuationStage.js';
import {withExecutionPackageGate} from '../socialPrograms/weeklyExecutionGate.js';
import {independentAdmissionId,WEEKLY_INDEPENDENT_ADMISSIONS} from '../socialPrograms/weeklyIndependentAdmission.js';
import {AUTOMATIC_WEEKLY_SCHEDULES} from '../socialPrograms/weeklyAutomaticSchedule.js';
import {SCHEDULE_PROPOSALS,scheduleHash} from '../socialPrograms/weeklyScheduleSnapshots.js';
import {WEEKLY_AUTOMATION_TEMPLATE} from '../../shared/weeklyAutomationTemplate.js';
import {executeApprovedDiscoveryRun} from '../socialDiscovery/service.js';

const tenantId='tenant',key='weekly:root',runId=`weekly_discovery_${socialRequestHash({tenantId,key})}`;
function fixture(){
 const scopePayload={approval:{status:'approved',scopeVersion:1},market:'US',language:'en',keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}},keywords:[],discoveryBrief:{discoveryBriefId:'brief',keywordSetId:'keywords',keywordSetVersion:1,productRef:'product',market:'US',audience:'buyer',discoverySeedIds:[],trackedSceneIds:[],competitorAccounts:[],discoveryModes:['momentum'],platforms:['tiktok'],lookbackDays:7,resultLimit:5,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{momentum:{enabled:true,sourceRefs:['source-a','source-b'],platforms:['tiktok'],resultLimit:5,refreshIntervalMinutes:60,budgetLimitCny:null}}}};
 const jobBase={jobId:'root-job',tenantId,programId:'program',packageId:'package',packageVersion:1,consumerTaskId:'task',consumerInputHash:'input',kind:'discovery',status:'blocked',originalRunKey:key,actorUserId:'owner',dueAt:'2026-10-18T00:00:00Z',boundAt:'2026-10-18T00:00:00Z',updatedAt:'2026-10-18T00:00:00Z',sourceHash:socialRequestHash(scopePayload),authority:{scopeId:'scope',scopeVersion:1,scopeHash:socialRequestHash(scopePayload),requestedModes:['momentum']},code:'weekly_qualified_admission_unverified',resultRefs:[],recordHash:''} as WeeklyPreproductionJob;
 const job={...jobBase,recordHash:socialRequestHash(jobBase)};
 const run={id:'run-row',tenant_id:tenantId,runId,status:'partial',startedAt:'2026-10-18T00:00:00Z',finishedAt:'2026-10-18T00:01:00Z',discoveryScopeId:'scope',discoveryScopeVersion:1,scopeSnapshot:{weeklyProducer:{key},modePolicies:{momentum:{platforms:['tiktok']}}},queryBasis:{momentum:['source-a','source-b']},modeStats:{},evidenceOutcomes:{}} as unknown as SocialInspirationCollectionRun;
 const task={tenantId,programId:'program',packageId:'package',packageVersion:1,taskId:'task',workflowKind:'readiness',scope:'package',subjectId:'subject',accountId:null,publicationTaskId:null,inputSnapshot:{},upstreamVersionRefs:[],budget:{},schedule:{stepKind:'benchmark_collection',responsibleActor:'director_agent',estimatedStartAt:'2026-10-18T00:00:00Z'}};
 const rows:Record<string,Record_[]>={users:[{id:'owner',tenantId,role:'admin',active:true}],social_weekly_preproduction_jobs:[{id:job.jobId,tenant_id:tenantId,program_id:'program',package_id:'package',package_version:1,task_id:'task',record_hash:job.recordHash,payload:structuredClone(job)}],social_discovery_scopes:[{id:'scope',tenant_id:tenantId,status:'active',version:1,payload:scopePayload}],social_weekly_operating_packages:[{id:'pkg-row',tenant_id:tenantId,program_id:'program',package_id:'package',version:1,payload:{packageId:'package',version:1,status:'draft',socialContentPackage:{originalContentTarget:5,authorization:{allowRealPublishing:false}}}}],social_weekly_execution_tasks:[{id:'task-row',tenant_id:tenantId,program_id:'program',task_id:'task',payload:task}],social_discovery_runs:[run as unknown as Record_],social_discovery_daily_reservations:[{id:'reservation',tenant_id:tenantId,day:'2026-10-18',run_id:runId,request_key:'momentum:tiktok:source-a',count:1}]};
 let autoId=0;
 const store:DataStore={async getById<T>(collection:string,id:string){return structuredClone(rows[collection]?.find(row=>row.id===id)??null) as T|null;},async list<T>(collection:string,query:ListQuery={}){const found=(rows[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([k,v])=>row[k]===v));const page=query.page??1,perPage=query.perPage??30;return{items:structuredClone(found.slice((page-1)*perPage,page*perPage)) as T[],totalItems:found.length,totalPages:Math.max(1,Math.ceil(found.length/perPage)),page,perPage};},async create(collection:string,row:any){const saved={...row,id:row.id??`generated-${++autoId}`};if(rows[collection]?.some(item=>item.id===saved.id))return null;rows[collection]??=[];rows[collection]!.push(structuredClone(saved));return saved;},async update(collection:string,id:string,patch:any){const row=rows[collection]?.find(item=>item.id===id);if(!row)return false;Object.assign(row,structuredClone(patch));return true;},async delete(collection:string,id:string){const index=rows[collection]?.findIndex(row=>row.id===id)??-1;if(index<0)return false;rows[collection]!.splice(index,1);return true;}};
 const input={store,job,runs:[run],mediaRoot:'/no-such-media-root',now:new Date('2026-10-18T00:06:00Z')};
 return {rows,input};
}

test('stage is immutable across scans, excludes reserved source and never reserves or submits',async()=>{
 const {rows,input}=fixture();
 const tooSoon=await ensureWeeklyQualifiedContinuationStage({...input,now:new Date('2026-10-18T00:05:59.999Z')});
 assert.equal(tooSoon.code,'weekly_qualified_interval_pending');
 assert.equal(rows[WEEKLY_QUALIFIED_CONTINUATION_STAGES]?.length??0,0);
 const beforeReservations=structuredClone(rows.social_discovery_daily_reservations),beforeRun=structuredClone(rows.social_discovery_runs);
 const first=await ensureWeeklyQualifiedContinuationStage(input);
 assert.equal(first.ready,true);if(!first.ready)return;
 assert.equal(first.stage.source.queryRef,'source-b');assert.equal(first.stage.authorizesExecution,false);
 assert.equal(first.stage.grantsAdditionalDailyQuota,false);
 const restarted=await ensureWeeklyQualifiedContinuationStage(input);
 assert.deepEqual(restarted,first);
 assert.equal(rows[WEEKLY_QUALIFIED_CONTINUATION_STAGES]?.length,1);
 assert.deepEqual(rows.social_discovery_daily_reservations,beforeReservations);
 assert.deepEqual(rows.social_discovery_runs,beforeRun);
});

test('frozen five-video TikTok account may use a new same-day attempt on the same source, never a keyword substitute',async()=>{
 const {rows,input}=fixture(),accountUrl='https://www.tiktok.com/@factory';
 const scope=rows.social_discovery_scopes![0]!.payload as any;
 scope.discoveryBrief.competitorAccounts=[accountUrl];
 scope.discoveryBrief.weeklyAccountCollectionTarget={accountUrl,targetCount:5};
 scope.discoveryBrief.modePolicies.account={enabled:true,sourceRefs:[accountUrl],platforms:['tiktok'],resultLimit:5};
 input.job.authority!.requestedModes=['account','momentum'];
 input.job.authority!.scopeHash=socialRequestHash(scope);
 input.job.sourceHash=input.job.authority!.scopeHash;
 input.job.recordHash=socialRequestHash({...input.job,recordHash:''});
 rows.social_weekly_preproduction_jobs![0]!.record_hash=input.job.recordHash;
 rows.social_weekly_preproduction_jobs![0]!.payload=structuredClone(input.job);
 const run={...input.runs[0]!,scopeSnapshot:{...input.runs[0]!.scopeSnapshot,weeklyAccountCollectionTarget:{accountUrl,targetCount:5}},queryBasis:{account:[accountUrl]},modeStats:{account:{requested:5}},finishedAt:'2026-10-18T00:01:00Z'} as SocialInspirationCollectionRun;
 rows.social_discovery_runs![0]=run as unknown as Record_;input.runs[0]=run;
 rows.social_discovery_daily_reservations![0]!.request_key=`account:tiktok:${accountUrl}`;
 rows.social_discovery_daily_reservations![0]!.count=5;
 assert.equal((await ensureWeeklyQualifiedContinuationStage({...input,now:new Date('2026-10-18T00:05:59.999Z')})).code,'weekly_qualified_interval_pending');
 const first=await ensureWeeklyQualifiedContinuationStage(input);
 assert.equal(first.ready,true);if(!first.ready)return;
 assert.deepEqual(first.stage.source,{mode:'account',platform:'tiktok',queryRef:accountUrl,limit:1});
 assert.equal(first.stage.authorizesExecution,false);
 assert.deepEqual(await ensureWeeklyQualifiedContinuationStage(input),first,'restart reuses the same immutable stage');
 assert.equal(rows.social_discovery_daily_reservations!.length,1,'stage creates no reservation or provider operation');
 assert.equal((await ensureWeeklyQualifiedContinuationStage({...input,now:new Date('2026-10-18T16:01:00Z')})).code,'weekly_qualified_cross_day_authorization_required');
 scope.discoveryBrief.weeklyAccountCollectionTarget.accountUrl='https://www.tiktok.com/@changed';
 await assert.rejects(ensureWeeklyQualifiedContinuationStage(input),/scope_changed/,'scope drift cannot redirect the supplemental provider request');
});

test('pending admission, changed parent and changed approved source fail closed without a stage',async()=>{
 const {rows,input}=fixture();
 const pendingRun={...input.runs[0]!,evidenceOutcomes:{momentum:{acceptedCandidateIds:[],acceptedEvidenceRefs:[],suggestionCandidateIds:['candidate'],failedCandidateIds:[]}}};
 rows.social_discovery_runs![0]=pendingRun as unknown as Record_;input.runs[0]=pendingRun;
 rows.trend_videos=[{id:'candidate',tenantId,platform:'tiktok',sourceUrl:'https://www.tiktok.com/@shop/video/123',aiAnalysis:JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[{runId,scopeId:'scope',scopeVersion:1,mode:'momentum',queryRef:'source-a'}]})}];
 assert.equal((await ensureWeeklyQualifiedContinuationStage(input)).code,'weekly_qualified_post_admission_pending');
 input.runs[0]={...input.runs[0],finishedAt:'2026-10-18T00:00:00Z'};
 await assert.rejects(ensureWeeklyQualifiedContinuationStage(input),/run_changed/);
 input.runs[0]=rows.social_discovery_runs![0] as unknown as SocialInspirationCollectionRun;
 rows.trend_videos![0]!.aiAnalysis=JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[{runId:'historical',scopeId:'scope',scopeVersion:1,mode:'momentum',queryRef:'source-a'}]});
 await assert.rejects(ensureWeeklyQualifiedContinuationStage(input),/origin_invalid/);
 rows.trend_videos![0]!.aiAnalysis=JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[{runId,scopeId:'scope',scopeVersion:1,mode:'momentum',queryRef:'source-a'}]});
 (rows.social_discovery_scopes![0]!.payload as {discoveryBrief:{modePolicies:{momentum:{sourceRefs:string[]}}}}).discoveryBrief.modePolicies.momentum.sourceRefs=['unapproved'];
 await assert.rejects(ensureWeeklyQualifiedContinuationStage(input),/scope_changed/);
 assert.equal(rows[WEEKLY_QUALIFIED_CONTINUATION_STAGES]?.length??0,0);
});

test('unknown prior run and exhausted normal day do not stage a new attempt',async()=>{
 const {rows,input}=fixture();
 const unknown={...input.runs[0]!,status:'running' as const,finishedAt:null};
 rows.social_discovery_runs![0]=unknown as unknown as Record_;input.runs[0]=unknown;
 assert.equal((await ensureWeeklyQualifiedContinuationStage(input)).code,'weekly_qualified_prior_attempt_unsettled');
 rows.social_discovery_runs![0]={...unknown,status:'partial',finishedAt:'2026-10-18T00:01:00Z'} as unknown as Record_;input.runs[0]=rows.social_discovery_runs![0] as unknown as SocialInspirationCollectionRun;
 rows.social_discovery_daily_reservations![0]!.count=10;
 assert.equal((await ensureWeeklyQualifiedContinuationStage(input)).code,'weekly_qualified_quota_exhausted');
 assert.equal(rows[WEEKLY_QUALIFIED_CONTINUATION_STAGES]?.length??0,0);
 const crossDay=await ensureWeeklyQualifiedContinuationStage({...input,now:new Date('2026-10-18T16:01:00Z')});
 assert.equal(crossDay.code,'weekly_qualified_cross_day_authorization_required');
 assert.equal(rows[WEEKLY_QUALIFIED_CONTINUATION_STAGES]?.length??0,0);
});

test('a completed child is admitted only through its immutable parent hash and attempt binding',async()=>{
 const {rows,input}=fixture();
 (rows.social_discovery_scopes![0]!.payload as {discoveryBrief:{modePolicies:{momentum:{sourceRefs:string[]}}}}).discoveryBrief.modePolicies.momentum.sourceRefs.push('source-c');
 const changedScope=rows.social_discovery_scopes![0]!.payload;
 input.job.authority!.scopeHash=socialRequestHash(changedScope);input.job.sourceHash=input.job.authority!.scopeHash;input.job.recordHash=socialRequestHash({...input.job,recordHash:''});
 rows.social_weekly_preproduction_jobs![0]!.record_hash=input.job.recordHash;rows.social_weekly_preproduction_jobs![0]!.payload=structuredClone(input.job);
 const childKey='weekly:child',childRunId=`weekly_discovery_${socialRequestHash({tenantId,key:childKey})}`,parentHash=socialRequestHash(input.runs[0]);
 const sourceSelection=[{mode:'momentum',platform:'tiktok',queryRef:'source-b'}];
 const childJob={...input.job,jobId:'child-job',originalRunKey:childKey,retry:{rootJobId:input.job.jobId,rootJobHash:input.job.recordHash,parentRunId:runId,parentRunHash:parentHash,sourceSelection},recordHash:''};
 childJob.recordHash=socialRequestHash(childJob);
 rows.social_weekly_preproduction_retry_attempts=[{id:'child-job',tenant_id:tenantId,program_id:'program',package_id:'package',package_version:1,root_job_id:input.job.jobId,record_hash:childJob.recordHash,payload:childJob}];
 const childRun={id:'child-row',tenant_id:tenantId,runId:childRunId,status:'partial',startedAt:'2026-10-18T00:02:00Z',finishedAt:'2026-10-18T00:03:00Z',discoveryScopeId:'scope',discoveryScopeVersion:1,scopeSnapshot:{weeklyProducer:{key:childKey,retry:{parentRunId:runId,parentRunHash:parentHash,sourceSelection}}},modeStats:{},evidenceOutcomes:{}} as unknown as SocialInspirationCollectionRun;
 rows.social_discovery_runs!.push(childRun as unknown as Record_);input.runs.push(childRun);input.now=new Date('2026-10-18T00:08:00Z');
 rows.social_discovery_daily_reservations!.push({id:'child-reservation',tenant_id:tenantId,day:'2026-10-18',run_id:childRunId,request_key:'momentum:tiktok:source-b',count:1});
 const result=await ensureWeeklyQualifiedContinuationStage(input);
 assert.equal(result.ready,true);if(!result.ready)return;
 assert.equal(result.stage.source.queryRef,'source-c');
 assert.deepEqual(result.stage.runIds,[runId,childRunId]);
 await assert.rejects(ensureWeeklyQualifiedContinuationStage({...input,runs:input.runs.slice(0,1)}),/attempt_set_incomplete/);
 rows.social_weekly_preproduction_retry_attempts![0]!.record_hash='tampered';
 await assert.rejects(ensureWeeklyQualifiedContinuationStage(input),/attempt_binding_invalid/);
});

test('same-day five-minute qualified attempt needs both accepted-template proofs and replays one bound identity without provider calls',async t=>{
 const {rows,input}=fixture(),scope={tenantId,programId:'program',packageId:'package',packageVersion:1},cols={tenant_id:tenantId,program_id:'program',package_id:'package',package_version:1};
 await withExecutionPackageGate(input.store,scope,async()=>{
  const missing=await ensureWeeklyQualifiedContinuationAttempt(input);
  assert.equal(missing.attempt,null);assert.equal(missing.code,'weekly_qualified_template_authority_unavailable');
  assert.equal(rows.social_weekly_preproduction_retry_attempts?.length??0,0);
 });
 rows[WEEKLY_INDEPENDENT_ADMISSIONS]=[{id:independentAdmissionId(scope),...cols,payload:{...scope,actorUserId:'owner',admittedAt:'2026-10-18T00:00:00Z',mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}}];
 const task=rows.social_weekly_execution_tasks![0]!.payload as Record<string,unknown>;
 const receipt={proposalId:'proposal',source:'automatic_template',templateVersion:WEEKLY_AUTOMATION_TEMPLATE.version,userApproval:null};
 const proposal={...scope,proposalId:'proposal',inputAuthority:'target_graph_with_automatic_template_capacity',automaticAdoption:receipt,targetGraph:{tasks:[task]},capacity:{constraints:{task:{availableAt:'2026-10-18T00:00:00Z'}}}};
 rows[AUTOMATIC_WEEKLY_SCHEDULES]=[{id:'auto-receipt',...cols,payload:receipt,content_hash:socialRequestHash(receipt)}];
 rows[SCHEDULE_PROPOSALS]=[{id:'auto-proposal',...cols,proposal_id:'proposal',payload:proposal,content_hash:scheduleHash(proposal)}];
 rows.content_execution_limits=['tenant','task_type'].map((dimension,index)=>({id:`limit-${index}`,tenant_id:tenantId,limit_scope:dimension,scope_key:index?'social_content_weekly':'*',max_running:3}));
 let committed:Awaited<ReturnType<typeof ensureWeeklyQualifiedContinuationAttempt>>['attempt']=null;
 await withExecutionPackageGate(input.store,scope,async()=>{
  const first=await ensureWeeklyQualifiedContinuationAttempt(input);
  assert(first.attempt);assert.equal(first.attempt.retry.kind,'qualified_continuation');
  committed=first.attempt;
  assert.equal(first.attempt.retry.authorization?.kind,'normal_daily_window');
  assert.equal(rows.social_weekly_preproduction_retry_attempts?.length,1);
  const replay=await ensureWeeklyQualifiedContinuationAttempt({...input,now:new Date('2026-10-18T00:07:00Z')});
  assert.equal(replay.attempt?.jobId,first.attempt.jobId);
  assert.equal(rows.social_weekly_preproduction_retry_attempts?.length,1);
 });
 assert.equal(rows.social_discovery_daily_reservations?.length,1,'binding does not spend quota');
 assert.equal(rows.social_discovery_runs?.length,1,'binding does not start a new run');
 const bound=committed as unknown as NonNullable<Awaited<ReturnType<typeof ensureWeeklyQualifiedContinuationAttempt>>['attempt']>;
 assert(bound);
 let crawlCalls=0;
 const dependencies={dataStore:input.store,async crawl(){crawlCalls++;return {platform:'tiktok' as const,keyword:'source-b',imported:0,refreshed:0,skipped:0,skippedExisting:0,returnedExisting:0,requested:1,total:0,source:'r3' as const,message:'',candidateIds:[],items:[]};},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){return{accepted:[],suggestions:[],failed:[]};}};
 const request={tenantId,triggerType:'manual' as const,expectedScopeId:'scope',expectedScopeVersion:1,requestedModes:['momentum' as const],originalRun:{key:bound.originalRunKey,scopeHash:input.job.authority!.scopeHash},retry:{kind:'qualified_continuation' as const,continuationStageId:bound.retry.continuationStageId,parentRunId:bound.retry.parentRunId,parentRunHash:bound.retry.parentRunHash,sourceSelection:bound.retry.sourceSelection,authorization:bound.retry.authorization},now:input.now};
 await assert.rejects(executeApprovedDiscoveryRun({...request,now:new Date('2026-10-18T00:05:59.999Z')},dependencies as any),/weekly_discovery_qualified_interval_pending/,'a durable bound attempt cannot submit early after a clock correction');
 assert.equal(crawlCalls,0);
 assert.equal(rows.social_discovery_daily_reservations?.length,1,'early replay cannot reserve quota');
 const savedAdmission=rows[WEEKLY_INDEPENDENT_ADMISSIONS];
 delete rows[WEEKLY_INDEPENDENT_ADMISSIONS];
 await assert.rejects(executeApprovedDiscoveryRun(request,dependencies as any),/weekly_qualified_submit_template_authority_unavailable/,'bound attempt needs fresh independent and automatic authority at paid submit');
 assert.equal(crawlCalls,0);
 assert.equal(rows.social_discovery_daily_reservations?.length,1);
 rows[WEEKLY_INDEPENDENT_ADMISSIONS]=savedAdmission;
 const savedCapacity=rows.social_discovery_daily_reservations![0]!.count;
 rows.social_discovery_daily_reservations![0]!.count=10;
 await assert.rejects(executeApprovedDiscoveryRun(request,dependencies as any),/weekly_qualified_submit_weekly_qualified_quota_exhausted/,'bound attempt cannot spend quota exhausted after binding');
 assert.equal(crawlCalls,0);
 assert.equal(rows.social_discovery_daily_reservations?.length,1);
 rows.social_discovery_daily_reservations![0]!.count=savedCapacity;
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'qualified-child-restart-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const snapshot=path.join(directory,'isolated-store.json');
 const restart=async()=>{await fs.writeFile(snapshot,JSON.stringify(rows));const fresh=fixture();const saved=JSON.parse(await fs.readFile(snapshot,'utf8')) as Record<string,Record_[]>;for(const key of Object.keys(fresh.rows))delete fresh.rows[key];Object.assign(fresh.rows,saved);return fresh;};
 const recovered=await restart();
 const firstRun=await executeApprovedDiscoveryRun(request,{...dependencies,dataStore:recovered.input.store} as any);
 assert(firstRun.run);assert.equal(crawlCalls,1);assert.equal(recovered.rows.social_discovery_daily_reservations?.length,2);
 const replayed=fixture();for(const key of Object.keys(replayed.rows))delete replayed.rows[key];Object.assign(replayed.rows,structuredClone(recovered.rows));
 const replay=await executeApprovedDiscoveryRun({...request,originalRun:{...request.originalRun,recoveryOnly:true}},{...dependencies,dataStore:replayed.input.store} as any);
 assert.equal(replay.run?.runId,firstRun.run.runId);assert.equal(crawlCalls,1,'exact run readback never pays twice');
});

test('bound qualified child stops before reservation when current-week admissions mature to five or remain pending',async()=>{
 const priorNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='test';
 try{
 const {rows,input}=fixture(),ids=Array.from({length:5},(_,i)=>`candidate-${i+1}`);
 const root={...input.runs[0]!,evidenceOutcomes:{momentum:{acceptedCandidateIds:ids,acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}};
 rows.social_discovery_runs![0]=root as unknown as Record_;input.runs[0]=root;
 const rejected=ids.map(candidateId=>({candidateId,evidenceRef:null,exactHandoffRef:null,accountId:null,postAdmission:'rejected' as const}));
 const candidateReader=async()=>rejected;
 const scope={tenantId,programId:'program',packageId:'package',packageVersion:1},cols={tenant_id:tenantId,program_id:'program',package_id:'package',package_version:1};
 rows[WEEKLY_INDEPENDENT_ADMISSIONS]=[{id:independentAdmissionId(scope),...cols,payload:{...scope,actorUserId:'owner',admittedAt:'2026-10-18T00:00:00Z',mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}}];
 const task=rows.social_weekly_execution_tasks![0]!.payload as Record<string,unknown>;
 const receipt={proposalId:'proposal',source:'automatic_template',templateVersion:WEEKLY_AUTOMATION_TEMPLATE.version,userApproval:null};
 const proposal={...scope,proposalId:'proposal',inputAuthority:'target_graph_with_automatic_template_capacity',automaticAdoption:receipt,targetGraph:{tasks:[task]},capacity:{constraints:{task:{availableAt:'2026-10-18T00:00:00Z'}}}};
 rows[AUTOMATIC_WEEKLY_SCHEDULES]=[{id:'auto-receipt',...cols,payload:receipt,content_hash:socialRequestHash(receipt)}];
 rows[SCHEDULE_PROPOSALS]=[{id:'auto-proposal',...cols,proposal_id:'proposal',payload:proposal,content_hash:scheduleHash(proposal)}];
 rows.content_execution_limits=['tenant','task_type'].map((dimension,index)=>({id:`limit-${index}`,tenant_id:tenantId,limit_scope:dimension,scope_key:index?'social_content_weekly':'*',max_running:3}));
 let bound:NonNullable<Awaited<ReturnType<typeof ensureWeeklyQualifiedContinuationAttempt>>['attempt']>|null=null;
 await withExecutionPackageGate(input.store,scope,async()=>{const result=await ensureWeeklyQualifiedContinuationAttempt({...input,candidateReader});bound=result.attempt;});
 assert(bound);const child=bound as unknown as WeeklyPreproductionRetryAttempt;
 let providerCalls=0;
 const dependencies={dataStore:input.store,async crawl(){providerCalls++;throw Error('provider_must_not_run');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){return{accepted:[],suggestions:[],failed:[]};}};
 const request={tenantId,triggerType:'manual' as const,expectedScopeId:'scope',expectedScopeVersion:1,requestedModes:['momentum' as const],originalRun:{key:child.originalRunKey,scopeHash:input.job.authority!.scopeHash},retry:{kind:'qualified_continuation' as const,continuationStageId:child.retry.continuationStageId,parentRunId:child.retry.parentRunId,parentRunHash:child.retry.parentRunHash,sourceSelection:child.retry.sourceSelection,authorization:child.retry.authorization},now:input.now};
 const accepted=ids.map(candidateId=>({candidateId,evidenceRef:'evidence@1',exactHandoffRef:'handoff@1',accountId:'account',postAdmission:'accepted' as const}));
 await assert.rejects(executeApprovedDiscoveryRun(request,{...dependencies,qualifiedCandidateReader:async()=>accepted} as any),/weekly_qualified_submit_weekly_qualified_target_met/);
 await assert.rejects(executeApprovedDiscoveryRun(request,{...dependencies,qualifiedCandidateReader:async()=>[{...rejected[0]!,postAdmission:'pending' as const},...rejected.slice(1)]} as any),/weekly_qualified_submit_weekly_qualified_post_admission_pending/);
 assert.equal(providerCalls,0);assert.equal(rows.social_discovery_daily_reservations?.length,1);assert.equal(rows.social_discovery_runs?.length,1);
 }finally{if(priorNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNodeEnv;}
});
