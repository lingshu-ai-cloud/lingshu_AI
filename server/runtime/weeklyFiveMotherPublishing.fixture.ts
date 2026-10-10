import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {Starter198Repository} from '../starter198/repository.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {createWeeklyExecutionTaskService} from '../socialPrograms/executionTasks.js';
import {createSocialWeeklyExecutionWorker} from './socialWeeklyExecutionWorker.js';
import {createSocialWeeklyCustomerChannelAdapter} from './socialWeeklyCustomerChannelAdapter.js';
import {createSocialWeeklyPublicationAdapter} from './socialWeeklyPublicationAdapter.js';
import {createSocialWeeklyG6ReviewService} from '../starter198/socialWeeklyG6ReviewService.js';
import {refreshPlatformCapabilityEvidence} from '../publishing/platformCapabilities.js';
import {runWeeklyPublicationPackageScan} from '../publishing/weeklyPublicationWorker.js';
import {createTikTokWeeklyPublishingAdapter} from '../publishing/tiktokWeeklyPublishingAdapter.js';
import {bindWeeklyCustomerRun} from './socialWeeklyCustomerBridge.js';
import {sealAccountCredential} from '../lib/accountCredentials.js';
import type {WeeklyPublishingProviderAdapter} from '../publishing/weeklyLineage.js';
import {encryptSecret} from '../lib/tenantPlatformApps.js';

/** Actual G6, explicit approval, publication scan, channel readiness and the
 * official publishing factory. Only the final provider transport is controlled. */
