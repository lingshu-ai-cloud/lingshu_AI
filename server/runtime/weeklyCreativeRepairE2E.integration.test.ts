import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createContentCreationQuotaService} from '../socialPrograms/contentCreationQuota.js';
import {resolveSocialContentCostLineage} from '../starter198/socialContentCostLineage.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyNonPresenterProductionFixture} from './weeklyNonPresenterProduction.fixture.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {STARTER_COLLECTIONS} from '../starter198/repository.js';
import {createWeeklyProductionRepairCaseService} from '../socialPrograms/weeklyProductionRepairCases.js';
import {createWeeklyCreativeRepairConfigurationService} from '../socialPrograms/weeklyCreativeRepairConfiguration.js';
import {createWeeklyCreativeRepairExecutionService} from '../socialPrograms/weeklyCreativeRepairExecution.js';
import {createWeeklyCreativeRepairProductionPort} from './weeklyCreativeRepairProductionPort.js';
import {readSocialTaskDetail} from '../starter198/socialContentRecords.js';
import {assessWeeklyOwnedProductIdentity,bindWeeklyOwnedProductIdentity} from './weeklyOwnedProductIdentityDemand.js';
import {createWeeklyMaterialRequestService} from '../socialPrograms/weeklyMaterialRequests.js';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {HeyGenPresenterClient} from '../lib/heygenPresenters.js';
import {createPresenterAssetsRouter} from '../routes/presenterAssets.js';

async function registerControlledAuthorizedVoice(f:Awaited<ReturnType<typeof prepareWeeklyNonPresenterProductionFixture>>['f'],t:import('node:test').TestContext){
 const before=process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID='t';
 t.after(()=>{if(before===undefined)delete process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;else process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID=before;});
 const look={id:'controlled-private-photo',name:'受控测试人物',avatar_type:'photo_avatar',group_id:'controlled-private-group',default_voice_id:'controlled-voice',status:'completed',preview_image_url:'https://files.heygen.ai/controlled.png',image_width:1080,image_height:1920};
 const client=new HeyGenPresenterClient('test-only',(async(rawUrl:string)=>{
  const url=new URL(rawUrl);let data:unknown;
  if(url.pathname==='/v3/avatars/looks'&&url.searchParams.get('ownership')==='private')data=[look];
  else if(url.pathname===`/v3/avatars/looks/${look.id}`)data=look;
  else if(url.pathname===`/v3/avatars/${look.group_id}`)data={id:look.group_id,status:'completed',consent_status:'accepted'};
  else throw Error(`controlled_presenter_request_unexpected:${url.pathname}`);
  return Response.json({data});
 }) as typeof fetch);
 const app=express();app.use(express.json());app.use((_req,res,next)=>{res.locals.tenantId='t';next();});
 app.use('/presenter',createPresenterAssetsRouter(f.store,async(_key,action)=>action(),{client,configured:()=>true,enabled:()=>true}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const root=`http://127.0.0.1:${(server.address() as AddressInfo).port}/presenter`;
 const catalog=await fetch(`${root}/catalog?scope=private`);assert.equal(catalog.status,200);
 const imported=await fetch(`${root}/import`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lookId:look.id,voiceId:'controlled-voice',reviewed:true,authorized:true,adultConfirmed:true,makeDefault:true})});
 assert.equal(imported.status,200,await imported.text());
 const {readWeeklyProductionVoice}=await import('../starter198/socialContentBoundPresenterVoice.js');
 assert.equal((await readWeeklyProductionVoice(f.store,'t',[])).voiceId,'controlled-voice');
}

