import {controlledMessengerAccount} from '../messenger/controlledCapability.fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {createSocialWeeklyG6ReviewService} from './socialWeeklyG6ReviewService.js';
import type {SocialWeeklyG6Scope} from '../../shared/contracts/socialWeeklyG6Review.js';

test('actual owned MP4 and frozen weekly scope expose real G6 gaps without inventing approval',async()=>{
 const f=await prepareWeeklyQualityAuditFixture();try{
 const scope:SocialWeeklyG6Scope={tenantId:'t',taskId:String(f.tables.starter_social_content_tasks![0]!.task_id),runId:String(f.context.cache.runId),artifactId:String(f.artifact.artifact_id),programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationTaskId:f.pkg.socialContentPackage.publicationTasks[0]!.publicationTaskId};
 const service=createSocialWeeklyG6ReviewService(f.repository);const context=await service.context(scope,'owner');
 assert.equal(context.metadata?.width,160);assert.equal(context.metadata?.height,180);assert.equal(context.metadata?.framesPerSecond,10);
 assert.equal(context.checks.find(c=>c.code==='platform_format')?.status,'blocked');assert.equal(context.checks.find(c=>c.code==='conversion_route')?.status,'unknown');assert.ok(context.gaps.includes('actual_independent_g5_pass_required'));
 const read=await service.get(scope,'owner','actual-g6-request-0001');assert.equal(read.item,null);assert.equal(read.projectionStatus,'not_found');
 const result=await service.check(scope,'owner',{programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion,publicationTaskId:scope.publicationTaskId,requestId:'actual-g6-request-0001',expectedContextHash:context.contextHash});assert.equal(result.item?.status,'blocked');assert.equal(result.item?.receiptId,null);assert.equal(result.projectionStatus,'applied');assert.equal((await service.get(scope,'owner','actual-g6-request-0001')).item?.recordHash,result.item?.recordHash);
 await assert.rejects(service.context({...scope,publicationTaskId:'foreign'},'owner'),/publication_missing/);
 }finally{await f.cleanup();}
});

test('actual locally generated compliant MP4 is measured independently before G6 checks',async()=>{
 const f=await prepareWeeklyQualityAuditFixture({width:360,height:640,fps:30});try{
 const scope:SocialWeeklyG6Scope={tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationTaskId:f.pkg.socialContentPackage.publicationTasks[0]!.publicationTaskId};
 const context=await createSocialWeeklyG6ReviewService(f.repository).context(scope,'owner');assert.equal(context.metadata?.width,360);assert.equal(context.metadata?.height,640);assert.equal(context.metadata?.framesPerSecond,30);assert.equal(context.checks.find(c=>c.code==='platform_format')?.status,'passed');assert.ok(context.gaps.includes('actual_independent_g5_pass_required'));
 }finally{await f.cleanup();}
});

test('actual G4/G5, confirmed reception, provider-account fence and planned weekly authorization produce a real G6 receipt',async()=>{
 const f=await prepareWeeklyQualityAuditFixture({width:360,height:640,fps:30});try{
 const {sealAccountCredential}=await import('../lib/accountCredentials.js');const {refreshPlatformCapabilityEvidence}=await import('../publishing/platformCapabilities.js');const {savePublicationReceptionBinding}=await import('../socialPrograms/publicationReceptionService.js');const {g5FixtureScope,passedDirectorChecks}=await import('./socialDirectorG5ReviewService.fixture.js');
 const pub=f.pkg.socialContentPackage.publicationTasks[0]!;pub.publishWindow=f.pkg.weekStart+'T12:00:00+08:00';
 f.pkg.socialContentPackage.authorization={mode:'bounded',accountIds:[pub.accountId],maxPublishItems:5,weekStart:f.pkg.weekStart,weekEnd:f.pkg.weekEnd,allowRealPublishing:true,authorizedBy:'owner',authorizedAt:f.pkg.weekStart+'T00:00:00+08:00',revokedBy:null,revokedAt:null};
 if(typeof pub.cta!=='string'||!pub.cta)throw Error('actual_fixture_cta_missing');
 const binding=await savePublicationReceptionBinding(f.store,{tenantId:'t',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationId:pub.publicationTaskId,cta:pub.cta,enterpriseFactHash:f.profile.factVersion!.contentHash,targets:[{id:'sales-inbox',required:true,ownerId:'owner',destination:{kind:'messaging',channel:'messenger',receptionMode:'human'},requiredDocumentUrls:[]}]},'owner');pub.receptionRequirement={required:true,bindingId:binding.bindingId};
 const brief=f.tables.starter_social_content_tasks![0]!.brief as Record<string,unknown>;const authority=brief._weeklyAuthority as Record<string,unknown>;authority.publicationTask=structuredClone(pub);
 f.tables.social_accounts=[{id:pub.accountId,tenantId:'t',platform:'tiktok',status:'connected',providerAccountId:'actual-open-id',scope:'video.publish',accessToken:sealAccountCredential('controlled-provider-token')},controlledMessengerAccount({accountId:'messenger-sales',tenantId:'t',pageId:'actual-sales-page'})];
 await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:pub.accountId,platform:'tiktok',capability:'publishing.official',dataStore:f.store,providers:{async tiktok(){return {openId:'actual-open-id',publishGranted:true};},async youtube(){throw Error('not used');},async instagram(){throw Error('not used');},async facebook(){throw Error('not used');},async tiktokReceipt(){throw Error('not used');}}});
 await f.g5.assign(g5FixtureScope,'owner',{reviewerUserId:'owner'});const g5=await f.g5.context(g5FixtureScope,'owner');await f.g5.human(g5FixtureScope,'owner',{requestId:'actual-g6-source-director-0001',expectedContextHash:g5.contextHash,checks:passedDirectorChecks(g5)});
 const scope:SocialWeeklyG6Scope={...g5FixtureScope,programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationTaskId:pub.publicationTaskId};const service=createSocialWeeklyG6ReviewService(f.repository);const context=await service.context(scope,'owner');assert.deepEqual(context.checks.map(c=>[c.code,c.status]),[['account','passed'],['platform_format','passed'],['conversion_route','passed'],['sales_owner','passed'],['weekly_authorization','passed']]);assert.deepEqual(context.gaps,[]);
 const result=await service.check(scope,'owner',{programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion,publicationTaskId:scope.publicationTaskId,requestId:'actual-g6-pass-request-0001',expectedContextHash:context.contextHash});assert.equal(result.item?.status,'passed');assert.ok(result.item?.receiptId);assert.equal(result.projectionStatus,'applied');assert.equal((await service.get(scope,'owner','actual-g6-pass-request-0001')).item?.recordHash,result.item?.recordHash);
 }finally{await f.cleanup();}
});