export async function publishFiveMotherWeek(t:TestContext,input:{store:DataStore;repository:Starter198Repository;pkg:WeeklyOperatingPackage;now:Date;beforePublishing?:(input:{published:number;publicationTaskId:string;provider:WeeklyPublishingProviderAdapter;now:Date})=>Promise<void>}){
 const {store,repository,pkg}=input,tenantId='t',actorUserId='owner';
 const service=createWeeklyExecutionTaskService(store),worker=createSocialWeeklyExecutionWorker(store),g6=createSocialWeeklyG6ReviewService(repository);
 const prior=process.env.FOLLOWUP_WORKER_ENABLED;process.env.FOLLOWUP_WORKER_ENABLED='true';t.after(()=>{if(prior===undefined)delete process.env.FOLLOWUP_WORKER_ENABLED;else process.env.FOLLOWUP_WORKER_ENABLED=prior;});
 await store.create('tenant_platform_apps',{id:'five-wa',tenant_id:tenantId,platform:'meta',status:'active',app_id:'five-controlled-app',app_secret:encryptSecret('five-controlled-signing-secret'),waba_id:'five-controlled-waba',phone_number_id:'five-controlled-phone',access_token:encryptSecret('five-controlled-wa-token')});
 await store.create('social_accounts',{id:'five-instagram',tenantId,platform:'instagram',status:'connected',providerAccountId:'five-controlled-ig',oauthProvider:'instagram_login',scope:'instagram_business_manage_messages',instagramWebhookSubscribed:true,accessToken:sealAccountCredential('five-controlled-ig-token')});
 await store.create('digital_employee_configs',{id:'five-customer-config',tenant_id:tenantId,status:'active',config_version:100,config:{enabledWorkflows:['customer_segmentation','batch_followup'],allowRealCustomerMessages:true}});
 await store.create('weekly_goals',{id:'five-customer-goal',tenant_id:tenantId,business_line:'customer_conversion',starts_at:pkg.weekStart+'T00:00:00Z',ends_at:pkg.weekEnd+'T23:59:59Z'});
 await store.create('weekly_plans',{id:'five-customer-plan',tenant_id:tenantId,goal_id:'five-customer-goal'});
 await store.create('workflow_runs',{id:'five-customer-run',tenant_id:tenantId,goal_id:'five-customer-goal',plan_id:'five-customer-plan',status:'running'});
 for(const key of ['customer_segmentation','followup_batch_draft','followup_batch_approval','followup_dispatch'])await store.create('workflow_tasks',{id:`five-${key}`,tenant_id:tenantId,run_id:'five-customer-run',goal_id:'five-customer-goal',plan_id:'five-customer-plan',task_key:key,agent_role:'customer',status:'queued',execution_mode:'observe',status_source:key==='customer_segmentation'?'customer_segments':'followup_batches',depends_on:[],sequence:0});
 await bindWeeklyCustomerRun(store,{tenantId,programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version},'five-customer-run',actorUserId);
 const g6Scopes=new Map<string,Parameters<typeof g6.context>[0]>();
 const graph=await service.list(tenantId,pkg.programId,pkg.packageId,pkg.version);
 const publishing=graph.filter(task=>task.schedule.stepKind==='publishing');assert.equal(publishing.length,5);
 const publishNow=new Date(Math.max(input.now.getTime(),...publishing.map(task=>Date.parse(task.schedule.estimatedStartAt)),...pkg.socialContentPackage.publicationTasks.map(publication=>{assert.ok(publication.publishWindow);return Date.parse(publication.publishWindow);}),...graph.filter(task=>task.schedule.stepKind==='customer_channel_readiness').map(task=>Date.parse(task.schedule.estimatedStartAt)))+1);
 assert.ok(publishNow.getTime()<Date.parse(pkg.weekEnd+'T23:59:59Z'),'controlled publication must stay in the actual operating week');t.mock.timers.setTime(publishNow.getTime());
 await refreshPlatformCapabilityEvidence({tenantId,accountId:'account',platform:'tiktok',capability:'publishing.official',dataStore:store,providers:{async tiktok(){return{openId:'five-controlled-account',publishGranted:true};},async youtube(){throw Error('unused');},async instagram(){throw Error('unused');},async facebook(){throw Error('unused');},async tiktokReceipt(){throw Error('unused');}}});
 for(const publication of pkg.socialContentPackage.publicationTasks){
  const videos=graph.filter(task=>task.publicationTaskId===publication.publicationTaskId&&task.schedule.stepKind==='video_generation');assert.equal(videos.length,1);assert.equal(videos[0]!.status,'succeeded');
  const artifactRef=videos[0]!.resultRefs.find(ref=>ref.type==='starter_social_content_artifact');assert.ok(artifactRef);
  const rows=await store.list<Record_>('starter_social_content_artifacts',{where:{tenant_id:tenantId,artifact_id:artifactRef.id},perPage:2});assert.equal(rows.totalItems,1);const artifact=rows.items[0]!;
  const contentTask=await store.list<Record_>('starter_social_content_tasks',{where:{tenant_id:tenantId,task_id:String(artifact.task_id)},perPage:2});assert.equal(contentTask.totalItems,1);assert.ok(contentTask.items[0]!.run_id);
  const scope={tenantId,taskId:String(artifact.task_id),runId:String(contentTask.items[0]!.run_id),artifactId:artifactRef.id,programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:publication.publicationTaskId};
  g6Scopes.set(publication.publicationTaskId,scope);
  const context=await g6.context(scope,actorUserId);assert.deepEqual(context.gaps,[]);assert.ok(context.checks.every(check=>check.status==='passed'),JSON.stringify(context.checks));
  const checked=await g6.check(scope,actorUserId,{...scope,requestId:`five-g6-${publication.publicationTaskId}`,expectedContextHash:context.contextHash});assert.equal(checked.item?.status,'passed');
  const approval=graph.find(task=>task.publicationTaskId===publication.publicationTaskId&&task.schedule.stepKind==='user_approval');assert.ok(approval);
  const approved=await service.approve(tenantId,pkg.programId,pkg.packageId,approval.taskId,actorUserId);assert.equal(approved.find(task=>task.taskId===approval.taskId)?.status,'succeeded');
  const scan=await runWeeklyPublicationPackageScan({dataStore:store,tenantId,taskId:scope.taskId});assert.deepEqual(scan.errors,[]);assert.equal(scan.createdAssignments,1);
 }
 let posts=0,lookups=0;const submittedArtifacts=new Set<string>();const providerReceipts=new Map<string,string>();
 const provider=await createTikTokWeeklyPublishingAdapter({tenantId,accountId:'account',dataStore:store,now:publishNow,ports:{async publish(claim){assert.ok(claim.videoPath);assert.ok(claim.sourceClaim);assert.equal(createHash('sha256').update(await readFile(claim.videoPath)).digest('hex'),claim.sourceClaim.videoHash);assert.ok(claim.sourceClaim.artifactId);assert.ok(!submittedArtifacts.has(claim.sourceClaim.artifactId));submittedArtifacts.add(claim.sourceClaim.artifactId);posts++;const receiptId=`five-controlled-receipt-${posts}`,postId=`five-controlled-post-${posts}`;providerReceipts.set(receiptId,postId);await refreshPlatformCapabilityEvidence({tenantId,accountId:'account',platform:'tiktok',capability:'publishing.receipt_lookup',receiptId,dataStore:store,providers:{async tiktok(){throw Error('unused');},async youtube(){throw Error('unused');},async instagram(){throw Error('unused');},async facebook(){throw Error('unused');},async tiktokReceipt(_token,id){assert.ok(providerReceipts.has(id));return{publishId:id};}}});return{video:{id:`five-controlled-${posts}`},tracking:{id:`five-tracking-${posts}`,tenant_id:tenantId,platform:'tiktok',track_code:`five-${posts}`},publishRecord:null,platformPostId:`five-controlled-post-${posts}`,providerReceiptId:`five-controlled-receipt-${posts}`};},async reconcile(input){lookups++;const postId=providerReceipts.get(input.providerReceiptId);assert.ok(postId);return{status:'published',providerReceiptId:input.providerReceiptId,platformPostId:postId,platformUrl:'',providerStatus:'PUBLISH_COMPLETE',error:''};}}});
 assert.equal(provider.capability,'available');
 const publishingAdapter=createSocialWeeklyPublicationAdapter(store,{publishingEnabled:()=>true,now:()=>publishNow,adapterFactory:async()=>provider}),channelAdapter=createSocialWeeklyCustomerChannelAdapter(store,{now:()=>publishNow});
 let readiness=0,published=0;
 for(let iteration=0;iteration<20;iteration++){
  const claim=await worker.claimNext({tenantId,workerId:'five-mother-publishing-worker',kinds:iteration<15?['engagement']:['publishing'],now:publishNow});assert.ok(claim);
  const step=claim.task.schedule.stepKind;assert.equal(step,iteration<15?'customer_channel_readiness':'publishing');
  if(step==='publishing'){const scope=g6Scopes.get(String(claim.task.publicationTaskId));assert.ok(scope);const current=await g6.context(scope,actorUserId);assert.deepEqual(current.gaps,[]);const checked=await g6.check(scope,actorUserId,{...scope,requestId:`five-g6-publish-${claim.task.publicationTaskId}`,expectedContextHash:current.contextHash});assert.equal(checked.item?.status,'passed');await input.beforePublishing?.({published,publicationTaskId:String(claim.task.publicationTaskId),provider,now:publishNow});}
  const result=await (step==='publishing'?publishingAdapter:channelAdapter).execute(claim.task);assert.equal(result.status,'succeeded',JSON.stringify({step,result}));if(result.status!=='succeeded')throw Error('controlled publication proof missing');
  await worker.complete(claim,result.resultRefs,publishNow);
  if(step==='publishing'){published++;const again=await publishingAdapter.execute(claim.task);assert.equal(again.status,'succeeded');}else readiness++;
 }
 assert.equal(posts,5);assert.equal(published,5);assert.equal(readiness,15);assert.equal(submittedArtifacts.size,5);
 const attempts=await store.list<Record_>('social_publication_attempts',{where:{tenant_id:tenantId},perPage:100});assert.equal(attempts.totalItems,5);assert.ok(attempts.items.every(row=>row.status==='published'));
 const {executeNativeEmptyCustomerSegmentation}=await import('./weeklyNativeEmptyCustomerSegment.fixture.js');
 await executeNativeEmptyCustomerSegmentation(store,{tenantId,runId:'five-customer-run',userId:actorUserId});
 return{now:publishNow,posts,lookups,published,readiness,customerRunId:'five-customer-run',graph:await service.list(tenantId,pkg.programId,pkg.packageId,pkg.version)};
}
