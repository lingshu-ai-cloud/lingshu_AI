import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWeeklyEnterpriseFactFixture } from './weeklyEnterpriseFactSupplement.fixture.js';
import { supplementConsumerHash } from '../socialPrograms/weeklySupplementRequests.js';
import { bindWeeklyPreproductionAuthority, runWeeklyPreproductionProducerScan, readWeeklyPreproductionExecutionGate, listWeeklyPreproductionJobs, WEEKLY_PREPRODUCTION_JOBS, advanceWeeklyCandidatePostAnalysisChain, type WeeklyPreproductionJob } from './weeklyPreproductionProducer.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import {reserveDailyCollection} from '../socialDiscovery/dailyCollectionQuota.js';
import {PREPRODUCTION_RETRY_ATTEMPTS} from './weeklyPreproductionRetryAttempts.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
async function setup(t: Parameters<typeof prepareWeeklyEnterpriseFactFixture>[0]) { const c = await prepareWeeklyEnterpriseFactFixture(t); c.task.schedule.stepKind = 'business_outline'; c.task.workflowKind = 'readiness'; c.task.scope = 'package'; c.task.inputSnapshot = {}; await c.store.create('social_weekly_execution_tasks', { tenant_id: c.task.tenantId, program_id: c.task.programId, package_id:c.task.packageId,package_version:c.task.packageVersion,status:c.task.status,task_id: c.task.taskId, idempotency_key: c.task.idempotencyKey, payload: c.task }); return c; }
test('five metadata accepts across a resumed parent and child are analyzed per original run',async()=>{
 const rootKey='original-account-run',rootRunId=`weekly_discovery_${socialRequestHash({tenantId:'tenant',key:rootKey})}`;
 const rootJob={jobId:'root-job',recordHash:'root-hash',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,consumerTaskId:'task',originalRunKey:rootKey,authority:{scopeId:'scope',scopeVersion:3}} as WeeklyPreproductionJob;
 const rootRun={id:'root-run-row',runId:rootRunId,tenant_id:'tenant',discoveryScopeId:'scope',discoveryScopeVersion:3,scopeSnapshot:{weeklyProducer:{key:rootKey}},evidenceOutcomes:{account:{acceptedCandidateIds:['a','b','c','d']}}} as unknown as SocialInspirationCollectionRun;
 const childKey='account-continuation',childRunId=`weekly_discovery_${socialRequestHash({tenantId:'tenant',key:childKey})}`;
 const childJob={...rootJob,jobId:'child-job',originalRunKey:childKey,retry:{parentRunId:rootRunId,parentRunHash:socialRequestHash(rootRun),rootJobId:rootJob.jobId,rootJobHash:rootJob.recordHash}} as WeeklyPreproductionRetryAttempt;
 const childRun={id:'child-run-row',runId:childRunId,tenant_id:'tenant',discoveryScopeId:'scope',discoveryScopeVersion:3,scopeSnapshot:{weeklyProducer:{key:childKey,retry:{parentRunId:rootRunId,parentRunHash:socialRequestHash(rootRun)}}},evidenceOutcomes:{account:{acceptedCandidateIds:['e']}}} as unknown as SocialInspirationCollectionRun;
 const rows=[rootRun,childRun],calls:Array<{jobId:string;runId:string;ids:string[];exact:boolean;canonical:boolean}>=[];
 const store={async list(_collection:string,query:{where?:Record<string,unknown>}){const found=rows.filter(row=>row.runId===query.where?.runId);return {items:found,totalItems:found.length,totalPages:1,page:1,perPage:2};}} as unknown as DataStore;
 const exactAnalysisPorts={authorize:async()=>null},canonicalMedia={bindingForCandidate:async()=>null};
 const advance=async(args:{job:WeeklyPreproductionJob;run:SocialInspirationCollectionRun;acceptedCandidateIds:string[];exactAnalysisPorts?:unknown;canonicalMedia?:unknown})=>{calls.push({jobId:args.job.jobId,runId:args.run.runId,ids:args.acceptedCandidateIds,exact:args.exactAnalysisPorts===exactAnalysisPorts,canonical:args.canonicalMedia===canonicalMedia});return [];};
 const {id:_storedId,tenant_id:_storedTenant,...emittedChildRun}=childRun as unknown as Record_;
 const input={store,rootJob,job:childJob,run:emittedChildRun as unknown as SocialInspirationCollectionRun,pkg:{packageId:'package',programId:'program',version:1} as WeeklyOperatingPackage,mediaRoot:'/unread',acceptedCandidateIds:['a','b','c','d','e'],exactAnalysisPorts,canonicalMedia,advance:advance as typeof import('./weeklyCandidatePostAnalysis.js').advanceWeeklyCandidatePostAnalysis};
 await advanceWeeklyCandidatePostAnalysisChain(input);
 assert.deepEqual(calls,[{jobId:'root-job',runId:rootRunId,ids:['a','b','c','d'],exact:true,canonical:true},{jobId:'child-job',runId:childRunId,ids:['e'],exact:true,canonical:true}]);
 calls.length=0;
 await assert.rejects(advanceWeeklyCandidatePostAnalysisChain({...input,acceptedCandidateIds:['a','b','c','d','wrong']}),/weekly_postanalysis_chain_accepted_changed/);
 assert.equal(calls.length,0,'changed aggregate identity must fail before any progress write');
 await assert.rejects(advanceWeeklyCandidatePostAnalysisChain({...input,run:{...input.run,evidenceOutcomes:{account:{acceptedCandidateIds:['a','b','c','d','e'],acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}}}),/weekly_postanalysis_chain_run_changed/);
 assert.equal(calls.length,0,'a changed run outcome cannot borrow the persisted chain');
});
test('five same-run accepted candidates reach persisted post-analysis despite storage row metadata',async()=>{
 const key='five-same-run',runId=`weekly_discovery_${socialRequestHash({tenantId:'tenant',key})}`;
 const job={jobId:'job',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,consumerTaskId:'task',originalRunKey:key,authority:{scopeId:'scope',scopeVersion:3}} as WeeklyPreproductionJob;
 const emitted={runId,discoveryScopeId:'scope',discoveryScopeVersion:3,status:'succeeded',scopeSnapshot:{weeklyProducer:{key}},evidenceOutcomes:{account:{acceptedCandidateIds:['a','b','c','d','e']}}} as unknown as SocialInspirationCollectionRun;
 const persisted={...emitted,id:'db-row',tenant_id:'tenant',created:'2026-10-19T00:00:00Z'};
 const store={async list(_collection:string,query:{where?:Record<string,unknown>}){const items=query.where?.runId===runId?[persisted]:[];return {items,totalItems:items.length,totalPages:1,page:1,perPage:2};}} as unknown as DataStore;
 const calls:string[][]=[];
 const advance=async(args:{run:SocialInspirationCollectionRun;acceptedCandidateIds:string[]})=>{assert.equal(args.run,persisted);calls.push(args.acceptedCandidateIds);return [];};
 const input={store,rootJob:job,job,run:emitted,pkg:{packageId:'package',programId:'program',version:1} as WeeklyOperatingPackage,mediaRoot:'/unread',acceptedCandidateIds:['a','b','c','d','e'],advance:advance as typeof import('./weeklyCandidatePostAnalysis.js').advanceWeeklyCandidatePostAnalysis};
 await advanceWeeklyCandidatePostAnalysisChain(input);
 assert.deepEqual(calls,[['a','b','c','d','e']]);
 calls.length=0;
 await assert.rejects(advanceWeeklyCandidatePostAnalysisChain({...input,run:{...emitted,scopeSnapshot:{weeklyProducer:{key:'other'}} as unknown as SocialInspirationCollectionRun['scopeSnapshot']}}),/weekly_postanalysis_chain_run_changed/);
 assert.deepEqual(calls,[]);
});
test('missing conversion and sales handoff only defer outbound; formal fact outline is delivered without goal approval', async t => {
 const c=await setup(t);
 const account=(await c.store.list<Record_>('social_owned_accounts')).items[0]!;
 const payload=structuredClone(account.payload) as Record<string,unknown>; delete payload.conversionRoute;
 await c.store.update('social_owned_accounts',account.id,{payload});
 delete c.pkg.operatingDecisionSnapshotRef; delete c.pkg.businessContentGoalRef;
 await c.store.update('social_weekly_operating_packages',(await c.store.list<Record_>('social_weekly_operating_packages')).items[0]!.id,{payload:c.pkg});
 await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'outline',expectedConsumerInputHash:supplementConsumerHash(c.task)});
 const report=await runWeeklyPreproductionProducerScan({store:c.store});
 assert.equal(report.succeeded,1,JSON.stringify(report));
 const job=(await listWeeklyPreproductionJobs({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1}))[0]!;
 assert.equal(job.outlineReadiness?.scope,'fact_backed_outline');
 assert.deepEqual(job.outlineReadiness?.deferredOutboundBlockers,['conversion_route_required','sales_owner_required']);
 assert.equal(job.outlineReadiness?.authorizesProduction,false);
 assert.equal(job.outlineReadiness?.authorizesPublishing,false);
 assert.equal(job.outlineReadiness?.authorizesCustomerMessages,false);
 const goals=(await c.store.list<Record_>('social_business_content_goals',{perPage:100})).items.map(r=>r.payload as {goalId:string;version:number;status:string});
 assert.equal(goals.find(g=>g.goalId===job.outlineReadiness?.goalRef.id&&g.version===job.outlineReadiness?.goalRef.version)?.status,'blocked');
 assert.equal((await readWeeklyPreproductionExecutionGate(c.store,c.task)).ready,true);
 assert.equal((await runWeeklyPreproductionProducerScan({store:c.store})).succeeded,0,'same original outline must recover without regenerating');
 const {runSocialWeeklyExecutionScan}=await import('./socialWeeklyExecutionRuntime.js');
 const {createDefaultWeeklyExecutionAdapters}=await import('./weeklyExecutionAdapters.js');
 const scan=await runSocialWeeklyExecutionScan({dataStore:c.store,adapters:createDefaultWeeklyExecutionAdapters(c.store)});
 assert.equal(scan.succeeded,1,JSON.stringify(scan));
 const delivered=(await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.payload as typeof c.task;
 assert.equal(delivered.status,'succeeded');
 const {validateWeeklyExecutionResults}=await import('./socialWeeklyResultValidation.js');
 await validateWeeklyExecutionResults(c.store,delivered,delivered.resultRefs);
 await assert.rejects(validateWeeklyExecutionResults(c.store,{...delivered,schedule:{...delivered.schedule,stepKind:'video_generation'}},delivered.resultRefs),{code:'weekly_preproduction_step_invalid'});
});
test('UI discovery approval role uses its recorded authenticated actor, not a fictional user ID', async t => {
 const c=await setup(t);c.task.schedule.stepKind='benchmark_collection';
 await c.store.update('social_weekly_execution_tasks',(await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.id,{payload:c.task});
 const scope={id:'ui-scope',tenant_id:'tenant-a',created_by:'owner',version:1,status:'active',payload:{approval:{status:'approved',approvedBy:'user',scopeVersion:1},discoveryBrief:{discoveryModes:['momentum'],modePolicies:{momentum:{enabled:true}}}}};
 await c.store.create('social_discovery_scopes',scope);
 const args={store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'discovery' as const,expectedConsumerInputHash:supplementConsumerHash(c.task),discovery:{scopeId:'ui-scope',scopeVersion:1,requestedModes:['momentum' as const]}};
 assert.equal((await bindWeeklyPreproductionAuthority(args)).status,'bound');
 const mismatched={...scope,id:'mismatch',payload:{...scope.payload,approval:{...scope.payload.approval,approvedByUserId:'another-user'}}};
 await c.store.create('social_discovery_scopes',mismatched);
 await assert.rejects(bindWeeklyPreproductionAuthority({...args,discovery:{...args.discovery,scopeId:'mismatch'}}),/approver_mismatch/);
 await c.store.create('social_discovery_scopes',{...scope,id:'missing-actor',created_by:undefined});
 await assert.rejects(bindWeeklyPreproductionAuthority({...args,discovery:{...args.discovery,scopeId:'missing-actor'}}),/scope_not_approved/);
});
test('new discovery submission requires real upstream delivery and its execution window',async t=>{
 const c=await setup(t);c.task.schedule.stepKind='benchmark_collection';c.task.dependsOnTaskIds=['unsettled-parent'];
 await c.store.update('social_weekly_execution_tasks',(await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.id,{payload:c.task});
 await c.store.create('social_discovery_scopes',{id:'dependency-scope',tenant_id:'tenant-a',created_by:'owner',version:1,status:'active',payload:{approval:{status:'approved',approvedBy:'user',scopeVersion:1},discoveryBrief:{discoveryModes:['momentum'],modePolicies:{momentum:{enabled:true}}}}});
 await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(c.task),discovery:{scopeId:'dependency-scope',scopeVersion:1,requestedModes:['momentum']}});
 const blocked=await runWeeklyPreproductionProducerScan({store:c.store});assert.equal(blocked.blocked,1);
 let job=(await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items[0]!.payload as {code:string};assert.equal(job.code,'weekly_preproduction_upstream_delivery_required');
 await c.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:1,task_id:'unsettled-parent',payload:{...c.task,taskId:'unsettled-parent',status:'succeeded'}});
 const early=await runWeeklyPreproductionProducerScan({store:c.store,now:new Date('2026-10-11T00:00:00Z')});assert.equal(early.blocked,1);
 job=(await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items[0]!.payload as {code:string};assert.equal(job.code,'weekly_preproduction_execution_window_required');
 assert.equal((await c.store.list('social_discovery_runs')).totalItems,0,'no run/provider submission before dependency and window');
});
test('original daily-limit job cannot buy a child after midnight merely because normal quota reset',async t=>{
 const c=await setup(t),rootDay=new Date('2026-10-18T03:00:00.000Z'),nextDay=new Date('2026-10-18T16:01:00.000Z');
 c.task.schedule.stepKind='benchmark_collection';c.task.status='blocked';c.task.ownBlockingReasons=['weekly_preproduction_authority_required'];
 const taskRow=(await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!;
 await c.store.update('social_weekly_execution_tasks',taskRow.id,{status:c.task.status,payload:c.task});
 await c.store.create('social_discovery_scopes',{id:'daily-scope',tenant_id:'tenant-a',created_by:'owner',version:1,status:'active',payload:{approval:{status:'approved',scopeVersion:1,approvedBy:'user'},market:'US',language:'en',keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}},keywords:[],discoveryBrief:{discoveryBriefId:'daily-brief',keywordSetId:'daily-keywords',keywordSetVersion:1,productRef:'product',market:'US',audience:'buyer',discoverySeedIds:[],trackedSceneIds:[],competitorAccounts:[],discoveryModes:['momentum'],platforms:['tiktok'],lookbackDays:7,resultLimit:1,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{momentum:{enabled:true,sourceRefs:['query'],platforms:['tiktok'],resultLimit:1,refreshIntervalMinutes:60,budgetLimitCny:null}}}}});
 const root=await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(c.task),discovery:{scopeId:'daily-scope',scopeVersion:1,requestedModes:['momentum']}});
 assert.equal(await reserveDailyCollection(c.store,{tenantId:'tenant-a',runId:'another-run',requestKey:'used',requested:10,now:rootDay}),10);
 const oldToken=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='controlled-test-port';let crawlCalls=0;
 const deps={dataStore:c.store,async crawl(){crawlCalls++;return {platform:'tiktok' as const,keyword:'query',imported:0,refreshed:0,skipped:0,skippedExisting:0,returnedExisting:0,requested:1,total:0,source:'r3' as const,message:'',candidateIds:[],items:[]};},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return []; }},async runCandidateEvidence(){return {accepted:[],suggestions:[],failed:[]};}};
 try{
  const blocked=await runWeeklyPreproductionProducerScan({store:c.store,now:rootDay,discoveryDependencies:deps});
  assert.equal(blocked.blocked,1,JSON.stringify(blocked));assert.equal(crawlCalls,0);
  const rootBefore=(await c.store.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS,root.jobId))!;
  assert.equal((rootBefore.payload as {code:string}).code,'daily_collection_limit_reached');
  const resumed=await runWeeklyPreproductionProducerScan({store:c.store,now:nextDay,discoveryDependencies:deps});
  assert.equal(resumed.failed,0,JSON.stringify(resumed));assert.equal(crawlCalls,0);
  const attempts=await c.store.list<Record_>(PREPRODUCTION_RETRY_ATTEMPTS);assert.equal(attempts.totalItems,0);
  const reservations=await c.store.list<Record_>('social_discovery_daily_reservations',{where:{tenant_id:'tenant-a',day:'2026-10-19'}});
  assert.equal(reservations.totalItems,0);
  assert.equal(((await c.store.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS,root.jobId))!.payload as {code:string}).code,'daily_collection_limit_reached');
  await runWeeklyPreproductionProducerScan({store:c.store,now:nextDay,discoveryDependencies:deps});
  assert.equal(crawlCalls,0,'restarted scan cannot turn the quota reset into permission');
  assert.equal((await c.store.list<Record_>(PREPRODUCTION_RETRY_ATTEMPTS)).totalItems,0);
 }finally{if(oldToken===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=oldToken;}
});
test('product scan automatically uses scoped retry grant, preserves failed parent and consumes only real accepted child evidence',async t=>{
 const c=await setup(t),{preproductionPackage,seedPreproductionSupply}=await import('./weeklyPreproductionProducer.fixture.js');
 const pkg=preproductionPackage();pkg.socialContentPackage.publicationTasks[0]!.factRefs=c.authority.goal.publicFactRefs;
 await c.store.update('social_weekly_operating_packages',(await c.store.list<Record_>('social_weekly_operating_packages')).items[0]!.id,{payload:pkg});
 const upstream={...structuredClone(c.task),taskId:'outline-evidence',idempotencyKey:'outline-idempotency',accountId:null,publicationTaskId:null,inputSnapshot:{},status:'queued' as const,ownBlockingReasons:[],schedule:{...c.task.schedule,stepKind:'business_outline' as const}};
 await c.store.create('social_weekly_execution_tasks',{tenant_id:upstream.tenantId,program_id:upstream.programId,package_id:upstream.packageId,package_version:1,task_id:upstream.taskId,status:upstream.status,idempotency_key:upstream.idempotencyKey,payload:upstream});
 await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:upstream.taskId,actorUserId:'owner',kind:'outline',expectedConsumerInputHash:supplementConsumerHash(upstream)});
 c.task.dependsOnTaskIds=[upstream.taskId];
 c.task.schedule.stepKind='benchmark_collection';c.task.status='blocked';c.task.ownBlockingReasons=['weekly_preproduction_authority_required','business_dispatch_required'];
 await c.store.update('social_weekly_execution_tasks',(await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.id,{status:c.task.status,payload:c.task});
 await seedPreproductionSupply(c.store);
 await c.store.create('social_discovery_scopes',{id:'retry-scope',tenant_id:'tenant-a',created_by:'owner',version:1,status:'active',payload:{approval:{status:'approved',scopeVersion:1,approvedBy:'user'},market:'US',language:'en',keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}},keywords:[],discoveryBrief:{discoveryBriefId:'retry-brief',keywordSetId:'retry-keywords',keywordSetVersion:1,productRef:'product',market:'US',audience:'buyer',discoverySeedIds:[],trackedSceneIds:[],competitorAccounts:[],discoveryModes:['momentum'],platforms:['tiktok'],lookbackDays:7,resultLimit:1,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{momentum:{enabled:true,sourceRefs:['query'],platforms:['tiktok'],resultLimit:1,refreshIntervalMinutes:60,budgetLimitCny:null}}}}});
 await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(c.task),discovery:{scopeId:'retry-scope',scopeVersion:1,requestedModes:['momentum']}});
 const old=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='controlled-test-port';let calls=0;
 try{
  const deps={dataStore:c.store,async crawl(){calls++;if(calls===1)throw Error('Apify TikTok HTTP 402 not-enough-usage-to-run-paid-actor');return{platform:'tiktok' as const,keyword:'query',imported:1,refreshed:0,skipped:0,skippedExisting:0,returnedExisting:0,requested:1,total:1,source:'r3' as const,message:'',candidateIds:['video-1'],items:[]};},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[{tenantId:'tenant-a',candidateId:'video-1',discoveryPath:['keyword'] as Array<'keyword'>,evidenceRefs:['source'],g1:{runId:'child',queryRef:'query',discoveryMode:'momentum' as const,sourceUrl:'https://www.tiktok.com/video-1'}}];}},async runCandidateEvidence(){return{accepted:(await c.store.list<import('../socialDiscovery/qualityOrchestration.js').VersionedCandidateEvidence>('social_candidate_evidence')).items,suggestions:[],failed:[]};}};
  const {runSocialWeeklyExecutionScan}=await import('./socialWeeklyExecutionRuntime.js'),{createDefaultWeeklyExecutionAdapters}=await import('./weeklyExecutionAdapters.js');
  const firstScan=await runSocialWeeklyExecutionScan({dataStore:c.store,adapters:createDefaultWeeklyExecutionAdapters(c.store),preproductionPorts:{discoveryDependencies:deps}});
  assert.equal(firstScan.succeeded,1,JSON.stringify(firstScan));assert.equal(calls,0,'collector must wait for real outline worker completion');
  assert.equal((await runWeeklyPreproductionProducerScan({store:c.store,discoveryDependencies:deps})).blocked,1);
  const root=(await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items.find(r=>(r.payload as {kind:string}).kind==='discovery')!,parent=(await c.store.list<Record_>('social_discovery_runs')).items[0]!,{socialRequestHash}=await import('../starter198/socialContentValidation.js');
  const {recordCollectionRetryGrant}=await import('../socialDiscovery/collectionRetryGrant.js'),{collectionBusinessDate}=await import('../socialDiscovery/dailyCollectionQuota.js');
  const now=new Date();
  await recordCollectionRetryGrant(c.store,{tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,parentRunId:String(parent.runId),parentRunHash:socialRequestHash(parent),count:10,businessDate:collectionBusinessDate(now),actorUserId:'owner',authorizedAt:now.toISOString(),authorizationRef:'explicit-test-user-message',authorizationText:'仅本次额外最多10条'});
  const {WEEKLY_INDEPENDENT_ADMISSIONS,independentAdmissionId}=await import('../socialPrograms/weeklyIndependentAdmission.js'),{AUTOMATIC_WEEKLY_SCHEDULES}=await import('../socialPrograms/weeklyAutomaticSchedule.js'),{SCHEDULE_PROPOSALS,scheduleHash}=await import('../socialPrograms/weeklyScheduleSnapshots.js'),{WEEKLY_AUTOMATION_TEMPLATE}=await import('../../shared/weeklyAutomationTemplate.js');
  const s={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1},columns={tenant_id:s.tenantId,program_id:s.programId,package_id:s.packageId,package_version:1};
  await c.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(s),...columns,payload:{...s,actorUserId:'owner',admittedAt:now.toISOString(),mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}});
  const receipt={proposalId:'retry-template',source:'automatic_template',templateVersion:WEEKLY_AUTOMATION_TEMPLATE.version,userApproval:null},proposal={...s,proposalId:'retry-template',inputAuthority:'target_graph_with_automatic_template_capacity',automaticAdoption:receipt,targetGraph:{tasks:[c.task]},capacity:{constraints:{[c.task.taskId]:{availableAt:c.task.schedule.estimatedStartAt}}}};
  await c.store.create(AUTOMATIC_WEEKLY_SCHEDULES,{id:'retry-template-receipt',...columns,payload:receipt,content_hash:socialRequestHash(receipt)});await c.store.create(SCHEDULE_PROPOSALS,{id:'retry-template-proposal',...columns,proposal_id:'retry-template',payload:proposal,content_hash:scheduleHash(proposal)});
  for(const[i,dimension]of['tenant','task_type'].entries())await c.store.create('content_execution_limits',{tenant_id:s.tenantId,limit_scope:dimension,scope_key:i?'social_content_weekly':'*',max_running:3,updated_by:'automatic_template',updated_at:now.toISOString(),created_at:now.toISOString()});
  const resumed=await runSocialWeeklyExecutionScan({dataStore:c.store,adapters:createDefaultWeeklyExecutionAdapters(c.store),preproductionPorts:{discoveryDependencies:deps}});assert.equal(resumed.preproduction.succeeded,1,JSON.stringify(resumed));assert.equal(resumed.succeeded,1,JSON.stringify(resumed));assert.equal(calls,2);
  assert.deepEqual((await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items.find(r=>r.id===root.id),root,'parent job remains historical blocked');
  assert.deepEqual((await c.store.list<Record_>('social_discovery_runs')).items.find(r=>r.id===parent.id),parent,'failed parent receipt is immutable');
  assert.equal((await readWeeklyPreproductionExecutionGate(c.store,c.task)).ready,true);
  const delivered=(await c.store.list<Record_>('social_weekly_execution_tasks')).items.find(r=>r.task_id===c.task.taskId)!.payload as typeof c.task;assert.equal(delivered.status,'succeeded');assert.deepEqual(delivered.dependsOnTaskIds,[upstream.taskId]);
  const records=await listWeeklyPreproductionJobs({store:c.store,...s});assert.equal(records.filter(r=>r.consumerTaskId===c.task.taskId&&r.activeForConsumer).length,1);assert.notEqual(records.find(r=>r.consumerTaskId===c.task.taskId&&r.activeForConsumer)!.jobId,(root.payload as {jobId:string}).jobId);
  const express=(await import('express')).default,{createSocialWeeklyProducerEvidenceRouter}=await import('../routes/socialWeeklyProducerEvidence.js'),app=express();app.use((_req,res,next)=>{Object.assign(res.locals,{tenantId:'tenant-a',userId:'owner'});next();});app.use('/programs/:programId/packages/:packageId/producer-evidence',createSocialWeeklyProducerEvidenceRouter(c.store));
  const http=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>http.once('listening',resolve));
  try{const address=http.address();assert(address&&typeof address==='object');const response=await fetch(`http://127.0.0.1:${address.port}/programs/program-a/packages/package-a/producer-evidence?version=1`);assert.equal(response.status,200);const body=await response.json();assert.equal(body.items.preproduction.filter((r:{consumerTaskId:string;activeForConsumer:boolean})=>r.consumerTaskId===c.task.taskId&&r.activeForConsumer).length,1);assert.equal(body.bindingOptions.filter((r:{taskId:string})=>r.taskId===c.task.taskId).length,0,'completed consumer is not duplicated as a new binding option');}finally{await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));}
  const {auditWeeklyTasks}=await import('../socialPrograms/weeklyTaskAudit.js'),audit=await auditWeeklyTasks(c.store,[delivered]);assert.equal(audit.items[0]!.currentPreproduction?.ready,true);assert.equal(audit.items[0]!.currentPreproduction?.retryParentRunId,parent.runId);
  const planning=(await c.store.list<Record_>('social_weekly_agent_planning')).items.at(-1)!.payload as {directorAnalyses:unknown[]};assert.equal(planning.directorAnalyses.length,1);
  await runWeeklyPreproductionProducerScan({store:c.store,discoveryDependencies:deps});assert.equal(calls,2,'recovery never resubmits original or child');
  const reservations=(await c.store.list<Record_>('social_discovery_daily_reservations')).items;
  assert.equal(reservations.filter(r=>!r.retry_grant_id).reduce((n,r)=>n+Number(r.count),0),1);assert.equal(reservations.filter(r=>r.retry_grant_id).reduce((n,r)=>n+Number(r.count),0),1);
 }finally{if(old===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=old;}
});
test('one shared discovery leader owns the granted retry while three followers reuse its evidence after restart',async t=>{
 const c=await setup(t),{preproductionPackage,seedPreproductionSupply}=await import('./weeklyPreproductionProducer.fixture.js');
 const pkg=preproductionPackage();pkg.socialContentPackage.publicationTasks[0]!.factRefs=c.authority.goal.publicFactRefs;
 await c.store.update('social_weekly_operating_packages',(await c.store.list<Record_>('social_weekly_operating_packages')).items[0]!.id,{payload:pkg});
 const upstream={...structuredClone(c.task),taskId:'shared-outline',idempotencyKey:'shared-outline',accountId:null,publicationTaskId:null,inputSnapshot:{},status:'queued' as const,ownBlockingReasons:[],schedule:{...c.task.schedule,stepKind:'business_outline' as const}};
 await c.store.create('social_weekly_execution_tasks',{tenant_id:upstream.tenantId,program_id:upstream.programId,package_id:upstream.packageId,package_version:1,task_id:upstream.taskId,status:upstream.status,idempotency_key:upstream.idempotencyKey,payload:upstream});
 await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:upstream.taskId,actorUserId:'owner',kind:'outline',expectedConsumerInputHash:supplementConsumerHash(upstream)});
 assert.equal((await runWeeklyPreproductionProducerScan({store:c.store})).succeeded,1);
 const {runSocialWeeklyExecutionScan}=await import('./socialWeeklyExecutionRuntime.js'),{createDefaultWeeklyExecutionAdapters}=await import('./weeklyExecutionAdapters.js');
 assert.equal((await runSocialWeeklyExecutionScan({dataStore:c.store,adapters:createDefaultWeeklyExecutionAdapters(c.store)})).succeeded,1);
 await seedPreproductionSupply(c.store);
 await c.store.create('social_discovery_scopes',{id:'shared-retry-scope',tenant_id:'tenant-a',created_by:'owner',version:1,status:'active',payload:{approval:{status:'approved',scopeVersion:1,approvedBy:'user'},market:'US',language:'en',keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}},keywords:[],discoveryBrief:{discoveryBriefId:'shared-retry-brief',keywordSetId:'shared-retry-keywords',keywordSetVersion:1,productRef:'product',market:'US',audience:'buyer',discoverySeedIds:[],trackedSceneIds:[],competitorAccounts:[],discoveryModes:['momentum'],platforms:['tiktok'],lookbackDays:7,resultLimit:1,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{momentum:{enabled:true,sourceRefs:['query'],platforms:['tiktok'],resultLimit:1,refreshIntervalMinutes:60,budgetLimitCny:null}}}}});
 const discoveryTasks=[c.task,...[1,2,3].map(index=>({...structuredClone(c.task),taskId:`shared-discovery-${index}`,idempotencyKey:`shared-discovery-${index}`}))];
 for(const [index,task] of discoveryTasks.entries()){
  task.dependsOnTaskIds=[upstream.taskId];task.schedule.stepKind='benchmark_collection';task.status='blocked';task.ownBlockingReasons=['weekly_preproduction_authority_required'];
  if(index===0){const row=(await c.store.list<Record_>('social_weekly_execution_tasks',{where:{task_id:c.task.taskId}})).items[0]!;await c.store.update('social_weekly_execution_tasks',row.id,{status:task.status,payload:task});}
  else await c.store.create('social_weekly_execution_tasks',{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:1,task_id:task.taskId,status:task.status,idempotency_key:task.idempotencyKey,payload:task});
  await bindWeeklyPreproductionAuthority({store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:task.taskId,actorUserId:'owner',kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(task),discovery:{scopeId:'shared-retry-scope',scopeVersion:1,requestedModes:['momentum']}});
 }
 const roots=(await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items.filter(row=>(row.payload as {kind:string}).kind==='discovery');
 assert.equal(roots.length,4);
 const old=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='controlled-test-port';let calls=0;
 try{
  const deps={dataStore:c.store,async crawl(){calls++;if(calls===1)throw Error('Apify TikTok HTTP 402 not-enough-usage-to-run-paid-actor');return{platform:'tiktok' as const,keyword:'query',imported:1,refreshed:0,skipped:0,skippedExisting:0,returnedExisting:0,requested:1,total:1,source:'r3' as const,message:'',candidateIds:['video-1'],items:[]};},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[{tenantId:'tenant-a',candidateId:'video-1',discoveryPath:['keyword'] as Array<'keyword'>,evidenceRefs:['source'],g1:{runId:'shared-child',queryRef:'query',discoveryMode:'momentum' as const,sourceUrl:'https://www.tiktok.com/video-1'}}];}},async runCandidateEvidence(){return{accepted:(await c.store.list<import('../socialDiscovery/qualityOrchestration.js').VersionedCandidateEvidence>('social_candidate_evidence')).items,suggestions:[],failed:[]};}};
  const first=await runWeeklyPreproductionProducerScan({store:c.store,discoveryDependencies:deps});assert.equal(first.failed,0,JSON.stringify(first));assert.equal(calls,1,'only the deterministic leader submits the original collection');
  const runs=await c.store.list<Record_>('social_discovery_runs');assert.equal(runs.totalItems,1,'followers never create original runs');
  const parent=runs.items[0]!,parentKey=String((((parent.scopeSnapshot as {weeklyProducer?:{key?:string}})?.weeklyProducer)?.key));
  const leader=roots.find(row=>(row.payload as {originalRunKey:string}).originalRunKey===parentKey),followers=roots.filter(row=>row!==leader);assert.ok(leader);assert.equal(followers.length,3);
  const leaderPayload=leader.payload as {consumerTaskId:string};
  const {recordCollectionRetryGrant}=await import('../socialDiscovery/collectionRetryGrant.js'),{collectionBusinessDate}=await import('../socialDiscovery/dailyCollectionQuota.js'),{socialRequestHash}=await import('../starter198/socialContentValidation.js');
  const now=new Date(),grantInput={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,parentRunId:String(parent.runId),parentRunHash:socialRequestHash(parent),count:10,businessDate:collectionBusinessDate(now),actorUserId:'owner',authorizedAt:now.toISOString(),authorizationRef:'shared-leader-user-authorization',authorizationText:'本次共享采集合计最多10条'};
  const followerGrant=await recordCollectionRetryGrant(c.store,{...grantInput,taskId:String((followers[0]!.payload as {consumerTaskId:string}).consumerTaskId)});
  assert.equal(followerGrant.taskId,leaderPayload.consumerTaskId,'a follower authorization is normalized to the shared leader');
  assert.equal((await c.store.list('social_discovery_retry_grants')).totalItems,1);
  assert.equal((await recordCollectionRetryGrant(c.store,{...grantInput,taskId:leaderPayload.consumerTaskId})).grantId,followerGrant.grantId);
  const resumed=await runWeeklyPreproductionProducerScan({store:c.store,now,discoveryDependencies:deps});assert.equal(resumed.failed,0,JSON.stringify(resumed));
  await runWeeklyPreproductionProducerScan({store:c.store,now,discoveryDependencies:deps});
  assert.equal(calls,2,'restart reuses the one child submission and never submits for followers');
  const attempts=await c.store.list<Record_>(PREPRODUCTION_RETRY_ATTEMPTS);assert.equal(attempts.totalItems,1);assert.equal(attempts.items[0]!.root_job_id,leader.id);
  const allRuns=await c.store.list<Record_>('social_discovery_runs');assert.equal(allRuns.totalItems,2,'one parent and one child are the complete shared lineage');
  assert.equal((await c.store.list('social_discovery_retry_grants')).totalItems,1);
  const granted=(await c.store.list<Record_>('social_discovery_daily_reservations')).items.filter(row=>row.retry_grant_id);assert.ok(granted.length>0);assert.ok(granted.reduce((sum,row)=>sum+Number(row.count),0)<=10);
  for(const task of discoveryTasks){const gate=await readWeeklyPreproductionExecutionGate(c.store,task);assert.equal(gate.ready,true,task.taskId);assert.deepEqual(gate.resultRefs,(await readWeeklyPreproductionExecutionGate(c.store,discoveryTasks[0]!)).resultRefs);}
  assert.equal(followers.some(row=>(attempts.items[0]!.payload as {retry:{rootJobId:string}}).retry.rootJobId===row.id),false);
 }finally{if(old===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=old;}
});
test('real bound outline is consumed and validated before downstream planning dispatch; forged refs still fail',async t=>{
 const c=await setup(t);
 await bindWeeklyPreproductionAuthority({store:c.store,tenantId:c.task.tenantId,programId:c.task.programId,packageId:c.task.packageId,packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'outline',expectedConsumerInputHash:supplementConsumerHash(c.task)});
 const {runSocialWeeklyExecutionScan}=await import('./socialWeeklyExecutionRuntime.js'),{createDefaultWeeklyExecutionAdapters}=await import('./weeklyExecutionAdapters.js'),{validateWeeklyExecutionResults}=await import('./socialWeeklyResultValidation.js');
 const result=await runSocialWeeklyExecutionScan({dataStore:c.store,adapters:createDefaultWeeklyExecutionAdapters(c.store)});
 assert.equal(result.succeeded,1,JSON.stringify(result));assert.equal(result.failed,0);assert.equal(result.blocked,0);
 const task=(await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.payload as typeof c.task;
 assert.equal(task.status,'succeeded');assert.equal(task.resultRefs[0]?.id,c.authority.snapshot.snapshotId);
 const plans=await c.store.list<Record_>('social_weekly_agent_planning');
 assert(plans.items.every(row=>{const p=row.payload as {status:string;userConfirmation?:unknown;dispatch?:unknown};return p.status!=='dispatched'&&!p.userConfirmation&&!p.dispatch;}),'outline proof must not fabricate a confirmation or dispatch');
 await assert.rejects(validateWeeklyExecutionResults(c.store,task,[{...task.resultRefs[0]!,id:'forged'}]),{code:'weekly_preproduction_result_unverified'});
 await assert.rejects(validateWeeklyExecutionResults(c.store,{...task,schedule:{...task.schedule,stepKind:'video_generation'}},task.resultRefs),{code:'weekly_preproduction_step_invalid'});
});
test('formal actor binding makes outline prerequisite independently of dispatch and retains frozen operating authority', async (t) => { const c = await setup(t); assert.equal((await readWeeklyPreproductionExecutionGate(c.store, c.task)).ready, false); const input = { store: c.store, tenantId: c.task.tenantId, programId: c.task.programId, packageId: c.task.packageId, packageVersion: 1, taskId: c.task.taskId, actorUserId: 'owner', kind: 'outline' as const, expectedConsumerInputHash: supplementConsumerHash(c.task) }; const j = await bindWeeklyPreproductionAuthority(input); assert.equal(j.status, 'bound'); const report = await runWeeklyPreproductionProducerScan({ store: c.store }); assert.equal(report.succeeded, 1, JSON.stringify(report)); const gate = await readWeeklyPreproductionExecutionGate(c.store, c.task); assert.equal(gate.ready, true); assert.equal(gate.resultRefs[0]?.id, c.authority.snapshot.snapshotId); assert.equal((await bindWeeklyPreproductionAuthority(input)).jobId, j.jobId); assert.equal((await runWeeklyPreproductionProducerScan({ store: c.store })).succeeded, 0); assert.equal((await listWeeklyPreproductionJobs(input)).length, 1); });
test('cross tenant, changed deadline and corrupt receipt never prove prerequisite', async (t) => { const c = await setup(t); const input = { store: c.store, tenantId: c.task.tenantId, programId: c.task.programId, packageId: c.task.packageId, packageVersion: 1, taskId: c.task.taskId, actorUserId: 'owner', kind: 'outline' as const, expectedConsumerInputHash: supplementConsumerHash(c.task) }; await assert.rejects(bindWeeklyPreproductionAuthority({ ...input, tenantId: 'tenant-b' })); const j = await bindWeeklyPreproductionAuthority(input); await c.store.update(WEEKLY_PREPRODUCTION_JOBS, j.jobId, { record_hash: 'tampered' }); await assert.rejects(readWeeklyPreproductionExecutionGate(c.store, c.task), /corrupt/); assert.equal((await runWeeklyPreproductionProducerScan({ store: c.store })).failed, 1); });
test('unconfirmed enterprise facts persist blocked and only authenticated rebind can restore authority', async (t) => { const c = await setup(t); const row = (await c.store.list<Record_>('tenant_profiles', { where: { tenant_id: 'tenant-a' } })).items[0]!; const p = structuredClone(c.profile); delete p.factVersion; await c.store.update('tenant_profiles', row.id, { profile: p }); const input = { store: c.store, tenantId: c.task.tenantId, programId: c.task.programId, packageId: c.task.packageId, packageVersion: 1, taskId: c.task.taskId, actorUserId: 'owner', kind: 'outline' as const, expectedConsumerInputHash: supplementConsumerHash(c.task) }; const j = await bindWeeklyPreproductionAuthority(input); assert.equal(j.status, 'blocked'); assert.equal((await runWeeklyPreproductionProducerScan({ store: c.store })).blocked, 1); await c.confirm(); assert.equal((await runWeeklyPreproductionProducerScan({ store: c.store })).blocked, 1); assert.equal((await bindWeeklyPreproductionAuthority(input)).status, 'bound'); assert.equal((await runWeeklyPreproductionProducerScan({ store: c.store })).succeeded, 1); });
test('approved M2 scope binds exact consumer, missing credentials persist blocked and empty collection is no_data', async (t) => { const c = await setup(t); c.task.schedule.stepKind = 'benchmark_collection'; await c.store.update('social_weekly_execution_tasks', (await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.id, {status:c.task.status,payload:c.task}); const scopeRow = { id: 'scope-a', tenant_id: 'tenant-a', version: 1, status: 'active', payload: { approval: { status: 'approved', scopeVersion: 1, approvedBy: 'owner' }, market: 'US', language: 'en', keywords: [], discoveryBrief: { discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['momentum'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 1, budgetLimitCny: 0, productionGap: null, createdBy: 'director_agent', modePolicies: { momentum: { enabled: true, sourceRefs: ['query'], platforms: ['tiktok'], resultLimit: 1, refreshIntervalMinutes: 60, budgetLimitCny: 0 } } } } }; await c.store.create('social_discovery_scopes', scopeRow); const input = { store: c.store, tenantId: c.task.tenantId, programId: c.task.programId, packageId: c.task.packageId, packageVersion: 1, taskId: c.task.taskId, actorUserId: 'owner', kind: 'discovery' as const, expectedConsumerInputHash: supplementConsumerHash(c.task), discovery: { scopeId: 'scope-a', scopeVersion: 1, requestedModes: ['momentum' as const] } }; await bindWeeklyPreproductionAuthority(input); const oldToken = process.env.APIFY_TOKEN; delete process.env.APIFY_TOKEN; try {
    assert.equal((await runWeeklyPreproductionProducerScan({ store: c.store })).blocked, 1);
    assert.equal((await readWeeklyPreproductionExecutionGate(c.store, c.task)).ready, false);
    process.env.APIFY_TOKEN = 'controlled-test-port';
    let calls = 0;
    const deps = { dataStore: c.store, async crawl() { calls++; return { platform: 'tiktok' as const, keyword: 'q', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 1, total: 0, source: 'r3' as const, message: '', candidateIds: [], items: [] }; }, candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } }, async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; } };
    const report = await runWeeklyPreproductionProducerScan({ store: c.store, discoveryDependencies: deps });
    assert.equal(report.noData, 1, JSON.stringify(report));
    assert.equal((await readWeeklyPreproductionExecutionGate(c.store, c.task)).ready, false);
    await runWeeklyPreproductionProducerScan({ store: c.store, discoveryDependencies: deps });
    assert.equal(calls, 1, 'same original empty run must not recollect');
}
finally {
    if (oldToken === undefined)
        delete process.env.APIFY_TOKEN;
    else
        process.env.APIFY_TOKEN = oldToken;
} });
test('M1 calls formal operating producer and exact readback recovers lost snapshot acknowledgement without new snapshot', async (t) => { const c = await setup(t); delete c.pkg.operatingDecisionSnapshotRef; delete c.pkg.businessContentGoalRef; const pr = (await c.store.list<Record_>('social_weekly_operating_packages')).items[0]!; await c.store.update('social_weekly_operating_packages', pr.id, { payload: c.pkg }); const input = { store: c.store, tenantId: c.task.tenantId, programId: c.task.programId, packageId: c.task.packageId, packageVersion: 1, taskId: c.task.taskId, actorUserId: 'owner', kind: 'outline' as const, expectedConsumerInputHash: supplementConsumerHash(c.task) }; await bindWeeklyPreproductionAuthority(input); const create = c.store.create.bind(c.store); let lost = true; t.mock.method(c.store, 'create', async (...args: Parameters<typeof c.store.create>) => { const result = await create(...args); if (args[0] === 'social_operating_authority_snapshots' && lost) {
    lost = false;
    throw Error('lost acknowledgement');
} return result; }); const first = await runWeeklyPreproductionProducerScan({ store: c.store }); assert.equal(first.failed, 1, JSON.stringify(first)); assert.match(first.failures[0]!.code, /lost acknowledgement/, JSON.stringify(first)); const n = (await c.store.list('social_operating_authority_snapshots', { perPage: 500 })).totalItems; const restored = await runWeeklyPreproductionProducerScan({ store: c.store }); assert.equal(restored.succeeded, 1, JSON.stringify(restored)); assert.equal((await c.store.list('social_operating_authority_snapshots', { perPage: 500 })).totalItems, n); assert.equal((await readWeeklyPreproductionExecutionGate(c.store, c.task)).ready, true); });
test('M2 formal accepted supply produces director analysis and merged schedule before user confirmation', async (t) => { const c = await setup(t); const { preproductionPackage, seedPreproductionSupply } = await import('./weeklyPreproductionProducer.fixture.js'); const pkg = preproductionPackage(); pkg.socialContentPackage.publicationTasks[0]!.factRefs = c.authority.goal.publicFactRefs; await c.store.update('social_weekly_operating_packages', (await c.store.list<Record_>('social_weekly_operating_packages')).items[0]!.id, { payload: pkg }); c.task.schedule.stepKind = 'benchmark_collection'; c.task.status = 'blocked'; c.task.ownBlockingReasons = ['weekly_preproduction_authority_required', 'business_dispatch_required']; await c.store.update('social_weekly_execution_tasks', (await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.id, {status:c.task.status,payload:c.task}); await seedPreproductionSupply(c.store);
    const canonicalVideoUrl='https://www.tiktok.com/@oem_factory/video/7656562868334136589';
    const seededVideo=(await c.store.list<Record_>('trend_videos')).items[0]!;
    await c.store.update('trend_videos',seededVideo.id,{sourceUrl:canonicalVideoUrl});
    const seededAccount=(await c.store.list<Record_>('social_tracked_accounts')).items[0]!;
    await c.store.delete('social_tracked_accounts',seededAccount.id);
    await c.store.create('social_discovery_scopes', { id: 'scope-positive', tenant_id: 'tenant-a', version: 1, status: 'active', payload: { approval: { status: 'approved', scopeVersion: 1, approvedBy: 'owner' }, market: 'US', language: 'en', keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } }, keywords: [], discoveryBrief: { discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['momentum'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 1, budgetLimitCny: 0, productionGap: null, createdBy: 'director_agent', modePolicies: { momentum: { enabled: true, sourceRefs: ['query'], platforms: ['tiktok'], resultLimit: 1, refreshIntervalMinutes: 60, budgetLimitCny: 0 } } } } }); await bindWeeklyPreproductionAuthority({ store: c.store, tenantId: 'tenant-a', programId: 'program-a', packageId: 'package-a', packageVersion: 1, taskId: c.task.taskId, actorUserId: 'owner', kind: 'discovery', expectedConsumerInputHash: supplementConsumerHash(c.task), discovery: { scopeId: 'scope-positive', scopeVersion: 1, requestedModes: ['momentum'] } }); const peer={...structuredClone(c.task),taskId:'benchmark-peer',idempotencyKey:'benchmark-peer-idempotency'};await c.store.create('social_weekly_execution_tasks',{tenant_id:peer.tenantId,program_id:peer.programId,package_id:peer.packageId,package_version:peer.packageVersion,status:peer.status,task_id:peer.taskId,idempotency_key:peer.idempotencyKey,payload:peer});await bindWeeklyPreproductionAuthority({ store: c.store, tenantId: 'tenant-a', programId: 'program-a', packageId: 'package-a', packageVersion: 1, taskId: peer.taskId, actorUserId: 'owner', kind: 'discovery', expectedConsumerInputHash: supplementConsumerHash(peer), discovery: { scopeId: 'scope-positive', scopeVersion: 1, requestedModes: ['momentum'] } }); const old = process.env.APIFY_TOKEN; process.env.APIFY_TOKEN = 'controlled-test-port'; let calls = 0; try {
    const deps = { dataStore: c.store, async crawl() { calls++; return { platform: 'tiktok' as const, keyword: 'query', imported: 1, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 1, total: 1, source: 'r3' as const, message: '', candidateIds: ['video-1'], items: [] }; }, candidateEvidenceAdapter: { async toEvidenceWorkItems() { return [{ tenantId: 'tenant-a', candidateId: 'video-1', discoveryPath: ['keyword'] as Array<'keyword'>, evidenceRefs: ['source'], g1: { runId: 'bound-run', queryRef: 'query', discoveryMode: 'momentum' as const, sourceUrl: 'https://www.tiktok.com/video-1' } }]; } }, async runCandidateEvidence() { const evidence = (await c.store.list<import('../socialDiscovery/qualityOrchestration.js').VersionedCandidateEvidence>('social_candidate_evidence')).items[0]!; return { accepted: [evidence], suggestions: [], failed: [] }; } };
    const {runSocialWeeklyExecutionScan}=await import('./socialWeeklyExecutionRuntime.js');
        const result=await runSocialWeeklyExecutionScan({dataStore:c.store,adapters:{},preproductionPorts:{discoveryDependencies:deps}});const report=result.preproduction;
    assert.equal(report.succeeded, 2, JSON.stringify({ report, jobs: (await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items.map(r => r.payload) }));
    const planner = (await import('../socialPrograms/planningAuthority.js')).createWeeklyPlanningAuthority(c.store);
    const planning = await planner.get('tenant-a', 'program-a', 'package-a', 1);
    assert.equal(planning.status, 'awaiting_confirmation');
    assert.equal(planning.directorAnalyses.length, 1);
    assert.equal(planning.detailedSchedule?.items.length, 1);
    const watched=(await c.store.list<Record_>('social_tracked_accounts')).items;
    assert.equal(watched.length,1);
    assert.equal(watched[0]!.status,'watching');
    assert.equal(watched[0]!.businessConfirmation,undefined);
    const task = (await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.payload as typeof c.task;
    assert.deepEqual(task.ownBlockingReasons, ['business_dispatch_required']);
    assert.equal(task.status, 'blocked');
    assert.equal((await readWeeklyPreproductionExecutionGate(c.store, task)).ready, true);
    assert.equal((await readWeeklyPreproductionExecutionGate(c.store,peer)).ready,true);
    await runSocialWeeklyExecutionScan({dataStore:c.store,adapters:{},preproductionPorts:{discoveryDependencies:deps}});
    assert.equal(calls, 1);
}
finally {
    if (old === undefined)
        delete process.env.APIFY_TOKEN;
    else
        process.env.APIFY_TOKEN = old;
} });
test('late deadline change, successor package and incomplete durable scan never restore old consumer',async t=>{const c=await setup(t);const input={store:c.store,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:c.task.taskId,actorUserId:'owner',kind:'outline' as const,expectedConsumerInputHash:supplementConsumerHash(c.task)};await bindWeeklyPreproductionAuthority(input);c.task.schedule.estimatedStartAt='2026-10-13T00:00:00Z';const tr=(await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!;await c.store.update('social_weekly_execution_tasks',tr.id,{payload:c.task});assert.equal((await runWeeklyPreproductionProducerScan({store:c.store})).failed,1);assert.equal((await readWeeklyPreproductionExecutionGate(c.store,c.task)).ready,false);c.task.packageVersion=2;await c.store.update('social_weekly_execution_tasks',tr.id,{payload:c.task});assert.equal((await runWeeklyPreproductionProducerScan({store:c.store})).failed,1);const list=c.store.list.bind(c.store);t.mock.method(c.store,'list',async<T>(collection:string,query:import('../storage/datastore.js').ListQuery={})=>{const r=await list<T>(collection,query);return collection===WEEKLY_PREPRODUCTION_JOBS?{...r,totalItems:r.totalItems+1}:r;});await assert.rejects(runWeeklyPreproductionProducerScan({store:c.store}),/scan_invalid|scan_incomplete/);});