test('YouTube owned decoded MP4 does not inherit TikTok frame-rate and dimension limits',async()=>{
 const f=await prepareWeeklyQualityAuditFixture();try{
 const pub=f.pkg.socialContentPackage.publicationTasks[0]!;pub.platform='youtube';const brief=f.tables.starter_social_content_tasks![0]!.brief as Record<string,unknown>;(brief._weeklyAuthority as Record<string,unknown>).publicationTask=structuredClone(pub);
 const scope:SocialWeeklyG6Scope={tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationTaskId:pub.publicationTaskId};
 const context=await createSocialWeeklyG6ReviewService(f.repository).context(scope,'owner');assert.equal(context.metadata?.framesPerSecond,10);assert.equal(context.checks.find(c=>c.code==='platform_format')?.status,'passed');assert.equal(context.checks.find(c=>c.code==='account')?.status,'blocked');
 }finally{await f.cleanup();}
});

test('trusted G6 rejects credential drift after passing instead of reusing old native permission',async()=>{
 const {prepareWeeklyG6Fixture}=await import('./socialWeeklyG6ReviewService.fixture.js');const f=await prepareWeeklyG6Fixture();try{
 const context=await f.service.context(f.scope,'owner');const input={programId:f.scope.programId,packageId:f.scope.packageId,packageVersion:f.scope.packageVersion,publicationTaskId:f.scope.publicationTaskId,requestId:'g6-credential-drift-0001',expectedContextHash:context.contextHash};await f.service.check(f.scope,'owner',input);
 const {sealAccountCredential}=await import('../lib/accountCredentials.js');const account=f.tables.social_accounts!.find(a=>a.id===context.accountId)!;account.accessToken=sealAccountCredential('changed-real-credential');
 const fresh=await f.service.context(f.scope,'owner');assert.equal(fresh.checks.find(c=>c.code==='account')?.status,'unknown');await assert.rejects(f.service.get(f.scope,'owner',input.requestId),/review_source_changed/);
 }finally{await f.cleanup();}
});

test('an inventory marker cannot substitute for the actual frozen approved-source binding',async()=>{
 const f=await prepareWeeklyQualityAuditFixture();try{
 const pub=f.pkg.socialContentPackage.publicationTasks[0]!;pub.inventoryReuseRef={type:'weekly_inventory_binding',id:'missing-real-binding',version:1};const scope:SocialWeeklyG6Scope={tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationTaskId:pub.publicationTaskId};await assert.rejects(createSocialWeeklyG6ReviewService(f.repository).context(scope,'owner'),(error:unknown)=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='inventory_binding_integrity_invalid'));
 assert.equal((f.tables.starter_social_weekly_g6_reviews??[]).length,0);
 }finally{await f.cleanup();}
});