test('creative repair preserves child/quota lineage and stops before unavailable HeyGen voice TTS',async t=>{
 const originalFetch=globalThis.fetch;let externalAttempts=0;t.after(()=>{globalThis.fetch=originalFetch;});globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input:input.url);if(!['localhost','127.0.0.1','::1'].includes(url.hostname)){externalAttempts++;throw Error(`external_provider_forbidden_in_controlled_e2e:${url.hostname}`);}return originalFetch(input,init);};
 const keys=['SEEDANCE_VIDEO_ENABLED','SEEDANCE_API_KEY','SEEDREAM_API_KEY'] as const,old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));t.after(()=>{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});process.env.SEEDANCE_VIDEO_ENABLED='true';process.env.SEEDANCE_API_KEY='controlled-no-provider';process.env.SEEDREAM_API_KEY='controlled-no-provider';
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-10T01:00:00Z')});t.after(()=>t.mock.timers.reset());
 const x=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,primaryStructure:true,productInventory:true,targetCta:'Contact sales',metricTargets:['播放目标1000','点赞目标20','评论目标5','分享目标5']}),{f,pkg,created,repository}=x;
 // This isolated in-memory store is single-process. Compare and mutate in one
 // synchronous turn so the repair cost-order CAS has the same all-or-nothing
 // behavior as the production store; never relax its capability requirement.
 f.store.supportsAtomicCompareAndSwap=()=>true;
 f.store.compareAndSwap=async(collection,id,expected,data)=>{
  const matches=f.tables[collection]?.filter(row=>row.id===id)??[];
  if(matches.length!==1||!Object.entries(expected).every(([key,value])=>isDeepStrictEqual(matches[0]![key],value)))return false;
  Object.assign(matches[0]!,structuredClone(data));return true;
 };
 const {enterpriseFactContentHash}=await import('../routes/enterprise.js');const profile:any={company:{name:'实际企业',industry:'制造',mainMarkets:'US',founded:'2018',description:'制造企业产品'},products:{categories:'企业产品',priceRange:'',moq:'',certifications:'',highlights:'',items:[{id:'enterprise-product',name:'企业产品',sku:'',category:'工业产品',material:'金属',highlights:'已确认企业产品',certifications:'',moq:''}]},brand:{name:'企业品牌',tone:'专业简洁',style:'',taboos:'不伪造客户',usp:''},knowledge:'',dataGovernance:{aiAccessEnabled:true},factVersion:{id:'fact-v1',revision:1,contentHash:'',confirmedBy:'owner',confirmedAt:'2026-10-01T00:00:00Z'}};profile.factVersion.contentHash=enterpriseFactContentHash(profile);f.tables.tenant_profiles=[{id:'creative-profile',tenant_id:'t',profile}];
 pkg.executionGraphVersion=3;pkg.status='active';pkg.socialContentPackage.publicationTasks[0]!.publishWindow='2026-10-15T10:00:00Z';
 const packageRow=f.tables.social_weekly_operating_packages.find(row=>row.package_id===pkg.packageId&&row.version===pkg.version)!;packageRow.payload=pkg;
 const parent=f.tables.starter_social_content_tasks.find(row=>row.id===created.id)!;parent.weekly_plan_id=pkg.packageId;parent.status='plan_review';parent.run_id='';parent.artifact_count=1;parent.approved_artifact_count=0;
 const authority=(parent.brief as any)._weeklyAuthority;authority.weeklyPackage=structuredClone(pkg);authority.publicationTask=structuredClone(pkg.socialContentPackage.publicationTasks[0]);
 const parentLineage=await resolveSocialContentCostLineage({repository,tenantId:'t',taskId:String(parent.task_id)});
 assert.equal(parentLineage.kind,'original');assert.ok(parentLineage.programId&&parentLineage.originWeek);
 const quota=createContentCreationQuotaService({store:f.store,assertAtomicStore:async()=>{assert.equal(await f.store.supportsAtomicCompareAndSwap?.(),true);},now:()=>new Date('2026-10-10T01:00:00Z'),readReleaseSafety:async()=>({leaseActive:true,inFlight:true,paid:true,unknown:true}),verifyDelivery:async()=>false});
 const quotaScope={tenantId:'t',programId:parentLineage.programId!,weekStart:parentLineage.originWeek!};
 const originalOrder=await quota.reserve(quotaScope,{commandId:'fixture-original-reserve',actorId:'owner',reason:'original_content_start'},{contentId:parentLineage.contentId,entry:'weekly_package',packageId:pkg.packageId,packageVersion:pkg.version});
 assert.equal(originalOrder.order?.contentId,parentLineage.contentId);
 await registerControlledAuthorizedVoice(f,t);
 const artifact=f.tables.starter_social_content_artifacts![0]!;artifact.task_id=String(parent.task_id);artifact.status='changes_requested';artifact.version='v2';const operationId='full-creative-decision',operationRequestHash=socialRequestHash('full-creative-feedback');artifact.last_operation_id=operationId;
 await f.store.create(STARTER_COLLECTIONS.socialContentOperations,{tenant_id:'t',operation_id:operationId,operation:'decide_social_content_artifact',target_id:parent.task_id,request_hash:operationRequestHash,status:'processing'});
 const base=f.task,preparation:WeeklyExecutionTask={...base,taskId:'full-material-preparation',status:'queued',dependsOnTaskIds:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],lease:null,schedule:{...base.schedule,stepKind:'material_preparation'}},material:WeeklyExecutionTask={...base,scope:'content',taskId:'full-material-readiness',status:'queued',dependsOnTaskIds:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],lease:null,schedule:{...base.schedule,stepKind:'material_readiness'}},quality:WeeklyExecutionTask={...base,taskId:'full-creative-quality',status:'succeeded',dependsOnTaskIds:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],lease:null,schedule:{...base.schedule,stepKind:'quality_check',responsibleActor:'content_agent'}},approval:WeeklyExecutionTask={...quality,taskId:'full-creative-approval',status:'blocked',ownBlockingReasons:['independent-hold'],inheritedBlockingTaskIds:[],dependsOnTaskIds:[quality.taskId],schedule:{...quality.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 f.tables.social_weekly_execution_tasks=[preparation,material,quality,approval].map((payload,index)=>({id:`creative-row-${index}`,tenant_id:'t',program_id:pkg.programId,package_id:pkg.packageId,package_version:pkg.version,task_id:payload.taskId,payload}));
 const parentScope={tenantId:'t',programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:material.publicationTaskId!,contentTaskId:String(parent.task_id)},assessment=await assessWeeklyOwnedProductIdentity(f.store,parentScope,{repository});assert.equal(assessment.requirements.length,1);const requirement=assessment.requirements[0]!,inventory=await repository.materialLibrary!('t'),image=inventory.items.find(item=>requirement.imageIds.includes(item.id));assert.ok(image?.url);const bytes=await readFile(path.resolve('data',image.url.replace(/^\//,''))),recordId='material0000003',sha=String(image.contentSha256),sourceRef=`socialmaterial:${Buffer.from(`pb-${recordId}`).toString('base64url')}`,materialPorts={getMaterial:async(tenant:string,id:string)=>tenant==='t'&&id===recordId?{id:recordId,tenantId:'t',scope:'own',type:'image',sha256:sha,sizeBytes:bytes.length,videoFile:'identity.png',sourceType:'licensed_upload'}:null,materialBytes:{fetch:async()=>new Response(bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}})}},ports={materialLibrary:repository.materialLibrary,materialPorts,getMaterial:async(id:string,tenant:string)=>materialPorts.getMaterial(tenant,id),sourceOptions:{resolve:async()=>({optionId:'creative-option',kind:'material' as const,sourceRef,sourceVersion:sha,label:'已核验产品',type:'image' as const,thumbnailHref:null}),list:async()=>({items:[],totalItems:0,totalPages:0,page:1,perPage:20,status:'ready' as const})}};
 const requests=createWeeklyMaterialRequestService(f.store,materialPorts),request=await requests.create({tenantId:'t',programId:pkg.programId,requirementKey:requirement.requirementId,requirements:requirement.description,assigneeUserId:'owner',reviewerUserId:'owner',dueAt:'2026-10-11T08:00:00Z',verificationDueAt:'2026-10-11T09:00:00Z',timeZone:'Asia/Shanghai',consumers:[{taskId:material.taskId,packageId:pkg.packageId,packageVersion:pkg.version,requirement:`${requirement.requirementId}：${requirement.description}`}],actorUserId:'owner'});await requests.submit({tenantId:'t',programId:pkg.programId,requestId:request.requestId,actorUserId:'owner',materialRecordIds:[recordId],expectedSubmissionVersion:0});await requests.review({tenantId:'t',programId:pkg.programId,requestId:request.requestId,actorUserId:'owner',submissionVersion:1,consumerDecisions:[{taskId:material.taskId,accepted:true,factCheck:'产品身份一致',rightsCheck:'商业使用权已确认',visualCheck:'外观满足镜头要求'}]});await bindWeeklyOwnedProductIdentity(f.store,parentScope,{actorUserId:'owner',expectedTaskVersion:assessment.contentTaskVersion,expectedRequirementHash:assessment.requirementHash,bindings:[{requirementId:requirement.requirementId,requestId:request.requestId}]},{...ports,repository});preparation.status='succeeded';material.status='succeeded';parent.status='asset_review';
 const clock=()=>new Date('2026-10-10T01:00:00Z'),cases=createWeeklyProductionRepairCaseService(f.store,clock),repair=await cases.createCreativeFromDecision({tenantId:'t',actorUserId:'owner',taskId:String(parent.task_id),artifactId:String(artifact.artifact_id),operationId,operationRequestHash,note:'CTA改成预约工厂打样'});
 const configuration=await createWeeklyCreativeRepairConfigurationService(f.store,clock).configure('t','owner',repair.caseId,{expectedCaseHash:repair.recordHash,revisionScope:'只修改CTA分镜和配音，保留产品事实',estimatedDurationMinutes:30,maximumCostCny:6,deadlineAt:'2026-10-14T10:00:00Z'});
 const port=createWeeklyCreativeRepairProductionPort(f.store,clock,ports),service=createWeeklyCreativeRepairExecutionService(f.store,port,clock),preview=await service.previewCapacity('t','owner',repair.caseId),current=await cases.read('t',repair.caseId),ready=await service.confirmCapacity('t','owner',repair.caseId,{expectedCaseRecordHash:current.recordHash,expectedConfigurationHash:configuration.recordHash,expectedPreviewHash:preview.previewHash,expectedAuthorityHash:preview.authorityHash,expectedQuoteHash:preview.quoteHash!,authorizedMaximumCostCny:6});
 const running=await service.start('t','owner',repair.caseId,{expectedCaseRecordHash:ready.recordHash});assert.equal(running.state,'running');assert.ok(running.execution);
 const afterRevision=await quota.read(quotaScope);assert.equal(afterRevision?.slots.filter(slot=>slot.contentId!==null).length,1);assert.equal(afterRevision?.orders[parentLineage.contentId]?.revisions?.length,1);
 const child=f.tables.starter_social_content_tasks.find(row=>String(row.create_idempotency_key).startsWith('weekly-creative-repair:'));assert.ok(child);const repairGraph=f.tables.social_weekly_execution_tasks.filter(row=>String((row.payload as any).inputSnapshot?.creativeRepairExecution?.caseId??'')===repair.caseId);assert.deepEqual(repairGraph.map(row=>(row.payload as WeeklyExecutionTask).schedule.stepKind),['material_preparation','script','storyboard','material_readiness','asset_generation']);assert.equal(new Set(repairGraph.map(row=>row.task_id)).size,5);const {ensureWeeklyCreativeRepairExecutionGraph}=await import('./weeklyCreativeRepairExecutionGraph.js');await ensureWeeklyCreativeRepairExecutionGraph({store:f.store,tenantId:'t',childTaskId:String(child.task_id),proof:(child.brief as any)._weeklyCreativeRepairProof,configurationHash:configuration.recordHash,authorityHash:preview.authorityHash,now:clock()});assert.equal(f.tables.social_weekly_execution_tasks.filter(row=>String((row.payload as any).inputSnapshot?.creativeRepairExecution?.caseId??'')===repair.caseId).length,5);const detail=await readSocialTaskDetail({repository,tenantId:'t',taskId:String(child.task_id)});assert.ok(detail?.referenceVideoAnalysis);assert.notEqual(detail.referenceVideoAnalysis.status,'analyzing');assert.equal(detail.sources.filter(item=>item.kind==='material'&&item.sourceRef===sourceRef&&item.sourceVersion===sha&&item.status==='active').length,1);assert.ok(child.run_id);assert.equal(detail.agentWorkflow?.executionPlanReview.approved,true);const jobs=f.tables.content_execution_jobs?.filter(row=>row.task_id===child.task_id&&row.run_id===child.run_id)??[];assert.equal(jobs.length,1);assert.equal(jobs[0]!.status,'queued');t.mock.timers.setTime(Math.max(...repairGraph.map(row=>Date.parse((row.payload as WeeklyExecutionTask).schedule.estimatedStartAt!)))+1);const {createSocialWeeklyExecutionWorker}=await import('./socialWeeklyExecutionWorker.js'),weeklyWorker=createSocialWeeklyExecutionWorker(f.store),claim=await weeklyWorker.claimNext({tenantId:'t',workerId:'creative-repair-stage-worker',now:new Date()});assert.equal(claim?.task.schedule.stepKind,'material_preparation');assert.ok(claim);const {createSocialWeeklyProductionAdapter}=await import('./socialWeeklyProductionAdapter.js'),stageAdapter=createSocialWeeklyProductionAdapter(f.store,{repository,ownedProductIdentity:ports,sourceOptions:ports.sourceOptions,now:()=>new Date()}),stageOutput=await stageAdapter.execute(claim.task);assert.equal(stageOutput.status,'succeeded',JSON.stringify(stageOutput));if(stageOutput.status!=='succeeded')throw Error('creative repair preparation missing');await weeklyWorker.complete(claim,stageOutput.resultRefs,new Date());assert.equal(f.tables.social_weekly_creative_repair_stage_evidence?.length,1);
 const {DurableContentExecutionWorker,readContentExecutionJob}=await import('../contentExecution/durableQueue.js'),{runSocialContentAutoProduction}=await import('../starter198/socialContentProductionExecution.js');let forbiddenSuppliers=0;const preSupplyWorker=new DurableContentExecutionWorker({dataStore:f.store,execute:job=>runSocialContentAutoProduction({repository,tenantId:job.tenantId,userId:job.userId,taskId:job.taskId,runId:job.runId,materialEvidencePorts:{...ports,repository},runtime:{synthesizeVoice:async()=>{forbiddenSuppliers++;throw Error('supplier before asset authorization');},renderComposite:async()=>{forbiddenSuppliers++;throw Error('render before asset authorization');}}}),env:{CONTENT_EXECUTION_TENANT_CONCURRENCY:'1'}});await preSupplyWorker.drain();for(let attempt=0;attempt<500&&preSupplyWorker.isLocallyActive('t',String(child.task_id));attempt++)await new Promise(resolve=>setTimeout(resolve,10));const paused=await readContentExecutionJob(f.store,'t',String(child.task_id),String(child.run_id));assert.equal(paused?.status,'paused',JSON.stringify(paused));assert.equal(paused?.id,jobs[0]!.id);assert.equal(forbiddenSuppliers,0);const {readWeeklyPreSupplyHandoff}=await import('../starter198/socialWeeklyPreSupplyHandoff.js');const actualHandoff=await readWeeklyPreSupplyHandoff(repository,'t',String(child.task_id));assert.ok(actualHandoff);
 // This is a real durable content run and a verified reader result. It proves
 // the v2+ stage-ref contract, not that the golden week's missing product
 // videos or external presenter have become available.
 const {weeklyStoryboardStageEvidence}=await import('./socialWeeklyStoryboardEvidence.js');
 const liveChild=await repository.get(STARTER_COLLECTIONS.socialContentTasks,'t',String(child.id));assert.ok(liveChild);
 assert.equal(actualHandoff.taskId,child.task_id);assert.equal(actualHandoff.runId,child.run_id);
 assert.equal(actualHandoff.programId,pkg.programId);assert.equal(actualHandoff.packageId,pkg.packageId);assert.equal(actualHandoff.packageVersion,pkg.version);
 assert.equal(actualHandoff.publicationTaskId,pkg.socialContentPackage.publicationTasks[0]!.publicationTaskId);
 assert.deepEqual(weeklyStoryboardStageEvidence(liveChild,[],2,actualHandoff),{type:'starter_weekly_pre_supply_handoff',id:child.run_id,version:1});
 assert.equal(weeklyStoryboardStageEvidence(liveChild,[],2,null),null,'missing handoff cannot settle a v2+ storyboard');
 assert.equal(weeklyStoryboardStageEvidence(liveChild,[],2,{...actualHandoff,runId:'another-run'}),null,'another run cannot settle the current storyboard');
 assert.equal(weeklyStoryboardStageEvidence(liveChild,[],2,{...actualHandoff,taskId:'another-task'}),null,'another task cannot settle the current storyboard');
 const durableRun=f.tables.workflow_runs!.find(row=>row.id===child.run_id);assert.ok(durableRun);
 const savedContext=structuredClone(durableRun.starter_context);
 try{
  durableRun.starter_context={...(savedContext as object),weeklyPreSupplyHandoff:{...actualHandoff,runId:'another-run'}};
  await assert.rejects(readWeeklyPreSupplyHandoff(repository,'t',String(child.task_id)),{code:'weekly_pre_supply_handoff_unverified'},'reader rejects a changed durable run binding');
  durableRun.starter_context={...(savedContext as object),weeklyPreSupplyHandoff:null};
  assert.equal(await readWeeklyPreSupplyHandoff(repository,'t',String(child.task_id)),null,'reader cannot infer a missing receipt from a plan');
 }finally{durableRun.starter_context=savedContext;}
 assert.equal((await readWeeklyPreSupplyHandoff(repository,'t',String(child.task_id)))?.recordHash,actualHandoff.recordHash);
 for(const step of ['script','storyboard','material_readiness'] as const){const next=await weeklyWorker.claimNext({tenantId:'t',workerId:`creative-repair-${step}`,now:new Date()});assert.equal(next?.task.schedule.stepKind,step);assert.ok(next);const output=await stageAdapter.execute(next.task);assert.equal(output.status,'succeeded',JSON.stringify(output));if(output.status!=='succeeded')throw Error(`creative repair ${step} missing`);await weeklyWorker.complete(next,output.resultRefs,new Date());}
 const assetClaim=await weeklyWorker.claimNext({tenantId:'t',workerId:'creative-repair-assets',now:new Date()});assert.equal(assetClaim?.task.schedule.stepKind,'asset_generation');assert.ok(assetClaim);const assetPending=await stageAdapter.execute(assetClaim.task);assert.equal(assetPending.status,'pending',JSON.stringify(assetPending));const resumed=await readContentExecutionJob(f.store,'t',String(child.task_id),String(child.run_id));assert.equal(resumed?.id,jobs[0]!.id);assert.equal(resumed?.status,'queued',JSON.stringify(resumed));assert.equal(f.tables.content_execution_jobs?.filter(row=>row.task_id===child.task_id&&row.run_id===child.run_id).length,1);
 // The controlled issuer proves only that the private presenter and default voice were registered.
 // It cannot supply a real HeyGen TTS credential or provider receipt. Assert the legal stop.
 const productionWorker=new DurableContentExecutionWorker({dataStore:f.store,execute:job=>runSocialContentAutoProduction({repository,tenantId:job.tenantId,userId:job.userId,taskId:job.taskId,runId:job.runId,materialEvidencePorts:{...ports,repository}}),env:{CONTENT_EXECUTION_TENANT_CONCURRENCY:'1'}});
 await productionWorker.drain();
 for(let attempt=0;attempt<500&&productionWorker.isLocallyActive('t',String(child.task_id));attempt++)await new Promise(resolve=>setTimeout(resolve,10));
 const stopped=await readContentExecutionJob(f.store,'t',String(child.task_id),String(child.run_id));
 assert.equal(stopped?.id,jobs[0]!.id);
 assert.equal(stopped?.status,'retry_wait',JSON.stringify(stopped));
 assert.equal(stopped?.lastError,'selected_presenter_heygen_voice_unavailable');
 assert.equal(externalAttempts,0,'isolated test must make zero external provider requests');
 assert.equal(f.tables.starter_social_content_artifacts.filter(row=>row.task_id===child.task_id).length,0);


});
