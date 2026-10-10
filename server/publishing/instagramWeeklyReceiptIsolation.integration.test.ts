import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import type { DataStore } from '../storage/datastore.js';
import type { WeeklyPublishingProviderAdapter } from './weeklyLineage.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';

test('official Instagram weekly receipt adapter binds tenant/account/attempt and container receipt under blocked network', async () => {
 const oldFetch=globalThis.fetch, oldConnect=Socket.prototype.connect, oldKey=process.env.PLATFORM_TOKEN_ENCRYPTION_KEY;
 let outbound=0, writes=0, lookups=0, submissions=0;
 let knownMediaId='media-a';
 globalThis.fetch=(async()=>{outbound++;throw Error('test_outbound_forbidden');}) as typeof fetch;
 Socket.prototype.connect=function(){outbound++;throw Error('test_socket_forbidden');} as typeof oldConnect;
 process.env.PLATFORM_TOKEN_ENCRYPTION_KEY='controlled-ig-receipt-isolation-key';
 try {
  const {sealAccountCredential}=await import('../lib/accountCredentials.js');
  const {createWeeklyPublishingAdapter}=await import('./weeklyPublishingAdapter.js');
  const account={id:'account-a',tenantId:'tenant-a',platform:'instagram',status:'connected',providerAccountId:'native-a',oauthProvider:'instagram_login',scope:'instagram_business_basic instagram_business_content_publish',accessToken:sealAccountCredential('controlled-token')};
  const dataStore:DataStore={supportsAtomicOperationLease:()=>true,async getById<T>(collection:string,id:string){return (collection==='social_accounts'&&id===account.id?account:null) as T|null;},async list<T>(){return {items:[] as T[],totalItems:0,totalPages:0,page:1,perPage:2};},async create(){writes++;throw Error('unexpected write');},async update(){writes++;return false;},async delete(){writes++;return false;}};
  const receipt='ig-container:container-a';
  const adapter=await createWeeklyPublishingAdapter({tenantId:'tenant-a',accountId:'account-a',platform:'instagram',purpose:'receipt_lookup',providerReceiptId:receipt,dataStore,ports:{async publish(){submissions++;throw Error('receipt lookup must never submit');},async reconcile(input){lookups++;assert.deepEqual(input,{tenantId:'tenant-a',accountId:'account-a',platform:'instagram',providerReceiptId:receipt,...(knownMediaId?{platformPostId:knownMediaId}:{})});return {status:knownMediaId?'published':'unknown',providerReceiptId:receipt,platformPostId:knownMediaId,platformUrl:'https://controlled.invalid/reel/media-a',providerStatus:'PUBLISHED',error:''};}}});
  type Input=Parameters<WeeklyPublishingProviderAdapter['reconcile']>[0];
  const ref={type:'controlled_ref',id:'ref-a',version:1};
  const assignment:Input['assignment']={schemaVersion:'publication-assignment.v1',tenantId:'tenant-a',accountId:'account-a',platform:'instagram',assignmentId:'assignment-a',packageId:'package-a',publicationTaskId:'pub-a',publishWindow:'2026-10-10T12:00:00Z',packageIdempotencyKey:'key-a',assignmentHash:'hash-a',lineage:{programRef:ref,operatingPackageRef:ref,contentPackageRef:ref,weeklyPublicationTaskRef:ref,publishingWorkflowTaskRef:ref,businessGoalRef:null,enterpriseProfileRef:null,factRefs:[],productionResultRef:ref,upstreamRefs:[]}};
  const publicationPackage:Input['publicationPackage']={schemaVersion:1,packageId:'package-a',tenantId:'tenant-a',contentId:'artifact-a:pub-a',contentVersion:'1',contentHash:'hash-a',platform:'instagram',copy:{title:'controlled',body:'controlled',hashtags:[]},assets:[],publishingSteps:[],packageHash:'package-hash-a',generatedAt:'2026-10-10T00:00:00Z',status:'awaiting_user_publish'};
  const attempt:Input['attempt']={id:'row-a',tenant_id:'tenant-a',attempt_id:'attempt-a',assignment_id:'assignment-a',package_id:'package-a',provider:'meta-graph-api',status:'unknown',provider_receipt_id:receipt,platform_post_id:'media-a',started_at:'2026-10-10T00:00:00Z',updated_at:'2026-10-10T00:00:00Z'};
  for(const corrupted of [
   {assignment:{...assignment,tenantId:'tenant-b'},attempt},
   {assignment:{...assignment,accountId:'account-b'},attempt},
   {assignment,attempt:{...attempt,tenant_id:'tenant-b'}},
   {assignment,attempt:{...attempt,assignment_id:'assignment-b'}},
   {assignment,attempt:{...attempt,package_id:'package-b'}},
   {assignment,attempt:{...attempt,provider:'foreign-api'}},
   {assignment,attempt:{...attempt,provider_receipt_id:'ig-container:foreign'}},
  ]) {const rejected=await adapter.reconcile({...corrupted,publicationPackage});assert.equal(rejected.status,'unknown');assert.equal(lookups,0);}
  const originalNative=account.providerAccountId;account.providerAccountId='changed-native';
  assert.equal((await adapter.reconcile({assignment,attempt,publicationPackage})).status,'unknown');assert.equal(lookups,0);account.providerAccountId=originalNative;
  const resolved=await adapter.reconcile({assignment,attempt,publicationPackage});
  assert.equal(resolved.status,'published',JSON.stringify(resolved));
  assert.equal(resolved.providerReceiptId,receipt);assert.equal(resolved.platformPostId,'media-a');
  assert.equal(lookups,1);
  knownMediaId='';const unknown=await adapter.reconcile({assignment,publicationPackage,attempt:{...attempt,platform_post_id:undefined}});assert.equal(unknown.status,'unknown');assert.equal(unknown.platformPostId,undefined);assert.equal(lookups,2);assert.equal(submissions,0);assert.equal(writes,0);assert.equal(outbound,0);
 } finally {globalThis.fetch=oldFetch;Socket.prototype.connect=oldConnect;if(oldKey===undefined)delete process.env.PLATFORM_TOKEN_ENCRYPTION_KEY;else process.env.PLATFORM_TOKEN_ENCRYPTION_KEY=oldKey;}
});

