import test from 'node:test';
import assert from 'node:assert/strict';
import type {Record_} from '../storage/datastore.js';
import {prepareWeeklyEnterpriseFactFixture} from './weeklyEnterpriseFactSupplement.fixture.js';
import {bindWeeklyPreproductionAuthority,runWeeklyPreproductionProducerScan,WEEKLY_PREPRODUCTION_JOBS} from './weeklyPreproductionProducer.js';
import {supplementConsumerHash} from '../socialPrograms/weeklySupplementRequests.js';
import {reserveDailyCollection} from '../socialDiscovery/dailyCollectionQuota.js';
import {WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS} from './weeklyQualifiedShortfallReceipt.js';

test('fewer than five current-run metadata candidates and exhausted real quota persist shortfall without analysis, retry, or a second provider call',async t=>{
 const c=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-18T03:00:00.000Z');
 c.pkg.socialContentPackage.originalContentTarget=5;
 await c.store.update('social_weekly_operating_packages',(await c.store.list<Record_>('social_weekly_operating_packages')).items[0]!.id,{payload:c.pkg});
 c.task.schedule.stepKind='benchmark_collection';c.task.status='blocked';c.task.ownBlockingReasons=['weekly_preproduction_authority_required'];
 await c.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:1,task_id:c.task.taskId,status:c.task.status,idempotency_key:c.task.idempotencyKey,payload:c.task});
 await c.store.create('social_discovery_scopes',{id:'shortfall-scope',tenant_id:'tenant-a',created_by:'owner',version:1,status:'active',payload:{approval:{status:'approved',scopeVersion:1,approvedBy:'user'},market:'US',language:'en',keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}},keywords:[],discoveryBrief:{discoveryBriefId:'shortfall-brief',keywordSetId:'shortfall-keywords',keywordSetVersion:1,productRef:'product',market:'US',audience:'buyer',discoverySeedIds:[],trackedSceneIds:[],competitorAccounts:[],discoveryModes:['momentum'],platforms:['tiktok'],lookbackDays:7,resultLimit:5,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{momentum:{enabled:true,sourceRefs:['query'],platforms:['tiktok'],resultLimit:5,refreshIntervalMinutes:60,budgetLimitCny:null}}}}});
 await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(c.task),discovery:{scopeId:'shortfall-scope',scopeVersion:1,requestedModes:['momentum']}});
 assert.equal(await reserveDailyCollection(c.store,{tenantId:'tenant-a',runId:'other-daily-work',requestKey:'already-used',requested:7,now}),7);
 const historicalOperation={id:'consumed-model-op',tenant_id:'tenant-a',candidate_id:'v1',state:'submitted_or_unknown',record_hash:'historical-proof'};
 await c.store.create('social_weekly_candidate_revised_analysis_operations',historicalOperation);
 const beforeOperation=await c.store.getById<Record_>('social_weekly_candidate_revised_analysis_operations',historicalOperation.id);
 const priorToken=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='controlled-test-port';let crawlCalls=0,analysisCalls=0;
 try{
  const deps={dataStore:c.store,async crawl(input:{discoveryContext:{runId:string;scopeId:string;scopeVersion:number;mode:string;queryRef:string}}){crawlCalls++;
   for(const id of ['v1','v2','v3'])await c.store.create('trend_videos',{id,tenantId:'tenant-a',platform:'tiktok',sourceUrl:`https://www.tiktok.com/@factory/video/${id}`,aiAnalysis:JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[{...input.discoveryContext,observedAt:now.toISOString()}]})});
   return{platform:'tiktok' as const,keyword:'query',imported:3,refreshed:0,skipped:0,skippedExisting:0,returnedExisting:0,requested:3,total:3,source:'r3' as const,message:'',candidateIds:['v1','v2','v3'],items:[]};},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return ['v1','v2','v3'].map(candidateId=>({candidateId}));}},async runCandidateEvidence(){return{accepted:[],suggestions:['v1','v2','v3'].map(candidateId=>({candidateId})),failed:[]};}} as any;
  const first=await runWeeklyPreproductionProducerScan({store:c.store,now,discoveryDependencies:deps,candidatePorts:{analyze:async()=>{analysisCalls++;}}});
  assert.equal(first.failed,0,JSON.stringify(first));assert.equal(first.blocked,1,JSON.stringify(first));
  assert.equal(crawlCalls,1);assert.equal(analysisCalls,0);
  const receipts=await c.store.list<Record_>(WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS);assert.equal(receipts.totalItems,1,JSON.stringify({jobs:(await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items.map(row=>({code:(row.payload as {code:string}).code,status:(row.payload as {status:string}).status})),runs:(await c.store.list<Record_>('social_discovery_runs')).items.map(row=>({status:row.status,stopReason:row.stopReason,modeStats:row.modeStats,evidenceOutcomes:row.evidenceOutcomes}))}));
  const receipt=receipts.items[0]!.payload as {observedCandidateIds:string[];remainingAuthorizedCapacity:number;authorizesExecution:boolean};
  assert.deepEqual(receipt.observedCandidateIds,['v1','v2','v3']);assert.equal(receipt.remainingAuthorizedCapacity,0);assert.equal(receipt.authorizesExecution,false);
  assert.equal(((await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items[0]!.payload as {code:string}).code,'weekly_qualified_quota_exhausted');
  const restart=await runWeeklyPreproductionProducerScan({store:c.store,now,discoveryDependencies:deps,candidatePorts:{analyze:async()=>{analysisCalls++;}}});
  assert.equal(restart.failed,0,JSON.stringify(restart));assert.equal(crawlCalls,1);assert.equal(analysisCalls,0);
  const after=await c.store.list<Record_>(WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS);assert.equal(after.totalItems,1,JSON.stringify(after.items.map(row=>({runHash:(row.payload as {runHash:string}).runHash,jobId:(row.payload as {jobId:string}).jobId,observedCandidateIds:(row.payload as {observedCandidateIds:string[]}).observedCandidateIds}))));
  assert.equal((await c.store.list('social_weekly_preproduction_retry_attempts')).totalItems,0);
  const nextDay=await runWeeklyPreproductionProducerScan({store:c.store,now:new Date('2026-10-18T16:01:00.000Z'),discoveryDependencies:deps,candidatePorts:{analyze:async()=>{analysisCalls++;}}});
  assert.equal(nextDay.failed,0,JSON.stringify(nextDay));
  assert.equal(((await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items[0]!.payload as {code:string}).code,'weekly_qualified_admission_unverified','new ordinary capacity removes the quota blocker but does not imply admission or provider authorization');
  assert.equal(crawlCalls,1);assert.equal(analysisCalls,0);
  assert.equal((await c.store.list(WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS)).totalItems,1,'historical shortfall remains immutable');
  assert.deepEqual(await c.store.getById<Record_>('social_weekly_candidate_revised_analysis_operations',historicalOperation.id),beforeOperation,'a prior consumed exact-analysis operation is never replayed or rewritten');
 }finally{if(priorToken===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=priorToken;}
});
