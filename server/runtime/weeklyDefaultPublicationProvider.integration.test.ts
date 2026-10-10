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
import type {StoredPublicationAssignment} from '../publishing/weeklyLineage.js';

import {prepareDefaultPublication} from './weeklyDefaultPublication.fixture.js';

test('default TikTok provider consumes actual false-summary G4/G5/G6 media through real source claim before one controlled terminal publish',async t=>{
 const {f,assignment,publicationPackage,publishing}=await prepareDefaultPublication(t,{profile:'b2b_cold_start'});
 assert.deepEqual(f.pkg.referenceSourcePolicy,{profile:'b2b_cold_start',allocationUnit:'mother_content',ownedPercent:0,externalPercent:100});
 const planning=f.tables.social_weekly_agent_planning![0]!.payload as Record<string,any>;assert.equal(planning.referenceSourcePolicy.profile,'b2b_cold_start');assert.ok(planning.skeleton.slots.every((slot:Record<string,unknown>)=>slot.referenceSource==='external'));
 let posts=0;
 const defaultProvider=await createTikTokWeeklyPublishingAdapter({tenantId:assignment.tenant_id,accountId:assignment.account_id,dataStore:f.store,now:new Date(),ports:{
  async publish(input){posts++;assert.equal(input.tenantId,'t');assert.equal(input.accountId,'account');assert.equal(input.platform,'tiktok');assert.equal(input.contentId,publicationPackage.contentId);assert.ok(input.publishAttemptId);assert.ok(input.sourceClaim);assert.equal(input.sourceClaim.sourceKind,'social_production_artifact');assert.equal(input.sourceClaim.artifactId,'artifact');assert.equal(input.sourceClaim.productionResultId,assignment.payload.lineage.productionResultRef.id);assert.equal(input.sourceClaim.contentHash,publicationPackage.contentHash);assert.equal(input.sourceClaim.videoHash,publicationPackage.assets.find(a=>a.kind==='video')!.contentHash);assert.ok(input.videoPath);const actualVideoPath=input.videoPath;const bytes=await readFile(actualVideoPath);assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sourceClaim.videoHash);assert.equal(f.result.technicalReview.approved,false);assert.equal(f.result.creativeReview.approved,false);return {video:{id:'controlled-terminal'},tracking:{id:'controlled-tracking',tenant_id:'t',platform:'tiktok',track_code:'controlled'},publishRecord:null,platformPostId:'controlled-default-tiktok-post',providerReceiptId:'controlled-default-tiktok-receipt',deliveryStatus:'published'};},
  async reconcile(){throw Error('final published receipt must be reused without further supplier calls');}
 }});
 assert.equal(defaultProvider.capability,'available',JSON.stringify(defaultProvider));
 let defaultProviderError='';const actualDefaultPublish=defaultProvider.publish.bind(defaultProvider);defaultProvider.publish=async input=>{try{return await actualDefaultPublish(input);}catch(error){defaultProviderError=error instanceof Error?error.message:String(error);throw error;}};
 const originalTone=f.profile.brand.tone;f.profile.brand.tone='真实调性漂移';
 await assert.rejects(assertWeeklyPublicationG6Admission(f.store,publishing,assignment,publicationPackage));assert.equal(posts,0);f.profile.brand.tone=originalTone;
 let factoryCalls=0;const adapter=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>{factoryCalls++;return defaultProvider;}});
 const first=await adapter.execute(publishing);assert.equal(first.status,'succeeded',JSON.stringify({first,posts,defaultProviderError,attempts:f.tables.social_publication_attempts}));assert.equal(posts,1);
 const originalAttemptId=f.tables.social_publication_attempts![0]!.attempt_id;f.pkg.status='superseded';f.pkg.socialContentPackage.authorization.allowRealPublishing=false;assignment.status='revoked';
 const repeated=await adapter.execute(publishing);assert.equal(repeated.status,'succeeded',JSON.stringify(repeated));assert.equal(posts,1);assert.equal(factoryCalls,1,'published original receipt must be read without a new provider factory after withdrawal');assert.equal(f.tables.social_publication_attempts![0]!.attempt_id,originalAttemptId);assert.equal(f.tables.social_publication_attempts![0]!.platform_post_id,'controlled-default-tiktok-post');
 assert.equal(f.tables.social_publication_attempts!.length,1);assert.equal(f.tables.social_publication_assignments!.length,1);
 assert.equal(f.result.technicalReview.approved,false);assert.equal(f.result.creativeReview.approved,false);
});

