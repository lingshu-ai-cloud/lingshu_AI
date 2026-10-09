import {createSocialOperatingDecisionService} from '../socialOperating/service.js';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from './weeklyContentQualityAudit.fixture.js';
import {createWeeklyPlanningAuthority} from '../socialPrograms/planningAuthority.js';
import {createSocialWeeklyProductionAdapter} from './socialWeeklyProductionAdapter.js';
import {runSocialWeeklyExecutionScan} from './socialWeeklyExecutionRuntime.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';

export async function prepareWeeklyPlanningProductionFixture(t:TestContext){
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 f.tables.social_weekly_agent_planning=[];
 const pkg=f.pkg;pkg.referenceSourcePolicy={profile:'b2b_cold_start',ownedPercent:0,externalPercent:100,allocationUnit:'mother_content'};
 Object.assign(pkg.socialContentPackage,{originalContentTarget:1,adaptationVersionTarget:0,publicationTaskTarget:1});
 Object.assign(pkg.socialContentPackage.publicationTasks[0]!,{motherContentId:'new-mother',adaptationOfPublicationTaskId:null,accountPositioning:'B2B采购产品说明',publishWindow:'2026-10-08T10:00:00Z'});
  await f.store.create('social_discovery_scopes', {
    tenant_id: 't', program_id: 'p', status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await f.store.create('social_candidate_evidence', {
    tenant_id: 't', evidenceId: 'evidence-decorative-reference', version: 1, tenantId: 't', candidateId: 'decorative-reference', inputFingerprint: 'fp',
    evidence: {
      inspirationId: 'decorative-reference', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl: 'https://www.tiktok.com/@fixture/video/1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await f.store.create('trend_videos', { id: 'decorative-reference', tenantId: 't', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/@fixture/video/1' });
  await f.store.create('social_tracked_accounts', {
    tenant_id: 't', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: ['decorative-reference', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });
 await f.store.create('social_programs',{tenant_id:'t',program_id:'p',payload:{version:1}});
 await f.store.create('social_owned_accounts',{tenant_id:'t',program_id:'p',account_id:'account',payload:{version:1,platform:'tiktok'}});
 const goalResult=await createSocialOperatingDecisionService(f.store).buildAndSave({tenantId:'t',operator:{type:'user',id:'owner'},input:{programRef:{type:'social_program',id:'p',version:1},enterprise:{ref:{type:'enterprise_profile',id:'profile',version:1},products:['企业产品'],markets:['US'],audiences:['企业采购'],languages:['en'],publicFacts:pkg.socialContentPackage.publicationTasks[0]!.factRefs.map(ref=>({ref,statement:'已确认的企业产品信息'})),prohibitedClaims:['编造产品性能'],weeklyBudgetCny:10,salesOwnerId:'owner'},accounts:[{ref:{type:'owned_social_account',id:'account',version:1},accountId:'account',platform:'tiktok',role:'核心账号',status:'active',conversionRouteId:'test-contact'}],conversionRoutes:[{ref:{type:'conversion_route',id:'test-contact',version:1},routeId:'test-contact',kind:'website',target:'https://example.test/contact',verified:true}]}});
 assert.equal(goalResult.goal.status,'ready');pkg.businessContentGoalRef={type:'business_content_goal',id:goalResult.goal.goalId,version:goalResult.goal.version};
 const service=createWeeklyPlanningAuthority(f.store);
 const initial=await service.initialize('t',pkg);
 const analysis=await service.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:initial.version,actor:'director_agent'});
 assert.equal(analysis.directorAnalyses.length,1);assert.equal(analysis.directorAnalyses[0]!.benchmarkVideoRefs[0]!.id,'decorative-reference');
 const schedule=await service.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:analysis.version,actor:'business_agent'});
 const confirmation=await service.confirm({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:schedule.version,userId:'owner'});
 const dispatched=await service.dispatch({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:confirmation.version,actor:'business_agent'});
 assert.equal(dispatched.status,'dispatched');
 // Remove the unrelated already-produced fixture task; production must use actual creation.
 f.tables.starter_social_content_tasks=[];
 const task:WeeklyExecutionTask={...f.task,taskId:'actual-planning-production',workflowKind:'content',status:'queued',schedule:{...f.task.schedule,stepKind:'material_readiness',responsibleActor:'content_agent'},dependsOnTaskIds:[],upstreamVersionRefs:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],attempt:0,lease:null,nextAttemptAt:null,inputSnapshot:{publicationTask:structuredClone(pkg.socialContentPackage.publicationTasks[0])}};
 f.tables.social_weekly_execution_tasks=[{id:task.taskId,tenant_id:'t',program_id:'p',package_id:pkg.packageId,package_version:pkg.version,task_id:task.taskId,status:'queued',payload:task}];
 const report=await runSocialWeeklyExecutionScan({dataStore:f.store,adapters:{material_readiness:createSocialWeeklyProductionAdapter(f.store)},maxTasksPerTenant:1});
 const actual=f.tables.social_weekly_execution_tasks[0]!.payload as WeeklyExecutionTask;
 assert.equal(report.claimed,1);assert.ok(['pending','blocked','succeeded'].includes(actual.status),JSON.stringify(actual.lastError));
 assert.equal(f.tables.starter_usage_ledger?.length??0,0,'planning and prerequisite checks must not pay a supplier');
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
 assert.equal(actual.lastError?.code,'weekly_material_contract_required',JSON.stringify(actual));
 assert.equal(f.tables.starter_social_content_tasks.length,1,'actual default create stores exactly one production identity');
 const created=f.tables.starter_social_content_tasks[0]!;assert.equal(created.create_idempotency_key,`weekly-production:${pkg.packageId}:${pkg.version}:pub`);
 assert.ok(created.run_id,'actual default start creates an owned run');assert.ok(f.tables.workflow_runs!.some(run=>run.id===created.run_id&&run.tenant_id==='t'));
 assert.ok(created.orchestrator_item_id,'actual start stores the durable orchestrator queue identity');
 assert.equal((created.brief as {targetAccountRef:{objectType:string}}).targetAccountRef.objectType,'social_owned_account');
 const adapter=createSocialWeeklyProductionAdapter(f.store);await adapter.execute(actual);assert.equal(f.tables.starter_social_content_tasks.length,1);assert.equal(f.tables.content_execution_jobs?.length??0,0,'missing frozen material proof never claims paid execution completion');
 return {f,pkg,task,actual,created,report,dispatched};
}