test('fresh G6 renews after quota usage changes while preserving trusted history and live release gates',async()=>{
 const {prepareWeeklyG6Fixture}=await import('./socialWeeklyG6ReviewService.fixture.js');
 const {verifySocialWeeklyG6Receipt,SOCIAL_WEEKLY_G6_REVIEWS}=await import('./socialWeeklyG6ReviewService.js');
 const {readSocialProductionState}=await import('./socialContentProductionHandoff.js');
 const {sealAccountCredential}=await import('../lib/accountCredentials.js');
 const f=await prepareWeeklyG6Fixture();try{
 const check=async(requestId:string)=>{const context=await f.service.context(f.scope,'owner');assert.deepEqual(context.gaps,[]);const result=await f.service.check(f.scope,'owner',{programId:f.scope.programId,packageId:f.scope.packageId,packageVersion:f.scope.packageVersion,publicationTaskId:f.scope.publicationTaskId,requestId,expectedContextHash:context.contextHash});assert.equal(result.item?.status,'passed');assert.equal(result.projectionStatus,'applied');return result;};
 const old=await check('g6-quota-before-0001');
 const saved=f.tables[SOCIAL_WEEKLY_G6_REVIEWS]!.find(row=>row.request_id==='g6-quota-before-0001')!;assert.ok(saved);
 const oldPayload=structuredClone(saved.payload) as {receipt:import('./socialContentProductionHandoff.js').SocialProductionReceipt};
 const oldHash=saved.content_hash;
 // A different delivery in this same week consumes one authorized publication.
 // These are publication accounting inputs, not fabricated production outcomes.
 await f.store.create('social_publication_assignments',{tenant_id:f.scope.tenantId,operating_package_id:f.scope.packageId,operating_package_version:f.scope.packageVersion,publication_task_id:'other-publication',assignment_id:'other-quota-assignment'});
 await f.store.create('social_publication_attempts',{tenant_id:f.scope.tenantId,assignment_id:'other-quota-assignment',status:'published'});
 await assert.rejects(verifySocialWeeklyG6Receipt(f.repository,f.scope.tenantId,oldPayload.receipt),/preflight_evidence_changed/);
 const renewed=await check('g6-quota-after-0002');assert.notEqual(renewed.item?.receiptId,old.item?.receiptId);
 assert.equal(f.tables[SOCIAL_WEEKLY_G6_REVIEWS]!.length,2);assert.deepEqual(saved.payload,oldPayload);assert.equal(saved.content_hash,oldHash);
 const state=await readSocialProductionState({repository:f.repository,tenantId:f.scope.tenantId,taskId:f.scope.taskId});assert.ok(state);assert.equal(state.receipts.filter(receipt=>receipt.gate==='G6').length,2);assert.equal(state.gates.readyForRelease,true);
 const account=f.tables.social_accounts!.find(row=>row.id===f.pkg.socialContentPackage.publicationTasks[0]!.accountId)!;const token=account.accessToken;
 account.accessToken=sealAccountCredential('g6-renewal-credential-changed');
 await assert.rejects(readSocialProductionState({repository:f.repository,tenantId:f.scope.tenantId,taskId:f.scope.taskId}),/preflight_evidence_changed/);
 account.accessToken=token;
 saved.content_hash='tampered-old-review-hash';
 await assert.rejects(readSocialProductionState({repository:f.repository,tenantId:f.scope.tenantId,taskId:f.scope.taskId}),/record_corrupt/);
 saved.content_hash=oldHash;
 assert.equal((await readSocialProductionState({repository:f.repository,tenantId:f.scope.tenantId,taskId:f.scope.taskId}))?.gates.readyForRelease,true);
 }finally{await f.cleanup();}
});

test('G6 refuses requested Messenger scopes without admitted proof and rejects a rotated credential',async()=>{
 const {prepareWeeklyG6Fixture}=await import('./socialWeeklyG6ReviewService.fixture.js');
 const {sealAccountCredential}=await import('../lib/accountCredentials.js');
 const f=await prepareWeeklyG6Fixture();try{
  const account=f.tables.social_accounts!.find(row=>row.id==='messenger-sales')!;
  const originalScope=account.scope,originalToken=account.accessToken;
  const receiptCount=f.tables.starter_social_production_receipts?.length??0;
  for(const [requestId,mutation] of [
   ['g6-messenger-unproved-0001',()=>{account.scope='pages_messaging,pages_manage_metadata';}],
   ['g6-messenger-rotated-0002',()=>{account.accessToken=sealAccountCredential('unadmitted-rotated-token');}],
  ] as const){
   account.scope=originalScope;account.accessToken=originalToken;mutation();
   const context=await f.service.context(f.scope,'owner');
   const result=await f.service.check(f.scope,'owner',{programId:f.scope.programId,packageId:f.scope.packageId,packageVersion:f.scope.packageVersion,publicationTaskId:f.scope.publicationTaskId,requestId,expectedContextHash:context.contextHash});
   assert.equal(result.item?.status,'blocked');assert.equal(result.item?.receiptId,null);
  }
  assert.equal(f.tables.starter_social_production_receipts?.length??0,receiptCount);
 }finally{await f.cleanup();}
});
