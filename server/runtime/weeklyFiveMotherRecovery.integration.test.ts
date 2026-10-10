import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {prepareWeeklyNonPresenterProductionFixture} from './weeklyNonPresenterProduction.fixture.js';
import {prepareFiveMotherProductionFixture} from './weeklyFiveMotherProduction.fixture.js';
import {createSocialWeeklyProductionAdapter} from './socialWeeklyProductionAdapter.js';
import {createSocialWeeklyExecutionWorker} from './socialWeeklyExecutionWorker.js';
import {createSocialWeeklyPlanningAdapter,WEEKLY_PREPRODUCTION_STEPS} from './socialWeeklyExecutionRuntime.js';
import {createWeeklyMaterialRequestService} from '../socialPrograms/weeklyMaterialRequests.js';
import {createWeeklyRequiredMaterialAdmission} from '../socialPrograms/weeklyRequiredMaterialAdmission.js';
import {recheckWeeklyRequiredMaterials} from '../socialPrograms/weeklyRequiredMaterialRecovery.js';
import {dispatchFiveMotherWeek,scheduleFiveMotherNextWeek} from './weeklyFiveMotherNextWeek.fixture.js';
import {listWeeklyExecutionTasks} from '../socialPrograms/executionTasks.js';
import {getWeeklyExecutionTaskRow} from '../socialPrograms/executionTasks.js';

