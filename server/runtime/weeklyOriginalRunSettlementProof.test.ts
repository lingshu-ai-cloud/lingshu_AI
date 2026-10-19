import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyAgentPlanningState,WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {buildWeeklyProductionScopeCapacity,persistWeeklyProductionScopeCapacity} from '../socialPrograms/weeklyProductionScopeCapacity.js';
import {weeklyPlanningAnalysisHash} from '../socialPrograms/weeklyPlanningTemplateAdoption.js';
import {scheduleHash} from '../socialPrograms/weeklyScheduleSnapshots.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {socialContentQueueItemId} from '../starter198/socialContentScheduler.js';
import {WEEKLY_AUTOMATIC_PRODUCTION_INTENTS,type WeeklyAutomaticProductionIntent} from '../socialPrograms/weeklyAutomaticProductionPlanning.js';
import {originalRunArtifactCompletionInBounds,readWeeklyOriginalRunStartProof,readWeeklyOriginalRunSettlementProof} from './weeklyOriginalRunSettlementProof.js';
import {createSocialWeeklyProductionAdapter} from './socialWeeklyProductionAdapter.js';
import {prepareWeeklyNonPresenterPlanningFixture} from './weeklyNonPresenterProduction.fixture.js';
import {materializeWeeklyExecutionTasks,listWeeklyExecutionTasks} from '../socialPrograms/executionTasks.js';
import {WEEKLY_INDEPENDENT_ADMISSIONS,independentAdmissionId} from '../socialPrograms/weeklyIndependentAdmission.js';
import {adoptWeeklyAutomationTemplate} from '../socialPrograms/weeklyAutomationTemplate.js';
import {prepareWeeklyAutomaticProductionPlanning} from '../socialPrograms/weeklyAutomaticProductionPlanning.js';
import {createWeeklyOperatingPackageService} from '../socialPrograms/weeklyOperatingPackages.js';
import {bindWeeklyPreproductionAuthority,runWeeklyPreproductionProducerScan} from './weeklyPreproductionProducer.js';
import {supplementConsumerHash} from '../socialPrograms/weeklySupplementRequests.js';
import {createSocialWeeklyExecutionWorker} from './socialWeeklyExecutionWorker.js';
import {createSocialWeeklyPlanningAdapter} from './socialWeeklyExecutionRuntime.js';
import {setContentExecutionLimit} from '../contentExecution/durableQueue.js';

