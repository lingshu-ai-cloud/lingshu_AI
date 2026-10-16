import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeLocalAccountRecords} from '../lib/localAccountStore.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';

// Exercise the application's file-backed store, isolated from existing tenants.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-deadline-acceptance-'));
process.env.LOCAL_STORE_DIR = directory;
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.NODE_ENV = 'test';
// Local authority must use a real isolated local membership registry, not the
// formal users fixture. This also exercises the production identity boundary.
process.env.LOCAL_AUTH_ACCOUNTS_FILE=path.join(directory,'accounts.json');
writeLocalAccountRecords(process.env.LOCAL_AUTH_ACCOUNTS_FILE,[{userId:'owner',tenantId:'t',email:'test@example.test',name:'Test operator',accountType:'admin',role:'social_operator',salt:'unused-test',passwordHash:'unused-test',createdAt:'2026-10-01T00:00:00Z'}]);
const [{ pbStore: store }, { runWithDataAuthority }, { runSocialWeeklyExecutionScan }, { getWeeklyExecutionTaskRow }, { projectExecutionCalendar }, { runWeeklyDeadlineRecoveryScan, WEEKLY_DEADLINE_ASSESSMENTS }] = await Promise.all([
  import('../storage/pbStore.js'), import('../storage/dataAuthority.js'),
  import('./socialWeeklyExecutionRuntime.js'), import('../socialPrograms/executionTasks.js'),
  import('../../src/components/socialProgram/weeklyExecutionCalendar.js'),
  import('./socialWeeklyDeadlineRecovery.js'),
]);
let now = Date.now();
let packageId='deadline-package',packageVersion=1;let planningRef:{type:string;id:string;version:number};
const time = (offset: number) => new Date(now + offset).toISOString();
function task(id: string, tenantId = 't'): WeeklyExecutionTask {
  return { taskId: id, tenantId, programId: 'p', packageId, packageVersion,
    workflowKind: 'directing', scope: 'package', subjectId: packageId, accountId: null, publicationTaskId: null,
    dependsOnTaskIds: [], upstreamVersionRefs: [], inputSnapshot: {}, idempotencyKey: `${tenantId}:${id}`,
    budget: { category: 'none', limitCny: null }, schedule: { stepKind: 'business_schedule', responsibleActor: 'business_agent',
      estimatedDurationMinutes: 15, estimatedStartAt: time(-3600000), estimatedFinishAt: time(-60000),
      latestStartAt: time(-3600000), latestFinishAt: time(-60000), actualStartedAt: null, actualFinishedAt: null },
    status: 'queued', ownBlockingReasons: [], inheritedBlockingTaskIds: [], attempt: 0, maxAttempts: 3,
    nextAttemptAt: null, lease: null, resultRefs: [], lastError: null, recoveredFromDeadLetterAt: null,
    cancelReason: null, createdAt: time(-7200000), updatedAt: time(-7200000) };
}
async function save(value: WeeklyExecutionTask) {
  return store.create('social_weekly_execution_tasks', { tenant_id: value.tenantId, task_id: value.taskId,
    program_id: value.programId, package_id: value.packageId, package_version: value.packageVersion,
    status: value.status, idempotency_key: value.idempotencyKey, created_at: value.createdAt, payload: value });
}
test('formal frozen planning executes through isolated disk deadline scan and lease without paid providers',async t=>{
try {
  await runWithDataAuthority('local', async () => {
    const {prepareWeeklyNonPresenterPlanningFixture}=await import('./weeklyNonPresenterProduction.fixture.js');
    const {f,pkg}=await prepareWeeklyNonPresenterPlanningFixture(t,{ownedReferenceBytes:true,primaryStructure:true,targetCta:'Contact sales',metricTargets:['播放目标1000','点赞目标20','评论目标5','分享目标5']});
    const {materializeWeeklyExecutionTasks,planWeeklyExecutionTasks}=await import('../socialPrograms/executionTasks.js');
    f.tables.social_weekly_execution_tasks=[];
 // This graph test starts a pristine future draft, not an active historical week.
 pkg.status='draft';pkg.weekStart='2026-10-19';pkg.weekEnd='2026-10-25';for(const publication of pkg.socialContentPackage.publicationTasks)publication.publishWindow='2026-10-24T12:00:00+08:00';
 pkg.planningBlockers=[];
 pkg.executionGraphVersion=2;
 const {createSocialOperatingDecisionService}=await import('../socialOperating/service.js'),{planCapacity}=await import('../socialOperating/capacityPlanner.js'),{resolveAutomationPolicy}=await import('../socialOperating/automationPolicyResolver.js');
 const decisionService=createSocialOperatingDecisionService(f.store),goal=await decisionService.getGoal('t',pkg.programId,pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version);assert.equal(goal.status,'ready');
 const enterpriseRef=goal.inputRefs.find(ref=>ref.type==='enterprise_profile');assert.ok(enterpriseRef);pkg.enterpriseProfileRef=enterpriseRef;
 const capacity=planCapacity({goal,desiredOriginalContents:1,desiredAdaptations:0,costPerOriginalCny:1,costPerAdaptationCny:1,readyMaterialUnits:1,materialUnitsPerOriginal:1,productionItemsPerDay:1,daysUntilDeadline:7,accounts:[{ref:{type:'owned_social_account',id:'account',version:1},accountId:'account',status:'active',weeklyPublicationCapacity:1}],interactionItemsPerWeek:10,salesLeadsPerWeek:10,expectedInteractionsPerPublication:1,expectedLeadsPerPublication:1,capabilities:{'studio.production':'available','publishing.calendar':'available','customer.attribution':'available'}},{operator:{type:'user',id:'owner'},decidedAt:new Date().toISOString()});assert.equal(capacity.plan.status,'ready');await decisionService.saveOperatingDecision('t',pkg.programId,capacity.decision);pkg.capacityPlanRef={type:'capacity_plan',id:capacity.decision.decisionId,version:1};
 const policy=resolveAutomationPolicy({goal,mode:'managed',action:'draft',capability:{key:'studio.production',availability:'available'},factsVerified:true,withinBudget:true,rightsSufficient:true},{operator:{type:'user',id:'owner'},decidedAt:new Date().toISOString()});await decisionService.saveOperatingDecision('t',pkg.programId,policy.decision);pkg.automationPolicyRef={type:'automation_policy',id:policy.decision.decisionId,version:1};
 pkg.objective='验证已确认模板的正式排期和逐阶段素材供给';pkg.successCriteria=['完整保留冻结参考结构与企业产品身份','素材授权通过后才执行真实供给'];
 pkg.appliedWorkflowEvents=[];pkg.workflowStateVersion=0;
 pkg.socialContentPackage.authorization={mode:'each',accountIds:pkg.socialContentPackage.publicationTasks.map(task=>task.accountId),maxPublishItems:0,weekStart:pkg.weekStart,weekEnd:pkg.weekEnd,allowRealPublishing:false,authorizedBy:null,authorizedAt:null,revokedBy:null,revokedAt:null};
 let storedPackage=f.tables.social_weekly_operating_packages.find(row=>row.package_id===pkg.packageId&&row.version===pkg.version);assert.ok(storedPackage);storedPackage.payload=structuredClone(pkg);
 const executionsForFixture=async()=>{const {createWeeklyExecutionTaskService}=await import('../socialPrograms/executionTasks.js');return createWeeklyExecutionTaskService(f.store).list('t',pkg.programId,pkg.packageId,pkg.version);};const {applyBusinessDispatchToExecutionTasks}=await import('../socialPrograms/executionTasks.js');await materializeWeeklyExecutionTasks(f.store,'t',pkg);assert.ok(pkg.agentPlanning?.dispatch);await applyBusinessDispatchToExecutionTasks(f.store,'t',pkg.programId,pkg.packageId,pkg.version,pkg.agentPlanning.dispatch);const initialTasks=await executionsForFixture();
 const {createWeeklyInitialScheduleService}=await import('../socialPrograms/weeklyInitialSchedule.js');
 const {setContentExecutionLimit}=await import('../contentExecution/durableQueue.js');for(const [scope,scopeKey] of [['tenant','*'],['account','account'],['task_type','social_content_weekly']] as const)await setContentExecutionLimit({dataStore:f.store,tenantId:'t',scope,scopeKey,maxRunning:1,updatedBy:'owner'});
 const scheduleClock=new Date().toISOString(),initialSchedule=createWeeklyInitialScheduleService(f.store,{now:()=>scheduleClock});
 const scheduleScope={tenantId:'t',programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version,actorUserId:'owner'};
 const proposal=await initialSchedule.propose(scheduleScope,{constraints:Object.fromEntries(initialTasks.map(task=>[task.taskId,{resourceKey:task.schedule.responsibleActor,remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:1,bufferMinutes:0,availableAt:scheduleClock}])),resources:Object.fromEntries([...new Set(initialTasks.map(task=>task.schedule.responsibleActor))].map(actor=>[actor,{concurrency:1,workingWindows:[{startAt:scheduleClock,finishAt:'2026-10-27T20:00:00Z'}]}])),remainingBudgetCny:1000,operationalDeadlines:Object.fromEntries(initialTasks.filter(task=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)).map(task=>[task.taskId,'2026-10-27T18:00:00Z']))});
 assert.equal(proposal.plan.publicationGap,0,JSON.stringify(proposal.plan.assignments.filter(item=>item.mode!=='planned')));
 const confirmedSchedule=await initialSchedule.confirm(scheduleScope,{proposalId:proposal.proposalId,expectedVersion:pkg.version,inputEvidenceHash:proposal.inputEvidenceHash,confirmedTemplateCarryoverPlanHashes:(proposal.templateCarryovers??[]).map(plan=>plan.planHash)});
 Object.assign(pkg,confirmedSchedule.item);
 storedPackage=f.tables.social_weekly_operating_packages.find(row=>row.package_id===pkg.packageId&&row.version===pkg.version)!;assert.ok(storedPackage);
 const {createWeeklyPlanningAuthority}=await import('../socialPrograms/planningAuthority.js');const planning=createWeeklyPlanningAuthority(f.store);
 const initialized=await planning.initialize('t',pkg),analyzed=await planning.runDirectorAnalysis({...scheduleScope,packageVersion:pkg.version,expectedPlanningVersion:initialized.version,actor:'director_agent'}),merged=await planning.mergeDetailedSchedule({tenantId:'t',programId:pkg.programId,package:pkg,expectedPlanningVersion:analyzed.version,actor:'business_agent'}),confirmed=await planning.confirm({...scheduleScope,packageVersion:pkg.version,expectedPlanningVersion:merged.version,userId:'owner'}),freshDispatch=await planning.dispatch({...scheduleScope,packageVersion:pkg.version,expectedPlanningVersion:confirmed.version,actor:'business_agent'});
 assert.ok(freshDispatch.dispatch);pkg.agentPlanning=freshDispatch;await applyBusinessDispatchToExecutionTasks(f.store,'t',pkg.programId,pkg.packageId,pkg.version,freshDispatch.dispatch,scheduleClock);
 const {createWeeklyOperatingPackageService}=await import('../socialPrograms/weeklyOperatingPackages.js');const packageService=createWeeklyOperatingPackageService(f.store);Object.assign(pkg,await packageService.activate('t','owner',pkg.programId,pkg.packageId,{expectedVersion:pkg.version,expectedProgramVersion:1,authorizePublishing:false}));
 const tasks=await executionsForFixture(),planned=planWeeklyExecutionTasks('t',pkg,pkg.createdAt);assert.deepEqual(tasks.map(task=>task.taskId).sort(),planned.map(task=>task.taskId).sort());

    packageId=pkg.packageId;packageVersion=pkg.version;planningRef={type:'weekly_agent_planning',id:freshDispatch.planningId,version:freshDispatch.version};now=Date.now();
    for(const [collection,records] of Object.entries(f.tables)){
      if(collection==='social_weekly_execution_tasks')continue;
      for(const record of records??[])await store.create(collection,structuredClone(record));
    }
    await save(task('ready'));
    const future = task('future'); future.schedule.estimatedStartAt = time(3600000); future.schedule.latestStartAt = time(3600000);
    future.schedule.estimatedFinishAt = time(7200000); future.schedule.latestFinishAt = time(7200000);
    future.nextAttemptAt = time(3600000); await save(future);
    const human = task('human'); human.schedule.responsibleActor = 'user'; await save(human);
    const dependent = task('dependent'); dependent.status = 'blocked'; dependent.dependsOnTaskIds = ['human']; dependent.inheritedBlockingTaskIds = ['human']; dependent.publicationTaskId = 'affected-publication'; dependent.workflowKind = 'publishing'; dependent.schedule.stepKind = 'publishing'; await save(dependent);
    const staleQueued = task('stale-queued-child'); staleQueued.dependsOnTaskIds = ['human']; await save(staleQueued);
    await save(task('unauthorized', 'other-tenant'));
    const executions: string[] = [];
    const {createSocialWeeklyPlanningAdapter}=await import('./socialWeeklyExecutionRuntime.js');const planningAdapter=createSocialWeeklyPlanningAdapter(store);
    const adapters = { business_schedule: { async execute(value: WeeklyExecutionTask) {
      executions.push(value.taskId); return planningAdapter.execute(value);
    } } };
    const scan = await runSocialWeeklyExecutionScan({ dataStore: store, adapters });
    assert.deepEqual(executions, ['ready'], JSON.stringify({scan, ready:(await getWeeklyExecutionTaskRow(store, 't', 'ready')).payload}));
    const completed = (await getWeeklyExecutionTaskRow(store, 't', 'ready')).payload;
    assert.equal(completed.status, 'succeeded',JSON.stringify(completed.lastError)); assert.ok(completed.schedule.actualFinishedAt);
    assert.equal(completed.schedule.latestFinishAt, time(-60000));
    assert.deepEqual(completed.resultRefs, [planningRef]);
    assert.equal((await getWeeklyExecutionTaskRow(store, 't', 'future')).payload.attempt, 0);
    assert.equal((await getWeeklyExecutionTaskRow(store, 't', 'human')).payload.status, 'queued');
    assert.equal((await getWeeklyExecutionTaskRow(store, 't', 'dependent')).payload.status, 'blocked');
    assert.equal((await getWeeklyExecutionTaskRow(store, 't', 'stale-queued-child')).payload.attempt, 0, 'fresh dependency check fences a stale queued row');
    assert.equal((await getWeeklyExecutionTaskRow(store, 'other-tenant', 'unauthorized')).payload.status, 'blocked');
    await runSocialWeeklyExecutionScan({ dataStore: store, adapters });
    assert.deepEqual(executions, ['ready'], 'repeated real scan does not execute completed work twice');
    const recovery = (await getWeeklyExecutionTaskRow(store, 't', 'human')).payload.deadlineRecovery!;
    assert.equal(recovery.status, 'blocked');
    assert.deepEqual(recovery.affectedPublicationIds, ['affected-publication']);
    assert.deepEqual(recovery.blockingReasons, ['fresh_remaining_budget_capacity_work_windows_required']);
    const history = await store.list<any>(WEEKLY_DEADLINE_ASSESSMENTS, { where: { tenant_id: 't' } });
    assert.ok(history.totalItems > 0);
    const unchanged = await runWeeklyDeadlineRecoveryScan({ dataStore: store });
    assert.equal(unchanged.created, 0, 'unchanged evidence does not duplicate the durable assessment');
    await runWeeklyDeadlineRecoveryScan({ dataStore: store, readEvidence: async (_scope, tasks, at) => ({
      remainingBudgetCny: 0,
      constraints: Object.fromEntries(tasks.map(value => [value.taskId, { resourceKey: 'actual-reviewer', remainingMinutes: 15, remainingCostCny: 0, bufferMinutes: 5, availableAt: at.toISOString() }])),
      resources: { 'actual-reviewer': { concurrency: 1, workingWindows: [{ startAt: time(-3600000), finishAt: time(10800000) }] } },
    }) });
    const evaluated = (await getWeeklyExecutionTaskRow(store, 't', 'human')).payload.deadlineRecovery!;
    assert.equal(evaluated.status, 'evaluated');
    assert.notEqual(evaluated.assessmentId, recovery.assessmentId, 'fresh evidence creates a new immutable assessment');
    const evaluatedRows = await store.list<any>(WEEKLY_DEADLINE_ASSESSMENTS, { where: { assessment_id: evaluated.assessmentId } });
    assert.equal(evaluatedRows.items[0].payload.revisionApplied, false);
    assert.equal(evaluatedRows.items[0].payload.assessment.publicationGap, 1);
    assert.equal((await getWeeklyExecutionTaskRow(store, 't', 'human')).payload.status, 'queued', 'forecast never approves human work');
    const card = projectExecutionCalendar([completed], { business_schedule: '正式经营排期' } as any)[0]!;
    assert.equal(card.status, 'completed');
    assert.equal(card.deliveryTiming, 'late');
    const disk = JSON.parse(fs.readFileSync(path.join(directory, 'social_weekly_execution_tasks.json'), 'utf8'));
    assert.equal(disk.find((row: any) => row.task_id === 'ready').payload.schedule.actualFinishedAt, completed.schedule.actualFinishedAt);
    console.log('Deadline storage acceptance: real scan → dispatch → lease → executor → evidence validation → disk → late calendar; future/human/dependency/tenant isolation and repeat scan verified.');
  });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
});