test('formal Instagram weekly chain persists original container/media and reconciles unknown once without resubmission', async t => {
 const oldFetch=globalThis.fetch, oldConnect=Socket.prototype.connect, oldNodeEnv=process.env.NODE_ENV;
 let outbound=0,posts=0,lookups=0;
 globalThis.fetch=(async()=>{outbound++;throw Error('controlled_integration_outbound_forbidden');}) as typeof fetch;
 Socket.prototype.connect=function(){outbound++;throw Error('controlled_integration_socket_forbidden');} as typeof oldConnect;
 process.env.NODE_ENV='test';
 t.after(()=>{globalThis.fetch=oldFetch;Socket.prototype.connect=oldConnect;if(oldNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNodeEnv;});
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-02T12:00:00Z')});
 const [{prepareInstagramDeliveryFixture},{INSTAGRAM_DELIVERY_TECHNICAL_CHECKS,INSTAGRAM_DELIVERY_CREATIVE_CHECKS},{refreshPlatformCapabilityEvidence},{createSocialWeeklyProductionAdapter},{validateContentArtifact},{createWeeklyExecutionTaskService},{runWeeklyPublicationPackageScan},{createSocialWeeklyPublicationAdapter},{createWeeklyPublishingAdapter}]=await Promise.all([
  import('../starter198/socialInstagramDeliveryService.fixture.js'),import('../../shared/contracts/socialInstagramDelivery.js'),import('./platformCapabilities.js'),import('../runtime/socialWeeklyProductionAdapter.js'),import('../runtime/socialWeeklyResultValidation.js'),import('../socialPrograms/executionTasks.js'),import('./weeklyPublicationWorker.js'),import('../runtime/socialWeeklyPublicationAdapter.js'),import('./weeklyPublishingAdapter.js'),
 ]);
 const f=await prepareInstagramDeliveryFixture({fullyConfigured:true});t.after(f.cleanup);
 const account=f.tables.social_accounts!.find(row=>row.platform==='instagram')!;account.oauthProvider='instagram_login';account.scope='instagram_business_basic instagram_business_content_publish';
 const proof=await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:String(account.id),platform:'instagram',capability:'publishing.official',dataStore:f.store,providers:{async instagramLogin(){return {id:String(account.providerAccountId),publishGranted:true};},async instagram(){throw Error('legacy graph forbidden');},async facebook(){throw Error('unused');},async youtube(){throw Error('unused');},async tiktok(){throw Error('unused');},async tiktokReceipt(){throw Error('unused');}}});assert.equal(proof.status,'verified');
 const context=await f.g6.context(f.scope,'owner');const prepared=await f.delivery.prepare(f.scope,'owner',{requestId:'native_ig_isolation_delivery_0001',expectedContextHash:context.contextHash});assert.ok(prepared.item);
 for(const kind of ['technical','creative'] as const){const codes=kind==='technical'?INSTAGRAM_DELIVERY_TECHNICAL_CHECKS:INSTAGRAM_DELIVERY_CREATIVE_CHECKS;await f.delivery.review(f.scope,'owner',{requestId:`native_ig_isolation_${kind}_0001`,expectedDeliveryHash:prepared.item.recordHash,kind,checks:codes.map(code=>({code,outcome:'passed',observation:'受控本地审核归档视频；不代表真实平台接收'}))});}
 f.pkg.workflowTasks.push({taskId:'native-publishing-workflow',kind:'publishing',taskRef:{type:'weekly_workflow_task',id:'native-publishing-workflow',version:1},dependsOnTaskIds:['content-workflow'],subjectRefs:[{type:'weekly_publication_task',id:'pub',version:1}],status:'planned',ownBlockingReasons:[],inheritedBlockingTaskIds:[],carriedFromTaskId:null});
 const g6context=await f.g6.context(f.scope,'owner');assert.deepEqual(g6context.gaps,[]);
 const checked=await f.g6.check(f.scope,'owner',{requestId:'native_ig_isolation_g6_0001',expectedContextHash:g6context.contextHash,programId:f.scope.programId,packageId:f.scope.packageId,packageVersion:f.scope.packageVersion,publicationTaskId:f.scope.publicationTaskId});assert.equal(checked.item?.status,'passed');
 const production=await createSocialWeeklyProductionAdapter(f.store,{start:async()=>{throw Error('no new production');},create:async()=>{throw Error('no new content');}}).execute(f.task);assert.equal(production.status,'succeeded');await validateContentArtifact(f.store,f.task,f.ref);
 type Task=WeeklyExecutionTask;
 const dependency:Task={...f.task,taskId:'native-quality-complete',status:'succeeded',dependsOnTaskIds:[],inheritedBlockingTaskIds:[],ownBlockingReasons:[],resultRefs:[f.ref],inputSnapshot:{}};
 const approval:Task={...dependency,taskId:'native-human-approval',status:'blocked',dependsOnTaskIds:[dependency.taskId],resultRefs:[],schedule:{...dependency.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 const row=(task:Task)=>({id:task.taskId,tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,payload:task});
 f.tables.social_weekly_execution_tasks=[row(dependency),row(approval)];f.tables.starter_social_content_tasks![0]!.weekly_plan_id=f.pkg.packageId;
 await createWeeklyExecutionTaskService(f.store).approve('t','p','week1',approval.taskId,'owner');
 const scan=await runWeeklyPublicationPackageScan({dataStore:f.store,tenantId:'t',taskId:'content'});assert.deepEqual(scan.errors,[]);assert.equal(scan.createdAssignments,1);
 const publishing:Task={...dependency,taskId:'native-weekly-publishing',workflowKind:'publishing',status:'queued',dependsOnTaskIds:[approval.taskId],resultRefs:[],schedule:{...dependency.schedule,stepKind:'publishing',responsibleActor:'publishing_agent'}};f.tables.social_weekly_execution_tasks.push(row(publishing));
 assert.equal(f.tables.social_publication_attempts?.length??0,0);
 const outer=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async assignment=>createWeeklyPublishingAdapter({tenantId:assignment.tenant_id,accountId:assignment.account_id,platform:'instagram',dataStore:f.store,...(f.tables.social_publication_attempts?.[0]?.provider_receipt_id?{purpose:'receipt_lookup' as const,providerReceiptId:String(f.tables.social_publication_attempts[0].provider_receipt_id)}:{}),ports:{async publish(input){posts++;assert.ok(input.publishAttemptId);assert.ok(input.sourceClaim);assert.ok(input.onProviderReceipt);assert.ok(input.onPublishedMedia);const originalAttempt=f.tables.social_publication_attempts![0]!;const originalProvider=originalAttempt.provider;originalAttempt.provider='foreign-api';await assert.rejects(input.onProviderReceipt('ig-container:original-native-container'),/instagram_container_attempt_mismatch/);assert.equal(originalAttempt.provider_receipt_id,undefined);originalAttempt.provider=originalProvider;await input.onProviderReceipt('ig-container:original-native-container');await assert.rejects(input.onProviderReceipt('ig-container:foreign-container'),/instagram_container_attempt_mismatch/);await input.onPublishedMedia('original-native-media');await assert.rejects(input.onPublishedMedia('foreign-media'),/instagram_media_attempt_mismatch/);const saved=f.tables.social_publication_attempts![0]!;assert.equal(saved.provider_receipt_id,'ig-container:original-native-container');assert.equal(saved.platform_post_id,'original-native-media');return {video:{},tracking:{id:'controlled-tracking',tenant_id:'t',platform:'instagram',track_code:'controlled'},publishRecord:null,providerReceiptId:'ig-container:original-native-container',platformPostId:'',deliveryStatus:'provider_accepted'};},async reconcile(input){lookups++;assert.equal(input.providerReceiptId,'ig-container:original-native-container');assert.equal(input.platformPostId,'original-native-media');return {status:'published',providerReceiptId:input.providerReceiptId,platformPostId:'original-native-media',platformUrl:'https://controlled.invalid/reel/original',providerStatus:'PUBLISHED',error:''};}}})});
 const first=await outer.execute(publishing);assert.equal(first.status,'pending',JSON.stringify(first));assert.equal(posts,1);assert.equal(lookups,0);assert.equal(f.tables.social_publication_attempts!.length,1);const attemptId=f.tables.social_publication_attempts![0]!.attempt_id;assert.equal(f.tables.social_publication_attempts![0]!.status,'unknown');assert.equal(f.tables.social_publication_attempts![0]!.platform_post_id,'original-native-media');
 const resolved=await outer.execute(publishing);assert.equal(resolved.status,'succeeded',JSON.stringify(resolved));assert.equal(posts,1);assert.equal(lookups,1);assert.equal(f.tables.social_publication_attempts![0]!.attempt_id,attemptId);assert.equal(f.tables.social_publication_attempts![0]!.status,'published');
 assert.equal((await outer.execute(publishing)).status,'succeeded');assert.equal(posts,1);assert.equal(lookups,1);assert.equal(f.tables.social_publication_attempts!.length,1);assert.equal(outbound,0);
});