// Formal planning and durable task settlement only. This test intentionally stops
// at a real recovered worker claim; it does not represent production as complete.
test('five formal consumers share one physical upload; scheduled V+1 recovers while V and duplicate recovery cannot start another run',async t=>{
 const seed=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,productInventory:true,primaryStructure:true,metricTargets:['播放目标1000','点赞目标20','评论目标5','分享目标5']});
 const f=await prepareFiveMotherProductionFixture(t,seed,{consumerRequirement:async({setup,tasks,pkg})=>{
  const adapter=createSocialWeeklyProductionAdapter(setup.f.store,{repository:setup.repository});const descriptors:Record<string,string>={};
  for(const task of tasks.filter(task=>task.schedule.stepKind==='material_preparation')){
   const output=await adapter.execute(task);assert.equal(output.status,'blocked');
   const created=setup.f.tables.starter_social_content_tasks!.find(row=>row.create_idempotency_key===`weekly-production:${pkg.packageId}:${pkg.version}:${task.publicationTaskId}`);assert.ok(created);
   const {assessWeeklyOwnedProductIdentity}=await import('./weeklyOwnedProductIdentityDemand.js');const assessment=await assessWeeklyOwnedProductIdentity(setup.f.store,{tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:task.publicationTaskId!,contentTaskId:String(created.task_id)},{repository:setup.repository});
   assert.equal(assessment.requirements.length,1);descriptors[task.publicationTaskId!]=`${assessment.requirements[0]!.requirementId}：${assessment.requirements[0]!.description}`;
  }return descriptors;
 }});
 const consumers=f.request.consumers.filter(c=>c.packageVersion===f.pkg.version);assert.equal(consumers.length,5);assert.equal(f.pkg.version,f.originalPkg.version+1);
 for(const consumer of consumers){assert.equal(consumer.packageId,f.pkg.packageId);assert.match(consumer.requirement,/：/);}
 assert.ok(f.repository.materialLibrary);const library=await f.repository.materialLibrary('t'),product=library.items.find(item=>item.id==='actual-owned-product-identity');assert.ok(product);assert.equal(typeof product.url,'string');const bytes=await readFile(path.resolve('data',product.url!.replace(/^\//,''))),sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,product.contentSha256);
 const raw={id:'material0000009',tenantId:'t',scope:'own',type:'image',sha256,sizeBytes:bytes.length,videoFile:'shared-product.png',sourceType:'licensed_upload'};
 const ports={getMaterial:async(tenant:string,id:string)=>tenant==='t'&&id===raw.id?raw:null,materialBytes:{fetch:async()=>new Response(bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}})}};
 const sourceRef=`socialmaterial:${Buffer.from(`pb-${raw.id}`).toString('base64url')}`,sourceOptions={resolve:async()=>({optionId:'recovery-upload',kind:'material' as const,sourceRef,sourceVersion:sha256,label:'已核验共享产品图',type:'image' as const,thumbnailHref:null}),list:async()=>({items:[],totalItems:0,totalPages:0,page:1,perPage:20,status:'ready' as const})},identityPorts={repository:f.repository,materialPorts:ports,getMaterial:async(id:string,tenant:string)=>ports.getMaterial(tenant,id),sourceOptions};
 const service=createWeeklyMaterialRequestService(f.f.store,ports),adapter=createSocialWeeklyProductionAdapter(f.f.store,{repository:f.repository,materialAdmission:createWeeklyRequiredMaterialAdmission(f.f.store,ports),materialRecord:identityPorts.getMaterial,sourceOptions,ownedProductIdentity:identityPorts}),planning=createSocialWeeklyPlanningAdapter(f.f.store),worker=createSocialWeeklyExecutionWorker(f.f.store,{ownedProductIdentity:identityPorts});
 const now=new Date(Math.max(Date.now(),...f.tasks.map(task=>Date.parse(task.schedule.estimatedStartAt!)))+1);t.mock.timers.enable({apis:['Date'],now:now.getTime()});t.after(()=>t.mock.timers.reset());
 const blocked:string[]=[];
 for(let i=0;i<40;i++){
  const claim=await worker.claimNext({tenantId:'t',workerId:'shared-recovery-worker',now});if(!claim)break;
  const output=await (WEEKLY_PREPRODUCTION_STEPS.includes(claim.task.schedule.stepKind)?planning:adapter).execute(claim.task);
  if(output.status==='succeeded'){await worker.complete(claim,output.resultRefs,now);continue;}
  assert.equal(output.status,'blocked');if(output.status!=='blocked')throw Error('unexpected real adapter state');assert.equal(output.code,'weekly_required_materials_missing');
  await worker.defer(claim,{code:output.code,message:output.message,blockingReason:output.code,now});if(claim.task.packageVersion===f.pkg.version)blocked.push(claim.task.taskId);
 }
 assert.ok(blocked.length>0,'real worker must persist a current shared-material blocker');
 const counts=()=>({runs:f.f.tables.workflow_runs?.length??0,jobs:f.f.tables.content_execution_jobs?.length??0,artifacts:f.f.tables.starter_social_content_artifacts?.length??0});const before=counts();
 await service.submit({tenantId:'t',programId:'p',requestId:f.request.requestId,actorUserId:'owner',materialRecordIds:[raw.id],expectedSubmissionVersion:0});
 const submitted=await service.get('t','p',f.request.requestId,'owner');assert.equal(submitted.submissions.length,1);assert.equal(submitted.submissions[0]!.materials.length,1);assert.equal(submitted.submissions[0]!.materials[0]!.sha256,sha256);
 // The physical evidence alone must not approve any of the five consumers.
 for(const c of consumers)assert.equal(await service.acceptedForConsumer({tenantId:'t',programId:'p',requestId:f.request.requestId,consumerTaskId:c.taskId}),null);
 await service.review({tenantId:'t',programId:'p',requestId:f.request.requestId,actorUserId:'owner',submissionVersion:1,consumerDecisions:submitted.consumers.map(c=>({taskId:c.taskId,accepted:true,factCheck:'受控图片身份核验',rightsCheck:'受控本地图片授权',visualCheck:'受控PNG实际字节核验'}))});
 for(const c of consumers){const receipt=await service.acceptedForConsumer({tenantId:'t',programId:'p',requestId:f.request.requestId,consumerTaskId:c.taskId});assert.ok(receipt);assert.deepEqual(receipt.consumer,c);assert.equal(receipt.submissionVersion,1);assert.equal(receipt.materials.length,1);}
 for(const taskId of blocked){const scope={tenantId:'t',programId:'p',packageId:f.pkg.packageId,packageVersion:f.pkg.version,taskId};const held=structuredClone((await getWeeklyExecutionTaskRow(f.f.store,'t',taskId)).payload);
  await assert.rejects(recheckWeeklyRequiredMaterials(f.f.store,{...scope,packageVersion:f.originalPkg.version},ports));
  await assert.rejects(recheckWeeklyRequiredMaterials(f.f.store,{...scope,tenantId:'foreign'},ports));assert.deepEqual((await getWeeklyExecutionTaskRow(f.f.store,'t',taskId)).payload,held);
  await recheckWeeklyRequiredMaterials(f.f.store,scope,ports);await assert.rejects(recheckWeeklyRequiredMaterials(f.f.store,scope,ports),{code:'weekly_material_recovery_task_changed'});
 }
 assert.deepEqual(counts(),before);const claim=await worker.claimNext({tenantId:'t',workerId:'recovered-original-worker',now});assert.ok(claim);assert.equal(claim.task.packageVersion,f.pkg.version);assert.ok(blocked.includes(claim.task.taskId));assert.deepEqual(counts(),before);
 await worker.defer(claim,{code:'controlled_recovery_evidence_complete',message:'验证止于原任务重新领取；未制造运行或生产完成',blockingReason:'controlled_recovery_evidence_complete',now});
 const publications=f.pkg.socialContentPackage.publicationTasks.map((publication,index)=>({...publication,publicationTaskId:`next-week-${index+1}`,motherContentId:`next-mother-${index+1}`,publishWindow:`2026-10-${21+index}T10:00:00Z`,receptionRequirement:undefined}));
 t.mock.timers.setTime(Date.parse('2026-10-17T01:00:00Z'));
 let next=await f.packages.create('t','owner','p',{weekStart:'2026-10-19',objective:f.pkg.objective,perItemBudgetCny:1,successCriteria:f.pkg.successCriteria,enterpriseProfileRef:f.pkg.enterpriseProfileRef,businessContentGoalRef:f.pkg.businessContentGoalRef,capacityPlanRef:f.pkg.capacityPlanRef,automationPolicyRef:f.pkg.automationPolicyRef,referenceSourcePolicy:f.pkg.referenceSourcePolicy,publicationTasks:publications});
 const initialNextTasks=await dispatchFiveMotherWeek(f.f.store,next,'2026-10-17T01:00:00Z'),descriptors:Record<string,string>={};
 for(const preparation of initialNextTasks.filter(task=>task.schedule.stepKind==='material_preparation')){await adapter.execute(preparation);const created=f.f.tables.starter_social_content_tasks!.find(row=>row.create_idempotency_key===`weekly-production:${next.packageId}:${next.version}:${preparation.publicationTaskId}`);assert.ok(created);const {assessWeeklyOwnedProductIdentity}=await import('./weeklyOwnedProductIdentityDemand.js');const assessment=await assessWeeklyOwnedProductIdentity(f.f.store,{tenantId:'t',programId:'p',packageId:next.packageId,packageVersion:next.version,publicationTaskId:preparation.publicationTaskId!,contentTaskId:String(created.task_id)},{repository:f.repository});assert.equal(assessment.requirements.length,1);descriptors[preparation.publicationTaskId!]=`${assessment.requirements[0]!.requirementId}：${assessment.requirements[0]!.description}`;}
 await service.revise({tenantId:'t',programId:'p',requestId:f.request.requestId,actorUserId:'owner',reason:'下一周冻结前加入精确消费者',addConsumers:initialNextTasks.filter(task=>task.schedule.stepKind==='material_readiness').map(task=>({taskId:task.taskId,packageId:next.packageId,packageVersion:next.version,requirement:descriptors[task.publicationTaskId!]!}))});
 const scheduled=await scheduleFiveMotherNextWeek(f.f.store,next,'2026-10-17T01:00:00Z',ports);next=scheduled.pkg;const nextTasks=scheduled.tasks;
 const expected=await service.get('t','p',f.request.requestId,'owner'),nextConsumers=expected.consumers.filter(consumer=>consumer.packageId===next.packageId&&consumer.packageVersion===next.version);assert.equal(nextConsumers.length,5);
 for(const consumer of nextConsumers){assert.equal(consumer.requirement,descriptors[nextTasks.find(task=>task.taskId===consumer.taskId)!.publicationTaskId!]!);assert.equal(await service.acceptedForConsumer({tenantId:'t',programId:'p',requestId:f.request.requestId,consumerTaskId:consumer.taskId}),null);}
 next=await f.packages.activate('t','owner','p',next.packageId,{expectedVersion:next.version,expectedProgramVersion:2,authorizePublishing:true});
 const nextNow=new Date(Math.max(now.getTime(),...nextTasks.map(task=>Date.parse(task.schedule.estimatedStartAt!)))+1);t.mock.timers.setTime(nextNow.getTime());
 const nextBlocked:string[]=[];for(let i=0;i<40;i++){const item=await worker.claimNext({tenantId:'t',workerId:'next-week-recovery-worker',now:nextNow});if(!item)break;const output=await(WEEKLY_PREPRODUCTION_STEPS.includes(item.task.schedule.stepKind)?planning:adapter).execute(item.task);if(output.status==='succeeded'){await worker.complete(item,output.resultRefs,nextNow);continue;}assert.equal(output.status,'blocked');if(output.status!=='blocked')throw Error('unexpected next-week state');await worker.defer(item,{code:output.code,message:output.message,blockingReason:output.code,now:nextNow});if(item.task.packageId===next.packageId){assert.equal(output.code,'weekly_required_materials_missing');nextBlocked.push(item.task.taskId);}}
 assert.ok(nextBlocked.length,JSON.stringify((await listWeeklyExecutionTasks(f.f.store,'t','p',next.packageId,next.version)).map(task=>({step:task.schedule.stepKind,status:task.status,why:task.ownBlockingReasons,start:task.schedule.estimatedStartAt,}))));const revised=await service.get('t','p',f.request.requestId,'owner');assert.equal(revised.submissions.length,1);assert.equal(revised.submissions[0]!.version,1);await service.review({tenantId:'t',programId:'p',requestId:f.request.requestId,actorUserId:'owner',submissionVersion:1,consumerDecisions:revised.consumers.map(c=>({taskId:c.taskId,accepted:true,factCheck:'下一周真实产品身份仍有效',rightsCheck:'下一周授权重新确认',visualCheck:'同一已上传PNG核验'}))});
 for(const taskId of nextBlocked){const scope={tenantId:'t',programId:'p',packageId:next.packageId,packageVersion:next.version,taskId};const previous=structuredClone((await getWeeklyExecutionTaskRow(f.f.store,'t',taskId)).payload);await assert.rejects(recheckWeeklyRequiredMaterials(f.f.store,{...scope,packageId:f.pkg.packageId,packageVersion:f.pkg.version},ports));await assert.rejects(recheckWeeklyRequiredMaterials(f.f.store,{...scope,packageVersion:1},ports));assert.deepEqual((await getWeeklyExecutionTaskRow(f.f.store,'t',taskId)).payload,previous);await recheckWeeklyRequiredMaterials(f.f.store,scope,ports);await assert.rejects(recheckWeeklyRequiredMaterials(f.f.store,scope,ports));}
 const resumed=await worker.claimNext({tenantId:'t',workerId:'next-week-recovered-original',now:nextNow});assert.ok(resumed);assert.equal(resumed.task.packageId,next.packageId);assert.ok(nextBlocked.includes(resumed.task.taskId));let resumedResult=await adapter.execute(resumed.task);
 if(resumedResult.status==='blocked'&&resumedResult.code==='weekly_owned_product_identity_verification_required'){
  const created=f.f.tables.starter_social_content_tasks!.find(row=>row.create_idempotency_key===`weekly-production:${next.packageId}:${next.version}:${resumed.task.publicationTaskId}`);assert.ok(created);const scope={tenantId:'t',programId:'p',packageId:next.packageId,packageVersion:next.version,publicationTaskId:resumed.task.publicationTaskId!,contentTaskId:String(created.task_id)};const {assessWeeklyOwnedProductIdentity,bindWeeklyOwnedProductIdentity}=await import('./weeklyOwnedProductIdentityDemand.js');const assessment=await assessWeeklyOwnedProductIdentity(f.f.store,scope,identityPorts);await bindWeeklyOwnedProductIdentity(f.f.store,scope,{actorUserId:'owner',expectedTaskVersion:assessment.contentTaskVersion,expectedRequirementHash:assessment.requirementHash,bindings:assessment.requirements.map(requirement=>({requirementId:requirement.requirementId,requestId:f.request.requestId}))},identityPorts);resumedResult=await adapter.execute(resumed.task);
 }
 assert.equal(resumedResult.status,'succeeded',JSON.stringify(resumedResult));if(resumedResult.status!=='succeeded')throw Error('recovered original adapter did not admit actual material');await worker.complete(resumed,resumedResult.resultRefs,nextNow);
 assert.deepEqual(counts(),before);for(const c of nextConsumers){const receipt=await service.acceptedForConsumer({tenantId:'t',programId:'p',requestId:f.request.requestId,consumerTaskId:c.taskId});assert.ok(receipt);assert.deepEqual(receipt.consumer,c);assert.equal(receipt.materials[0]!.sha256,sha256);}
 console.log('FIVE_RECOVERY_EVIDENCE',JSON.stringify({packageId:f.pkg.packageId,oldVersion:f.originalPkg.version,currentVersion:f.pkg.version,consumers:consumers.length,physicalUploads:1,submissionVersion:1,recovered:blocked.length,nextWeekPackage:next.packageId,nextWeekVersion:next.version,nextWeekConsumers:nextConsumers.length,nextWeekRecovered:nextBlocked.length,before,after:counts()}));
});
