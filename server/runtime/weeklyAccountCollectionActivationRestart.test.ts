import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {Record_} from '../storage/datastore.js';
import {issueWeeklyAccountCollectionBudgetAuthorization} from '../socialDiscovery/weeklyAccountCollectionBudget.js';
import {executeApprovedDiscoveryRun} from '../socialDiscovery/service.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {supplementConsumerHash} from '../socialPrograms/weeklySupplementRequests.js';
import {bindWeeklyPreproductionAuthority,runWeeklyPreproductionProducerScan,WEEKLY_PREPRODUCTION_JOBS} from './weeklyPreproductionProducer.js';
import {prepareWeeklyEnterpriseFactFixture,reopenWeeklyEnterpriseFactFixtureStore} from './weeklyEnterpriseFactSupplement.fixture.js';
import {createDefaultWeeklyPreproductionPorts} from './defaultWeeklyPreproductionPorts.js';

test('account-only five-video collection remains unsubmitted across credentials and durable restart until CNY cost proof exists',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-account-activation-'));
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const file=path.join(folder,'store.json');
 const c=await prepareWeeklyEnterpriseFactFixture(t,{persistentFile:file});
 const packageRow=(await c.store.list<Record_>('social_weekly_operating_packages')).items[0]!;await c.store.update('social_weekly_operating_packages',packageRow.id,{payload:{...(packageRow.payload as object),discoveryBudgetCny:5}});
 c.task.schedule.stepKind='benchmark_collection';
 const taskRow=(await c.store.list<Record_>('social_weekly_execution_tasks')).items[0];
 if(taskRow)await c.store.update('social_weekly_execution_tasks',taskRow.id,{payload:c.task});
 else await c.store.create('social_weekly_execution_tasks',{tenant_id:c.task.tenantId,program_id:c.task.programId,package_id:c.task.packageId,package_version:1,task_id:c.task.taskId,status:c.task.status,idempotency_key:c.task.idempotencyKey,payload:c.task});
 const accountUrl='https://www.tiktok.com/@yuchengcosmeticsfactory';
 const scopePayload={
  approval:{status:'approved',approvedBy:'user',scopeVersion:3},
  weeklyAccountRevision:{accountUrl,targetCount:5},
  discoveryBrief:{discoveryModes:['account'],modePolicies:{account:{enabled:true}},weeklyAccountCollectionTarget:{accountUrl,targetCount:5}},
 };
 await c.store.create('social_discovery_scopes',{id:'golden-account-scope',tenant_id:'tenant-a',created_by:'owner',version:3,status:'active',payload:scopePayload});
 await c.store.create('competitor_accounts',{id:'golden-account',tenantId:'tenant-a',platform:'tiktok',accountUrl});
 const bound=await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(c.task),discovery:{scopeId:'golden-account-scope',scopeVersion:3,requestedModes:['account']}});
 const now=new Date('2026-10-16T08:00:00.000Z');
 const originalToken=process.env.APIFY_TOKEN;
 let legacyProviderCalls=0,canonicalBindings=0;
 const noPaidPorts={discoveryDependencies:{dataStore:c.store,async crawl(){legacyProviderCalls++;throw Error('legacy provider must not run');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){throw Error('analysis must not run');}},async runCandidateEvidence(){throw Error('analysis must not run');}},candidatePorts:{canonicalMedia:{async bindingForCandidate(){canonicalBindings++;throw Error('canonical mapping must not run');}}}} as any;
 try{
  delete process.env.APIFY_TOKEN;
  const first=await runWeeklyPreproductionProducerScan({store:c.store,now,...noPaidPorts});
  assert.equal(first.blocked,1,JSON.stringify(first));
  assert.equal(legacyProviderCalls,0);
  assert.equal(canonicalBindings,0);
  assert.equal(((await c.store.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS,bound.jobId))!.payload as {code:string}).code,'weekly_preproduction_collection_budget_authorization_required','a missing token must not obscure the independent CNY authorization gate');
  process.env.APIFY_TOKEN='isolated-unusable-test-placeholder';
  const second=await runWeeklyPreproductionProducerScan({store:c.store,now});
  assert.equal(second.blocked,1,JSON.stringify(second));
  assert.equal(((await c.store.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS,bound.jobId))!.payload as {code:string}).code,'weekly_preproduction_collection_budget_authorization_required');
  const reopened=reopenWeeklyEnterpriseFactFixtureStore(file);
  const third=await runWeeklyPreproductionProducerScan({store:reopened,now});
  assert.equal(third.blocked,1,JSON.stringify(third));
  assert.equal(((await reopened.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS,bound.jobId))!.payload as {code:string}).code,'weekly_preproduction_collection_budget_authorization_required');
  // An isolated synthetic amount is deliberately not sufficient to claim a
  // complete Actor + platform + dataset CNY bound for this production path.
  await issueWeeklyAccountCollectionBudgetAuthorization({store:reopened,tenantId:'tenant-a',actorUserId:'owner',programId:'program-a',packageId:'package-a',packageVersion:1,scopeId:'golden-account-scope',scopeVersion:3,scopeHash:socialRequestHash(scopePayload),actorId:'clockworks/tiktok-scraper',totalLimitCny:5,perRunLimitCny:2,expiresAt:new Date(Date.now()+86400000).toISOString()});
  delete process.env.APIFY_TOKEN;
  const defaultPorts=createDefaultWeeklyPreproductionPorts(reopened);
  assert.equal(defaultPorts.discoveryDependencies?.dataStore,reopened,'the production composition is bound to the scan store');
  const fourth=await runWeeklyPreproductionProducerScan({store:reopened,now,...defaultPorts});
  assert.equal(fourth.blocked,1,JSON.stringify(fourth));
  assert.equal(((await reopened.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS,bound.jobId))!.payload as {code:string}).code,'weekly_preproduction_collection_cost_ceiling_unverified','a signed amount still cannot bypass missing all-cost proof, with or without a token');
  const twiceReopened=reopenWeeklyEnterpriseFactFixtureStore(file);
  const fifth=await runWeeklyPreproductionProducerScan({store:twiceReopened,now});
  assert.equal(fifth.blocked,1,JSON.stringify(fifth));
  assert.equal(((await twiceReopened.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS,bound.jobId))!.payload as {code:string}).code,'weekly_preproduction_collection_cost_ceiling_unverified');
  let providerCalls=0;
  await assert.rejects(executeApprovedDiscoveryRun({tenantId:'tenant-a',triggerType:'manual',expectedScopeId:'golden-account-scope',expectedScopeVersion:3,requestedModes:['account'],originalRun:{key:bound.originalRunKey,scopeHash:socialRequestHash(scopePayload)}},{dataStore:twiceReopened,async crawl(){providerCalls++;throw Error('provider must not be called');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('evidence worker must not be called');}}),/weekly_preproduction_collection_cost_ceiling_unverified/);
  assert.equal(providerCalls,0,'service must enforce its own fresh paid gate, independent of producer');
  assert.equal((await twiceReopened.list('social_discovery_runs')).totalItems,0);
  assert.equal((await twiceReopened.list('social_discovery_daily_reservations')).totalItems,0);
  assert.equal((await twiceReopened.list('social_weekly_preproduction_retry_attempts')).totalItems,0);
  assert.equal((await twiceReopened.list('social_weekly_candidate_canonical_media_operations')).totalItems,0);
  assert.equal(legacyProviderCalls,0);
  assert.equal(canonicalBindings,0);
 }finally{if(originalToken===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=originalToken;}
});
