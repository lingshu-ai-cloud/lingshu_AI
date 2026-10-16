import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWeeklyEnterpriseFactFixture } from './weeklyEnterpriseFactSupplement.fixture.js';
import { supplementConsumerHash } from '../socialPrograms/weeklySupplementRequests.js';
import { bindWeeklyPreproductionAuthority, runWeeklyPreproductionProducerScan, readWeeklyPreproductionExecutionGate, listWeeklyPreproductionJobs, WEEKLY_PREPRODUCTION_JOBS } from './weeklyPreproductionProducer.js';
import type { Record_ } from '../storage/datastore.js';
async function setup(t: Parameters<typeof prepareWeeklyEnterpriseFactFixture>[0]) { const c = await prepareWeeklyEnterpriseFactFixture(t); c.task.schedule.stepKind = 'business_outline'; c.task.workflowKind = 'readiness'; c.task.scope = 'package'; c.task.inputSnapshot = {}; await c.store.create('social_weekly_execution_tasks', { tenant_id: c.task.tenantId, program_id: c.task.programId, package_id:c.task.packageId,package_version:c.task.packageVersion,status:c.task.status,task_id: c.task.taskId, idempotency_key: c.task.idempotencyKey, payload: c.task }); return c; }
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
test('M2 formal accepted supply produces director analysis and merged schedule before user confirmation', async (t) => { const c = await setup(t); const { preproductionPackage, seedPreproductionSupply } = await import('./weeklyPreproductionProducer.fixture.js'); const pkg = preproductionPackage(); pkg.socialContentPackage.publicationTasks[0]!.factRefs = c.authority.goal.publicFactRefs; await c.store.update('social_weekly_operating_packages', (await c.store.list<Record_>('social_weekly_operating_packages')).items[0]!.id, { payload: pkg }); c.task.schedule.stepKind = 'benchmark_collection'; c.task.status = 'blocked'; c.task.ownBlockingReasons = ['weekly_preproduction_authority_required', 'business_dispatch_required']; await c.store.update('social_weekly_execution_tasks', (await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.id, {status:c.task.status,payload:c.task}); await seedPreproductionSupply(c.store); await c.store.create('social_discovery_scopes', { id: 'scope-positive', tenant_id: 'tenant-a', version: 1, status: 'active', payload: { approval: { status: 'approved', scopeVersion: 1, approvedBy: 'owner' }, market: 'US', language: 'en', keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } }, keywords: [], discoveryBrief: { discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['momentum'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 1, budgetLimitCny: 0, productionGap: null, createdBy: 'director_agent', modePolicies: { momentum: { enabled: true, sourceRefs: ['query'], platforms: ['tiktok'], resultLimit: 1, refreshIntervalMinutes: 60, budgetLimitCny: 0 } } } } }); await bindWeeklyPreproductionAuthority({ store: c.store, tenantId: 'tenant-a', programId: 'program-a', packageId: 'package-a', packageVersion: 1, taskId: c.task.taskId, actorUserId: 'owner', kind: 'discovery', expectedConsumerInputHash: supplementConsumerHash(c.task), discovery: { scopeId: 'scope-positive', scopeVersion: 1, requestedModes: ['momentum'] } }); const old = process.env.APIFY_TOKEN; process.env.APIFY_TOKEN = 'controlled-test-port'; let calls = 0; try {
    const deps = { dataStore: c.store, async crawl() { calls++; return { platform: 'tiktok' as const, keyword: 'query', imported: 1, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 1, total: 1, source: 'r3' as const, message: '', candidateIds: ['video-1'], items: [] }; }, candidateEvidenceAdapter: { async toEvidenceWorkItems() { return [{ tenantId: 'tenant-a', candidateId: 'video-1', discoveryPath: ['keyword'] as Array<'keyword'>, evidenceRefs: ['source'], g1: { runId: 'bound-run', queryRef: 'query', discoveryMode: 'momentum' as const, sourceUrl: 'https://www.tiktok.com/video-1' } }]; } }, async runCandidateEvidence() { const evidence = (await c.store.list<import('../socialDiscovery/qualityOrchestration.js').VersionedCandidateEvidence>('social_candidate_evidence')).items[0]!; return { accepted: [evidence], suggestions: [], failed: [] }; } };
    const {runSocialWeeklyExecutionScan}=await import('./socialWeeklyExecutionRuntime.js');
        const result=await runSocialWeeklyExecutionScan({dataStore:c.store,adapters:{},preproductionPorts:{discoveryDependencies:deps}});const report=result.preproduction;
    assert.equal(report.succeeded, 1, JSON.stringify({ report, jobs: (await c.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items.map(r => r.payload) }));
    const planner = (await import('../socialPrograms/planningAuthority.js')).createWeeklyPlanningAuthority(c.store);
    const planning = await planner.get('tenant-a', 'program-a', 'package-a', 1);
    assert.equal(planning.status, 'awaiting_confirmation');
    assert.equal(planning.directorAnalyses.length, 1);
    assert.equal(planning.detailedSchedule?.items.length, 1);
    const task = (await c.store.list<Record_>('social_weekly_execution_tasks')).items[0]!.payload as typeof c.task;
    assert.deepEqual(task.ownBlockingReasons, ['business_dispatch_required']);
    assert.equal(task.status, 'blocked');
    assert.equal((await readWeeklyPreproductionExecutionGate(c.store, task)).ready, true);
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
