import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createTikTokWeeklyPublishingAdapter} from '../publishing/tiktokWeeklyPublishingAdapter.js';
import {verifySocialWeeklyG6Receipt} from '../starter198/socialWeeklyG6ReviewService.js';
import {parseSocialProductionReceiptRecord} from '../starter198/socialContentProductionHandoff.js';
import type {StarterRecord} from '../starter198/repository.js';
import {checkPublicationReceptionAdmission} from '../socialPrograms/publicationReceptionService.js';
import test,{type TestContext} from 'node:test';
import {refreshPlatformCapabilityEvidence} from '../publishing/platformCapabilities.js';
import assert from 'node:assert/strict';
import {prepareWeeklyG6Fixture} from '../starter198/socialWeeklyG6ReviewService.fixture.js';
import {createSocialWeeklyProductionAdapter} from './socialWeeklyProductionAdapter.js';
import {createWeeklyExecutionTaskService} from '../socialPrograms/executionTasks.js';
import {validateContentArtifact} from './socialWeeklyResultValidation.js';
import {runWeeklyPublicationPackageScan} from '../publishing/weeklyPublicationWorker.js';
import {readStarterPublicationPackage} from '../publishing/starterPublicationPackage.js';
import {assertWeeklyPublicationG6Admission} from './weeklyPublicationG6Admission.js';
import {createSocialWeeklyPublicationAdapter} from './socialWeeklyPublicationAdapter.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {reconcileWeeklyPublication,type StoredPublicationAssignment} from '../publishing/weeklyLineage.js';