async function fixture(){
 const tables:Record<string,Record_[]>={};let serial=0;const writes:string[]=[];
 const store={
  async getById(c:string,id:string){return (tables[c]??[]).find(row=>row.id===id)??null;},
  async list(c:string,q:{where?:Record<string,unknown>;page?:number;perPage?:number}={}){const all=(tables[c]??[]).filter(row=>Object.entries(q.where??{}).every(([key,value])=>row[key]===value));const page=q.page??1,perPage=q.perPage??500;return {items:all.slice((page-1)*perPage,page*perPage),totalItems:all.length,totalPages:Math.max(1,Math.ceil(all.length/perPage)),page,perPage};},
  async create(c:string,value:Record<string,unknown>){writes.push(c);const row={id:String(value.id??`record-${++serial}`),...value};(tables[c]??=[]).push(row);return row;},
  async update(){throw Error('read-only proof must not update');},async delete(){throw Error('read-only proof must not delete');},
 } as unknown as DataStore;
 const scope={tenantId:'t',programId:'p',packageId:'w',packageVersion:2};
 const publications=[{publicationTaskId:'pub',motherContentId:'mother',accountId:'account',businessProposition:'verified product',cta:'verified route',factRefs:[],publishWindow:'2026-10-16T18:00:00+08:00'}];
 const pkg={...scope,version:2,status:'draft',weekStart:'2026-10-12',weekEnd:'2026-10-18',socialContentPackage:{productionIdentityVersion:'shared-original.v1',publicationTasks:publications,weeklyBudgetCny:240,perItemBudgetCny:10}} as unknown as WeeklyOperatingPackage;
 const account={type:'benchmark_account',id:'account',version:1},video={type:'benchmark_video',id:'video',version:1};
 const analysis={analysisId:'analysis',packageId:'w',packageVersion:2,slotId:'slot',benchmarkAccountRefs:[account],benchmarkVideoRefs:[video],benchmarkEvidenceRefs:['evidence'],contentDirection:'Verified'};
 const detail={ref:{type:'weekly_detailed_schedule',id:'detail',version:1},coverage:{selectedSlotIds:['slot'],pendingSlotIds:[],referenceSourcePolicy:null},items:publications.map(publication=>({...publication,slotId:'slot',directorAnalysisRef:{type:'weekly_director_analysis',id:'analysis',version:1},benchmarkAccountRefs:[account],benchmarkVideoRefs:[video]}))};
 const planning={...scope,status:'dispatched',version:4,skeleton:{slots:[{slotId:'slot',publicationTaskIds:['pub'],referenceSource:'external'}]},directorAnalyses:[analysis],detailedSchedule:detail,userConfirmation:null,dispatch:{scheduleItems:detail.items}} as unknown as WeeklyAgentPlanningState;
 // Template acceptance may precede the week; the capacity/intent builder
 // admits production only during the actual week, independently of acceptance.
 const adoption={source:'automatic_template' as const,templateVersion:'weekly-automation.v3' as const,adoptedAt:'2026-10-09T00:00:00Z',actorUserId:'owner',userApproval:null,selectedSlotIds:['slot'],analysisEvidenceHash:weeklyPlanningAnalysisHash(planning),detailedScheduleHash:scheduleHash(detail),authorizesPublishing:false as const,authorizesContentAcceptance:false as const,authorizesCustomerMessages:false as const};
 planning.automaticTemplateAdoption={...adoption,recordHash:scheduleHash(adoption)};
 const kinds=['business_outline','benchmark_collection','benchmark_scoring','director_analysis','business_schedule','material_preparation','script','storyboard','asset_generation','video_generation','quality_check'];
 const tasks=kinds.map((stepKind,index)=>({...scope,taskId:stepKind,publicationTaskId:index>3?'pub':null,workflowKind:'content',scope:'content',subjectId:stepKind,accountId:'account',idempotencyKey:`weekly:${stepKind}`,inputSnapshot:{rollingDate:'2026-10-16',facts:'v1'},upstreamVersionRefs:[],dependsOnTaskIds:index?[kinds[index-1]]:[],inheritedBlockingTaskIds:[],schedule:{stepKind,responsibleActor:'content_agent',estimatedDurationMinutes:10,actualStartedAt:null,actualFinishedAt:null},attempt:0,status:'blocked',resultRefs:[],lease:null,budget:{category:index>4?'production':'none',limitCny:index>4?10:null},ownBlockingReasons:[]})) as unknown as WeeklyExecutionTask[];
 const limits=['tenant','task_type'].map((limitScope,index)=>({id:`limit-${index}`,tenantId:'t',scope:limitScope,scopeKey:index?'social_content_weekly':'*',maxRunning:3}));
 const now='2026-10-16T07:00:00Z';const proof=buildWeeklyProductionScopeCapacity({pkg,tasks,planning,selectedSlotIds:['slot'],now,limits:limits as any,verifiedCompletedTaskIds:new Set()});
 await persistWeeklyProductionScopeCapacity(store,proof);
 const intentId=socialRequestHash([scope,planning.automaticTemplateAdoption.recordHash]);
 const intent:WeeklyAutomaticProductionIntent={intentId,scope,source:'automatic_template',templateVersion:'weekly-automation.v3',adoptedAt:now,userApproval:null,actorUserId:'owner',planningAdoptionHash:planning.automaticTemplateAdoption.recordHash,productionAuthorityProofId:'production-proof',capacityProofId:proof.proofId,dispatchHash:socialRequestHash(planning.dispatch),selectedPublicationTaskIds:['pub'],authorizesPublishing:false,authorizesContentAcceptance:false,authorizesCustomerMessages:false};
 await store.create(WEEKLY_AUTOMATIC_PRODUCTION_INTENTS,{id:intentId,tenant_id:'t',payload:intent,content_hash:socialRequestHash(intent)});
 for(const task of tasks)await store.create('social_weekly_execution_tasks',{tenant_id:'t',task_id:task.taskId,payload:task});
 const parent=tasks.find(task=>task.taskId==='video_generation')!;parent.status='succeeded';parent.resultRefs=[{type:'starter_social_content_artifact',id:'artifact',version:1}];
 const task=tasks.find(task=>task.taskId==='quality_check')!;
 const queueRequest={tenantId:'t',userId:'owner',commandId:'command',idempotencyKey:'start-key',workflowScope:'social_content',subject:{type:'social_content_task',id:'content',admissionVersion:'v7'}};
 const dispatchBody={schemaVersion:'social-content-dispatch.v1',commandId:'command',userId:'owner',expectedVersion:'v7',idempotencyKey:'start-key',queueRequest};
 const dispatch={...dispatchBody,requestHash:socialRequestHash(dispatchBody)};
 const content={id:'content-row',tenant_id:'t',task_id:'content',run_id:'run',weekly_plan_id:'w',create_idempotency_key:'weekly-production:w:2:pub',orchestrator_item_id:socialContentQueueItemId(queueRequest as any),brief:{programRef:{id:'p'}},content_order:{schemaVersion:'social-content-order.v1',contentId:'content',budgetTaskId:'content',entry:'weekly_package',programId:'p',originWeek:'2026-10-12',dispatch}};
 await store.create('starter_social_content_tasks',content);
 await store.create('social_content_creation_quotas',{tenant_id:'t',program_id:'p',week_start:'2026-10-12',payload:{scope:{tenantId:'t',programId:'p',weekStart:'2026-10-12'},orders:{content:{contentId:'content',slotId:'slot-1',state:'running',entry:'weekly_package',packageId:'w',packageVersion:2,productionTaskId:'content'}},slots:[{slotId:'slot-1',contentId:'content'}],outbox:[{commandId:'command',contentId:'content',kind:'dispatch',state:'acknowledged'}],audit:[{commandId:'command',contentId:'content',actorId:'owner',action:'reserved',at:'2026-10-16T07:29:00Z'}]}});
 await store.create('starter_social_content_operations',{tenant_id:'t',operation_id:'command',operation:'start_social_content_task',status:'succeeded',target_id:'content',created_by:'owner',idempotency_key:'start-key',request_hash:socialRequestHash({expectedVersion:'v7'}),result:{schemaVersion:'social-content.operation-result.v1',operationId:'command',targetId:'content'},created_at:'2026-10-16T07:30:00Z'});
 await store.create('workflow_runs',{id:'run',tenant_id:'t',product_profile:'starter_198',status:'waiting_human',starter_context:{schemaVersion:'starter-social-content.auto-execution.v1',socialTaskId:'content'},started_at:'2026-10-16T07:31:00Z'});
 await store.create('content_execution_jobs',{tenant_id:'t',job_key:'job',task_id:'content',run_id:'run',user_id:'owner',account_id:'account',task_type:'social_content_weekly',status:'paused',created_at:'2026-10-16T07:32:00Z'});
 writes.length=0;
 return {store,tables,writes,pkg,planning,task,now:'2026-10-19T07:00:00Z',intent,proof,content};
}
test('original run start chain is readable next week without replaying a capacity grant or writing',async()=>{
 const f=await fixture();const result=await readWeeklyOriginalRunStartProof(f);
 assert.deepEqual(result,{contentTaskId:'content',runId:'run',jobId:f.tables.content_execution_jobs![0]!.id,startOperationId:'command',capacityProofId:f.proof.proofId,artifactRef:{type:'starter_social_content_artifact',id:'artifact',version:1}});
 assert.deepEqual(f.writes,[]);
 assert.equal(await readWeeklyOriginalRunSettlementProof(f),null,'start chain alone is not a validated finished film');
 assert.deepEqual(f.writes,[]);
});
test('ordinary original quality adapter settles after week only from full same-run proof and never requeues an incomplete run',async()=>{
 const f=await fixture();
 await f.store.create('social_weekly_operating_packages',{tenant_id:'t',program_id:'p',package_id:'w',version:2,payload:f.pkg});
 await f.store.create('social_weekly_agent_planning',{tenant_id:'t',program_id:'p',package_id:'w',package_version:2,planning_version:f.planning.version,payload:f.planning});
 f.writes.length=0;
 const adapter=createSocialWeeklyProductionAdapter(f.store,{now:()=>new Date(f.now),create:async()=>assert.fail('must not create'),start:async()=>assert.fail('must not start'),addSource:async()=>assert.fail('must not bind source')});
 const result=await adapter.execute(f.task);
 assert.equal(result.status,'blocked');
 assert.equal('code' in result?result.code:null,'weekly_original_run_settlement_unverified');
 assert.deepEqual(f.writes,[]);
});
test('formal automatic-week source reveals its first unmet same-run production gate without borrowing old media or paying',async t=>{
 const f=await prepareWeeklyNonPresenterPlanningFixture(t,{confirmedTemplate:true,deferAutomaticPlanning:true,formalActivation:true,ownedReferenceBytes:true,primaryStructure:true,targetCta:'Contact sales',metricTargets:['播放目标1000','点赞目标20','评论目标5','分享目标5'],successCriteria:['实际制作一条待审核视频']});
 const scope={tenantId:'t',programId:'p',packageId:f.pkg.packageId,packageVersion:f.pkg.version};
 const tasks=await materializeWeeklyExecutionTasks(f.f.store,'t',f.pkg);
 await f.f.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(scope),tenant_id:'t',program_id:'p',package_id:f.pkg.packageId,package_version:f.pkg.version,payload:{...scope,actorUserId:'owner',admittedAt:new Date().toISOString(),mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}});
 await adoptWeeklyAutomationTemplate(f.f.store,scope,'owner');
 await createWeeklyOperatingPackageService(f.f.store).activate('t','owner','p',f.pkg.packageId,{expectedVersion:f.pkg.version,expectedProgramVersion:1,authorizePublishing:false});
 const outline=tasks.find(task=>task.schedule.stepKind==='business_outline')!;
 await bindWeeklyPreproductionAuthority({store:f.f.store,...scope,taskId:outline.taskId,actorUserId:'owner',kind:'outline',expectedConsumerInputHash:supplementConsumerHash(outline),now:new Date()});
 assert.equal((await runWeeklyPreproductionProducerScan({store:f.f.store,now:new Date()})).succeeded,1);
 const worker=createSocialWeeklyExecutionWorker(f.f.store);
 const claimed=await worker.claimNext({tenantId:'t',workerId:'cross-week-source-worker',now:new Date(),scope});
 assert.equal(claimed?.task.taskId,outline.taskId);
 const result=await createSocialWeeklyPlanningAdapter(f.f.store).execute(claimed!.task);
 assert.equal(result.status,'succeeded');
 if(result.status==='succeeded')await worker.complete(claimed!,result.resultRefs,new Date());
 for(const [limitScope,scopeKey]of [['tenant','*'],['task_type','social_content_weekly']] as const)
  await setContentExecutionLimit({dataStore:f.f.store,tenantId:'t',scope:limitScope,scopeKey,maxRunning:2,updatedBy:'owner',now:new Date()});
 const prepared=await prepareWeeklyAutomaticProductionPlanning(f.f.store,scope,new Date().toISOString());
 assert.equal(prepared.status,'prepared');
 if(prepared.status!=='prepared')return;
 const quality=(await listWeeklyExecutionTasks(f.f.store,'t','p',f.pkg.packageId,f.pkg.version)).find(task=>task.schedule.stepKind==='quality_check')!;
 const assignment=(await f.f.store.getById<{payload:{assignments:Array<{taskId:string;startAt:string}>}}>('social_weekly_production_scope_capacities',prepared.intent.capacityProofId))!.payload.assignments.find(item=>item.taskId===quality.taskId)!;
 const beforeContent=f.f.tables.starter_social_content_tasks?.filter(row=>row.create_idempotency_key===`weekly-production:${f.pkg.packageId}:${f.pkg.version}:${quality.publicationTaskId}`).length??0;
 const beforeUsage=f.f.tables.starter_usage_ledger?.length??0;
 const attempt=await createSocialWeeklyProductionAdapter(f.f.store,{now:()=>new Date(assignment.startAt),create:async()=>assert.fail('policy gate must prevent create'),start:async()=>assert.fail('policy gate must prevent start')}).execute(quality);
 assert.equal(attempt.status,'blocked',JSON.stringify(attempt));
 assert.equal('code' in attempt?attempt.code:null,'weekly_production_cta_evidence_required');
 assert.equal(f.f.tables.starter_social_content_tasks?.filter(row=>row.create_idempotency_key===`weekly-production:${f.pkg.packageId}:${f.pkg.version}:${quality.publicationTaskId}`).length??0,beforeContent);
 assert.equal(f.f.tables.starter_usage_ledger?.length??0,beforeUsage);
});
test('original-week final millisecond is not a cross-week settlement window',async()=>{
 const f=await fixture();
 assert.equal(await readWeeklyOriginalRunStartProof({...f,now:'2026-10-18T15:59:59.999Z'}),null);
 assert.notEqual(await readWeeklyOriginalRunStartProof({...f,now:'2026-10-18T16:00:00.000Z'}),null);
 assert.deepEqual(f.writes,[]);
});
test('a legacy playable artifact cannot settle an automatic original run without v3 graph QA',async()=>{
 const f=await fixture();
 await f.store.create('starter_social_content_artifacts',{tenant_id:'t',artifact_id:'artifact',version:1,status:'review_required',content:{render:{completed:true}},artifact_kind:'short_video',origin:'agent',resource_ref:'socialfile:file'});
 f.writes.length=0;
 assert.notEqual(await readWeeklyOriginalRunStartProof(f),null,'original start remains a separate historical fact');
 assert.equal(await readWeeklyOriginalRunSettlementProof(f),null);
 assert.deepEqual(f.writes,[]);
});
test('same original graph-reviewed media remains unsettled without independent G4 and G5 receipts',async()=>{
 const f=await fixture();
 const bytes=Buffer.from('isolated original-run graph review media');
 const sha=createHash('sha256').update(bytes).digest('hex');
 const folder=path.resolve('data/social-content-sources',`original-run-settlement-${randomUUID()}`);
 const local=path.join(folder,`${sha}.mp4`);
 await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(local,bytes);
 const content={
  workflowSchema:'social-content.auto-production.v3',
  productionWorkspaceSource:{type:'actual_social_render',creationMode:'material_processing',runId:'run',outputSha256:sha},
  mediaStorage:{video:{fileId:'file',url:'/video',sha256:sha}},
  productionResult:{technicalReview:{approved:true,failures:[]},creativeReview:{approved:true,failedCriteria:[]}},
  technicalQualityReport:{schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[]},scenes:{passed:true,issues:[],checkedScenes:1},audio:{ok:true,error:null}},
  render:{completed:true,qualityPassed:true,audioDecoded:true,selectedAssetIds:['asset']},
  review:{automatedChecksPassed:true,technicalChecksPassed:true,creativeChecksPassed:true,state:'requires_user_approval'},
  delivery:{status:'publish_candidate'},
 };
 try{
  await f.store.create('social_weekly_operating_packages',{tenant_id:'t',program_id:'p',package_id:'w',version:2,payload:f.pkg});
  await f.store.create('starter_social_content_files',{tenant_id:'t',file_id:'file',task_id:'content',usage:'artifact_media',name:'video.mp4',mime_type:'video/mp4',byte_size:bytes.length,content_sha256:sha,storage_kind:'local',storage_key:path.relative(path.resolve('data/social-content-sources'),local)});
  await f.store.create('starter_social_content_artifacts',{tenant_id:'t',task_id:'content',artifact_id:'artifact',artifact_kind:'short_video',origin:'agent',resource_ref:'socialfile:file',version:'1',status:'review_required',created_at:'2026-10-19T00:00:00Z',content});
  f.tables.starter_social_content_tasks![0]!.status='asset_review';
  f.tables.workflow_runs![0]!.pause_reason='langgraph_artifact_review_required';
  f.tables.content_execution_jobs![0]!.checkpoints={'social.graph_review':{version:'1',inputHash:sha,updatedAt:'2026-10-19T00:00:00Z',payload:{artifactId:'artifact',version:'1',contentHash:socialRequestHash(content),outputSha256:sha,runId:'run',waitingReview:true}}};
  f.writes.length=0;
  assert.notEqual(await readWeeklyOriginalRunStartProof(f),null);
  assert.equal(await readWeeklyOriginalRunSettlementProof(f),null,'v3 media and graph review alone do not prove G4/G5');
  assert.deepEqual(f.writes,[]);
  await fs.writeFile(local,Buffer.from('changed media bytes'));
  assert.equal(await readWeeklyOriginalRunSettlementProof(f),null,'a drifted media file also cannot settle');
  assert.deepEqual(f.writes,[]);
 }finally{await fs.rm(folder,{recursive:true,force:true});}
});
test('historical film completion time must follow its original job and precede observation',()=>{
 const job='2026-10-16T07:32:00Z',observed='2026-10-19T07:00:00Z';
 assert.equal(originalRunArtifactCompletionInBounds('2026-10-19T00:00:00Z',job,observed),true);
 for(const completed of [undefined,'not-a-date','2026-10-16T07:31:59Z','2026-10-19T07:00:01Z'])
  assert.equal(originalRunArtifactCompletionInBounds(completed,job,observed),false,String(completed));
 assert.equal(originalRunArtifactCompletionInBounds('2026-10-19T00:00:00Z',undefined,observed),false);
 assert.equal(originalRunArtifactCompletionInBounds('2026-10-19T00:00:00Z',job,undefined),false);
});
test('cross-week start chain rejects identity, time, budget and dependency drift without writes',async()=>{
 const cases:Array<[string,(f:Awaited<ReturnType<typeof fixture>>)=>void]>=[
  ['start not succeeded',f=>{f.tables.starter_social_content_operations![0]!.status='processing';}],
  ['start receipt absent',f=>{delete f.tables.starter_social_content_operations![0]!.result;}],
  ['start receipt belongs to another command',f=>{(f.tables.starter_social_content_operations![0]!.result as any).operationId='other';}],
  ['run is not from formal content queue',f=>{(f.tables.workflow_runs![0]!.starter_context as any).schemaVersion='legacy';}],
  ['start outside original week',f=>{f.tables.starter_social_content_operations![0]!.created_at='2026-10-19T07:30:00Z';}],
  ['start before original capacity',f=>{f.tables.starter_social_content_operations![0]!.created_at='2026-10-16T06:30:00Z';}],
  ['production intent created before original week',f=>{f.intent.adoptedAt='2026-10-09T00:00:00Z';f.tables.social_weekly_automatic_production_intents![0]!.content_hash=socialRequestHash(f.intent);}],
  ['dispatch request changed',f=>{(f.content.content_order.dispatch as any).queueRequest.userId='other';}],
  ['dispatch queue subject type is not a social content task',f=>{const dispatch=f.content.content_order.dispatch as any;dispatch.queueRequest.subject.type='other';const {requestHash,...body}=dispatch;dispatch.requestHash=socialRequestHash(body);}],
  ['original content order entry changed',f=>{f.content.content_order.entry='workspace';}],
  ['original content order budget owner changed',f=>{f.content.content_order.budgetTaskId='other';}],
  ['original content order cancelled',f=>{(f.content.content_order as any).cancellation={commandId:'cancel'};}],
  ['original weekly quota missing',f=>{f.tables.social_content_creation_quotas=[];}],
  ['original weekly quota ambiguous',f=>{f.tables.social_content_creation_quotas!.push({...f.tables.social_content_creation_quotas![0]!,id:'duplicate'});}],
  ['quota slot moved',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).slots[0].contentId='other';}],
  ['quota same content occupies another slot',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).slots.push({slotId:'slot-2',contentId:'content'});}],
  ['quota reserved for another package',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).orders.content.packageId='other';}],
  ['quota order released',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).orders.content.state='released';}],
  ['quota outbox not acknowledged',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).outbox[0].state='pending';}],
  ['quota original reservation actor changed',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).audit[0].actorId='other';}],
  ['quota reservation from later week',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).audit[0].at='2026-10-19T07:29:00Z';}],
  ['quota reservation after original start',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).audit[0].at='2026-10-16T07:30:01Z';}],
  ['quota reservation before original capacity',f=>{(f.tables.social_content_creation_quotas![0]!.payload as any).audit[0].at='2026-10-16T06:59:59Z';}],
  ['quota reservation time missing',f=>{delete (f.tables.social_content_creation_quotas![0]!.payload as any).audit[0].at;}],
  ['creative revision child claims original task',f=>{(f.content.brief as any)._weeklyCreativeRepairProof={parentTaskId:'other'};}],
  ['production revision child claims original task',f=>{(f.content.brief as any)._productionRevision={parentTaskId:'other'};}],
  ['quality task belongs to revision child',f=>{(f.task.inputSnapshot as any).weeklyCreativeRepairRef={id:'child'};}],
  ['original content was cancelled',f=>{f.tables.starter_social_content_tasks![0]!.status='cancelled';}],
  ['run belongs elsewhere',f=>{f.tables.workflow_runs![0]!.starter_context={socialTaskId:'other'};}],
  ['job belongs to another actor',f=>{f.tables.content_execution_jobs![0]!.user_id='other';}],
  ['job created in new week',f=>{f.tables.content_execution_jobs![0]!.created_at='2026-10-19T07:32:00Z';}],
  ['capacity hash changed',f=>{f.tables.social_weekly_production_scope_capacities![0]!.content_hash='bad';}],
  ['unrelated frozen ancestor changed',f=>{const parent=f.tables.social_weekly_execution_tasks!.find(row=>row.task_id==='business_outline')!.payload as WeeklyExecutionTask;parent.inputSnapshot.facts='another fact version';}],
  ['frozen ancestor disappeared',f=>{f.tables.social_weekly_execution_tasks=f.tables.social_weekly_execution_tasks!.filter(row=>row.task_id!=='business_outline');}],
  ['frozen ancestor became ambiguous',f=>{const parent=f.tables.social_weekly_execution_tasks!.find(row=>row.task_id==='business_outline')!;f.tables.social_weekly_execution_tasks!.push({...parent,id:'duplicate-outline'});}],
  ['no unique upstream film',f=>{const parent=f.tables.social_weekly_execution_tasks!.find(row=>row.task_id==='video_generation')!.payload as WeeklyExecutionTask;parent.resultRefs=[];}],
  ['task input changed',f=>{f.task.inputSnapshot.facts='forged';}],
 ];
 for(const [name,change] of cases){const f=await fixture();change(f);assert.equal(await readWeeklyOriginalRunStartProof(f),null,name);assert.deepEqual(f.writes,[],name);}
});