for(const originalStatus of ['unknown','in_flight'] as const)test(`outer actual weekly card reads original ${originalStatus} receipt after withdrawal, revoked assignment, disabled publishing and removed approval with no new publish`,async t=>{
 const {f,assignment,publicationPackage,publishing}=await prepareDefaultPublication(t,{profile:'b2b_cold_start'});let posts=0,lookups=0;
 const provider=await createTikTokWeeklyPublishingAdapter({tenantId:assignment.tenant_id,accountId:assignment.account_id,dataStore:f.store,now:new Date(),ports:{
 async publish(input){posts++;assert.ok(input.videoPath);const actualVideoPath=input.videoPath;const bytes=await readFile(actualVideoPath);assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sourceClaim!.videoHash);return {video:{},tracking:{id:'controlled-unknown-tracking',tenant_id:'t',platform:'tiktok',track_code:'controlled'},publishRecord:null,platformPostId:'',providerReceiptId:'actual-original-unknown-receipt',deliveryStatus:'provider_accepted'};},
 async reconcile(input){lookups++;assert.equal(input.providerReceiptId,'actual-original-unknown-receipt');assert.equal(input.accountId,assignment.account_id);return {status:'published',providerReceiptId:input.providerReceiptId,platformPostId:'actual-original-resolved-post',platformUrl:'',providerStatus:'PUBLISH_COMPLETE',error:''};}}});
 assert.equal(provider.capability,'available');const adapter=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>provider});
 const first=await adapter.execute(publishing);assert.equal(first.status,'pending');assert.equal(posts,1);assert.equal(lookups,0);assert.equal(f.tables.social_publication_attempts!.length,1);const attemptId=f.tables.social_publication_attempts![0]!.attempt_id;assert.equal(f.tables.social_publication_attempts![0]!.status,'unknown');
 const probe=await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:assignment.account_id,platform:'tiktok',capability:'publishing.receipt_lookup',receiptId:'actual-original-unknown-receipt',dataStore:f.store,providers:{async youtube(){throw Error('not used');},async facebook(){throw Error('not used');},async instagram(){throw Error('not used');},async tiktok(){throw Error('not used');},async tiktokReceipt(_token,id){assert.equal(id,'actual-original-unknown-receipt');return {publishId:id};}}});assert.equal(probe.status,'verified');
 // Persisted identity corruption must fail closed before a provider lookup.
 const actualAttempt=f.tables.social_publication_attempts![0]!;actualAttempt.status=originalStatus;
 const corruptions=[()=>{const before=assignment.account_id;assignment.account_id='foreign-account';return()=>{assignment.account_id=before;};},()=>{const before=actualAttempt.package_id;actualAttempt.package_id='foreign-package';return()=>{actualAttempt.package_id=before;};},()=>{const before=actualAttempt.provider;actualAttempt.provider='foreign-provider';return()=>{actualAttempt.provider=before;};}];
 for(const corrupt of corruptions){const restore=corrupt();try{const refused=await adapter.execute(publishing);assert.equal(refused.status,'blocked',JSON.stringify(refused));assert.equal(posts,1);assert.equal(lookups,0);assert.equal(f.tables.social_publication_attempts!.length,1);}finally{restore();}}
 f.pkg.status='superseded';f.pkg.socialContentPackage.authorization.allowRealPublishing=false;assignment.status='revoked';
 f.tables.social_weekly_execution_tasks=f.tables.social_weekly_execution_tasks!.filter(row=>(row.payload as WeeklyExecutionTask).schedule.stepKind!=='user_approval');
 let readonlyFactories=0;const readonlyAdapter=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>false,adapterFactory:async()=>{readonlyFactories++;return provider;}});
 const resolved=await readonlyAdapter.execute(publishing);assert.equal(resolved.status,'succeeded',JSON.stringify(resolved));assert.equal(posts,1);assert.equal(lookups,1);assert.equal(f.tables.social_publication_attempts!.length,1);assert.equal(f.tables.social_publication_attempts![0]!.attempt_id,attemptId);assert.equal(f.tables.social_publication_attempts![0]!.status,'published');const again=await readonlyAdapter.execute(publishing);assert.equal(again.status,'succeeded');assert.equal(posts,1);assert.equal(lookups,1);assert.equal(readonlyFactories,1,'terminal receipt must not instantiate another provider');assert.equal(publicationPackage.packageId,assignment.package_id);assert.equal(f.result.technicalReview.approved,false);assert.equal(f.result.creativeReview.approved,false);
});

for(const stop of ['withdrawn','assignment_revoked'] as const)test(`actual default-provider source with no attempt is not submitted or queried when ${stop}`,async t=>{
 const {f,assignment,publishing}=await prepareDefaultPublication(t);let factories=0,posts=0,lookups=0;
 assert.equal(f.tables.social_publication_attempts?.length??0,0);
 if(stop==='withdrawn'){f.pkg.status='superseded';f.pkg.socialContentPackage.authorization.allowRealPublishing=false;}else assignment.status='revoked';
 const adapter=createSocialWeeklyPublicationAdapter(f.store,{publishingEnabled:()=>true,adapterFactory:async()=>{factories++;return createTikTokWeeklyPublishingAdapter({tenantId:assignment.tenant_id,accountId:assignment.account_id,dataStore:f.store,now:new Date(),ports:{async publish(){posts++;throw Error('stopped source must not submit');},async reconcile(){lookups++;throw Error('no original attempt to query');}}});}});
 const result=await adapter.execute(publishing);assert.equal(result.status,'blocked',JSON.stringify(result));assert.equal(factories,0);assert.equal(posts,0);assert.equal(lookups,0);assert.equal(f.tables.social_publication_attempts?.length??0,0);assert.equal(f.tables.social_publication_assignments!.length,1);assert.equal(f.result.technicalReview.approved,false);assert.equal(f.result.creativeReview.approved,false);
});