async function prepareDefaultPublication(t:TestContext){
 const originalNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='test';t.after(()=>{if(originalNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=originalNodeEnv;});
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-02T12:00:00Z')});
 const f=await prepareWeeklyG6Fixture({registeredOwnedMedia:true});t.after(f.cleanup);
 f.pkg.workflowTasks.push({taskId:'actual-publishing-workflow',kind:'publishing',taskRef:{type:'weekly_workflow_task',id:'actual-publishing-workflow',version:1},dependsOnTaskIds:['content-workflow'],subjectRefs:[{type:'weekly_publication_task',id:'pub',version:1}],status:'planned',ownBlockingReasons:[],inheritedBlockingTaskIds:[],carriedFromTaskId:null});
 const preflight=await f.service.context(f.scope,'owner');assert.deepEqual(preflight.gaps,[]);
 const checked=await f.service.check(f.scope,'owner',{programId:f.scope.programId,packageId:f.scope.packageId,packageVersion:f.scope.packageVersion,publicationTaskId:f.scope.publicationTaskId,requestId:'g6-complete-consumer-0001',expectedContextHash:preflight.contextHash});
 assert.ok(checked.item);const checkedItem=checked.item;assert.equal(checkedItem.status,'passed');
 const result=await createSocialWeeklyProductionAdapter(f.store,{start:async()=>{throw Error('no production start');},create:async()=>{throw Error('no duplicate content');}}).execute(f.task);
 assert.equal(result.status,'succeeded',JSON.stringify(result));
 await validateContentArtifact(f.store,f.task,f.ref);
 assert.equal(f.tables.starter_social_content_lineage!.length,1);
 const dependency:WeeklyExecutionTask={...f.task,taskId:'actual-quality-completed',status:'succeeded',dependsOnTaskIds:[],inheritedBlockingTaskIds:[],ownBlockingReasons:[],resultRefs:[f.ref],inputSnapshot:{}};
 const approval:WeeklyExecutionTask={...dependency,taskId:'actual-final-human-approval',status:'blocked',dependsOnTaskIds:[dependency.taskId],resultRefs:[],schedule:{...dependency.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 const row=(task:WeeklyExecutionTask)=>({id:task.taskId,tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,payload:task});
 f.tables.social_weekly_execution_tasks=[row(dependency),row(approval)];f.tables.starter_social_content_tasks![0]!.weekly_plan_id=f.pkg.packageId;
 await createWeeklyExecutionTaskService(f.store).approve('t','p','week1',approval.taskId,'owner');
 assert.equal(f.artifact.status,'approved');assert.equal(f.artifact.version,'2');
 const scan=await runWeeklyPublicationPackageScan({dataStore:f.store,tenantId:'t',taskId:'content'});assert.deepEqual(scan.errors,[]);assert.equal(scan.createdAssignments,1);
 const assignments=await f.store.list<StoredPublicationAssignment>('social_publication_assignments',{where:{tenant_id:'t',operating_package_id:f.pkg.packageId,operating_package_version:f.pkg.version,publication_task_id:f.scope.publicationTaskId},perPage:2});assert.equal(assignments.totalItems,1);const assignment=assignments.items[0]!;
 const publicationPackage=await readStarterPublicationPackage('t',assignment.package_id,f.store);assert.ok(publicationPackage);
 const publishing:WeeklyExecutionTask={...dependency,taskId:'actual-weekly-publishing',workflowKind:'publishing',status:'queued',dependsOnTaskIds:[approval.taskId],resultRefs:[],schedule:{...dependency.schedule,stepKind:'publishing',responsibleActor:'publishing_agent'}};
 f.tables.social_weekly_execution_tasks.push(row(publishing));
 const raw=f.tables.starter_social_production_receipts!.find(row=>row.receipt_id===checkedItem.receiptId)!;
  await verifySocialWeeklyG6Receipt(f.repository,'t',parseSocialProductionReceiptRecord(raw as StarterRecord));
 const proof=await assertWeeklyPublicationG6Admission(f.store,publishing,assignment,publicationPackage);assert.equal(proof.length,1);assert.equal(proof[0]!.sourceHash,preflight.sourceHash);
 await checkPublicationReceptionAdmission({dataStore:f.store,scope:{tenantId:'t',programId:'p',packageId:'week1',packageVersion:1,publicationId:'pub'},cta:f.pkg.socialContentPackage.publicationTasks[0]!.cta??'',required:true,bindingId:f.pkg.socialContentPackage.publicationTasks[0]!.receptionRequirement!.bindingId});
 const ownedVideo=(f.artifact.content as Record<string,any>).mediaStorage.video;
 const ownedRow=f.tables.starter_social_content_files!.find(r=>r.file_id===ownedVideo.fileId)!;
 assert.ok(ownedRow.last_operation_id,'owned-file id must come from actual registerSocialContentFile mutation');assert.equal(ownedRow.content_sha256,ownedVideo.sha256);assert.equal(ownedVideo.fileRef,f.artifact.resource_ref);assert.match(ownedRow.file_id as string,/^socialfile_[a-f0-9]{24}$/);
 return {f,preflight,assignment,publicationPackage,publishing};
}

test('default TikTok provider consumes actual false-summary G4/G5/G6 media through real source claim before one controlled terminal publish',async t=>{
 const {f,assignment,publicationPackage,publishing}=await prepareDefaultPublication(t);
 let posts=0;
 const defaultProvider=await createTikTokWeeklyPublishingAdapter({tenantId:assignment.tenant_id,accountId:assignment.account_id,dataStore:f.store,now:new Date(),ports:{
  async publish(input){posts++;assert.equal(input.tenantId,'t');assert.equal(input.accountId,'account');assert.equal(input.platform,'tiktok');assert.equal(input.contentId,publicationPackage.contentId);assert.ok(input.publishAttemptId);assert.ok(input.sourceClaim);assert.equal(input.sourceClaim.sourceKind,'social_production_artifact');assert.equal(input.sourceClaim.artifactId,'artifact');assert.equal(input.sourceClaim.productionResultId,assignment.payload.lineage.productionResultRef.id);assert.equal(input.sourceClaim.contentHash,publicationPackage.contentHash);assert.equal(input.sourceClaim.videoHash,publicationPackage.assets.find(a=>a.kind==='video')!.contentHash);assert.ok(input.videoPath);const actualVideoPath=input.videoPath;const bytes=await readFile(actualVideoPath);assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sourceClaim.videoHash);assert.equal(f.result.technicalReview.approved,false);assert.equal(f.result.creativeReview.approved,false);return {video:{id:'controlled-terminal'},tracking:{id:'controlled-tracking',tenant_id:'t',platform:'tiktok',track_code:'controlled'},publishRecord:null,platformPostId:'controlled-default-tiktok-post',providerReceiptId:'controlled-default-tiktok-receipt',deliveryStatus:'published'};},
  async reconcile(){throw Error('final published receipt must be reused without further supplier calls');}
 }});
 assert.equal(defaultProvider.capability,'available',JSON.stringify(defaultProvider));
 let defaultProviderError='';const actualDefaultPublish=defaultProvider.publish.bind(defaultProvider);defaultProvider.publish=async input=>{try{return await actualDefaultPublish(input);}catch(error){defaultProviderError=error instanceof Error?error.message:String(error);throw error;}};
 const originalTone=f.profile.brand.tone;f.profile.brand.tone='真实调性漂移';
 await assert.rejects(assertWeeklyPublicationG6Admission(f.store,publishing,assignment,publicationPackage));assert.equal(posts,0);f.profile.brand.tone=originalTone;
 const adapter=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>defaultProvider});
 const first=await adapter.execute(publishing);assert.equal(first.status,'succeeded',JSON.stringify({first,posts,defaultProviderError,attempts:f.tables.social_publication_attempts}));assert.equal(posts,1);
 const repeated=await adapter.execute(publishing);assert.equal(repeated.status,'succeeded',JSON.stringify(repeated));assert.equal(posts,1);
 assert.equal(f.tables.social_publication_attempts!.length,1);assert.equal(f.tables.social_publication_assignments!.length,1);
 assert.equal(f.result.technicalReview.approved,false);assert.equal(f.result.creativeReview.approved,false);
});

test('default TikTok original unknown receipt reconciles after withdrawal with no second terminal publish',async t=>{
 const {f,assignment,publicationPackage,publishing}=await prepareDefaultPublication(t);let posts=0,lookups=0;
 const provider=await createTikTokWeeklyPublishingAdapter({tenantId:assignment.tenant_id,accountId:assignment.account_id,dataStore:f.store,now:new Date(),ports:{
 async publish(input){posts++;assert.ok(input.videoPath);const actualVideoPath=input.videoPath;const bytes=await readFile(actualVideoPath);assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sourceClaim!.videoHash);return {video:{},tracking:{id:'controlled-unknown-tracking',tenant_id:'t',platform:'tiktok',track_code:'controlled'},publishRecord:null,platformPostId:'',providerReceiptId:'actual-original-unknown-receipt',deliveryStatus:'provider_accepted'};},
 async reconcile(input){lookups++;assert.equal(input.providerReceiptId,'actual-original-unknown-receipt');assert.equal(input.accountId,assignment.account_id);return {status:'published',providerReceiptId:input.providerReceiptId,platformPostId:'actual-original-resolved-post',platformUrl:'',providerStatus:'PUBLISH_COMPLETE',error:''};}}});
 assert.equal(provider.capability,'available');const adapter=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>provider});
 const first=await adapter.execute(publishing);assert.equal(first.status,'pending');assert.equal(posts,1);assert.equal(lookups,0);assert.equal(f.tables.social_publication_attempts!.length,1);const attemptId=f.tables.social_publication_attempts![0]!.attempt_id;assert.equal(f.tables.social_publication_attempts![0]!.status,'unknown');
 const probe=await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:assignment.account_id,platform:'tiktok',capability:'publishing.receipt_lookup',receiptId:'actual-original-unknown-receipt',dataStore:f.store,providers:{async youtube(){throw Error('not used');},async facebook(){throw Error('not used');},async instagram(){throw Error('not used');},async tiktok(){throw Error('not used');},async tiktokReceipt(_token,id){assert.equal(id,'actual-original-unknown-receipt');return {publishId:id};}}});assert.equal(probe.status,'verified');
 f.pkg.status='superseded';f.pkg.socialContentPackage.authorization.allowRealPublishing=false;
 const resolved=await reconcileWeeklyPublication({assignment:assignment.payload,publicationPackage,adapter:provider,dataStore:f.store,now:new Date()});assert.equal(resolved.status,'published',JSON.stringify(resolved));assert.equal(posts,1);assert.equal(lookups,1);assert.equal(f.tables.social_publication_attempts!.length,1);assert.equal(f.tables.social_publication_attempts![0]!.attempt_id,attemptId);assert.equal(f.tables.social_publication_attempts![0]!.status,'published');const again=await reconcileWeeklyPublication({assignment:assignment.payload,publicationPackage,adapter:provider,dataStore:f.store,now:new Date()});assert.equal(again.status,'published');assert.equal(posts,1);assert.equal(lookups,1);assert.equal(publicationPackage.packageId,assignment.package_id);assert.equal(f.result.technicalReview.approved,false);assert.equal(f.result.creativeReview.approved,false);
});
