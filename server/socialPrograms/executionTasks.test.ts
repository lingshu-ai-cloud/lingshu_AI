import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { DURABLE_OPERATION_LEASE_COLLECTION } from '../runtime/durableLease.js';
import { createSocialWeeklyExecutionWorker } from '../runtime/socialWeeklyExecutionWorker.js';
import { createSocialProgramService } from './service.js';
import { planWeeklyExecutionTasks, applyBusinessDispatchToExecutionTasks, createWeeklyExecutionTaskService, WEEKLY_EXECUTION_TASKS, getWeeklyExecutionTaskRow, writeWeeklyExecutionTask, recomputePackageExecution } from './executionTasks.js';
import { createWeeklyOperatingPackageService } from './weeklyOperatingPackages.js';
import { createSocialOperatingRepository } from '../socialOperating/repository.js';
import { planWeeklyBackwardSchedule } from './weeklyBackwardSchedule.js';

function memoryStore(): DataStore {
  const rows = new Map<string, Record_[]>();
  let counter = 0;
  const matches = (row: Record_, where: ListQuery['where']) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
  return {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      if (collection === DURABLE_OPERATION_LEASE_COLLECTION
        && list.some(row => row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
      if (collection === WEEKLY_EXECUTION_TASKS
        && list.some(row => row.tenant_id === data.tenant_id && row.idempotency_key === data.idempotency_key)) return null;
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...list, row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      const index = list.findIndex(row => row.id === id);
      if (index < 0) return false;
      list[index] = { ...list[index], ...structuredClone(data) };
      return true;
    },
    async delete(collection: string, id: string) {
      const list = rows.get(collection) ?? [];
      const next = list.filter(row => row.id !== id);
      rows.set(collection, next);
      return next.length !== list.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let list = (rows.get(collection) ?? []).filter(row => matches(row, query.where));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const field = descending ? query.sort.slice(1) : query.sort;
        list = [...list].sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (descending ? -1 : 1));
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      return {
        items: structuredClone(list.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: list.length,
        totalPages: Math.max(1, Math.ceil(list.length / perPage)),
        page,
        perPage,
      };
    },
  };
}

// Seed predecessor completion as a test fixture for dependency/lease behavior.
// Production success goes through the resource validator, tested separately.
async function seedCompleted(dataStore: DataStore, task: import('../../shared/contracts/socialProgram.js').WeeklyExecutionTask, now: Date) {
  const row = await getWeeklyExecutionTaskRow(dataStore, task.tenantId, task.taskId);
  await writeWeeklyExecutionTask(dataStore, row, { ...row.payload, status: 'succeeded', lease: null, updatedAt: now.toISOString() });
  await recomputePackageExecution(dataStore, task.tenantId, task.programId, task.packageId, task.packageVersion, now.toISOString(), true);
}

async function fixture() {
  const dataStore = memoryStore();
  const programs = createSocialProgramService(dataStore);
  const packages = createWeeklyOperatingPackageService(dataStore);
  const execution = createWeeklyExecutionTaskService(dataStore);
  const worker = createSocialWeeklyExecutionWorker(dataStore);
  const program = await programs.createProgram('tenant-a', 'owner', {
    brandName: 'Worker Factory', market: '北美', targetAudience: '采购', candidatePlatforms: ['tiktok'], route: 'cold_start',
  });
  const account = await programs.createAccount('tenant-a', 'owner', program.programId, {
    platform: 'tiktok', displayName: 'main', businessRole: '主账号', audiencePromise: '采购', contentPromise: '工厂证据',
  });
  const fact = { type: 'fact', id: 'fact-1', version: 1 };
  const repository = createSocialOperatingRepository(dataStore);
  const goalRef = { type: 'business_content_goal', id: 'goal-1', version: 1 };
  const goal = {
    goalId: goalRef.id, programId: program.programId, version: 1, status: 'ready', objective: '获得询盘',
    products: ['工厂'], markets: ['北美'], audiences: ['采购'], languages: ['en'], accountBoundaries: [],
    conversionRouteIds: ['route-1'], publicFactRefs: [fact], prohibitedClaims: [], weeklyBudgetCny: 200,
    evidence: [], blockers: [], inputRefs: [], inputFingerprint: 'goal-fp', ruleVersion: 'business-content-goal/1.0.0',
    decisionRecordRef: { type: 'decision_record', id: 'goal-decision-1', version: 1 }, createdBy: 'owner', createdAt: '2026-10-01T00:00:00Z',
  } as any;
  await repository.save('tenant-a', goal, {
    decisionId: 'goal-decision-1', decisionType: 'business_content_goal', subjectRef: goalRef, version: 1,
    outcome: 'accepted', ruleVersion: 'business-content-goal/1.0.0', inputRefs: [], inputFingerprint: 'goal-fp',
    evidence: [], blockers: [], impacts: [], output: goalRef, operator: { type: 'agent', id: 'owner' }, decidedAt: goal.createdAt,
  } as any);
  const capacityRef = { type: 'capacity_plan', id: 'capacity-1', version: 1 };
  await repository.saveDecision('tenant-a', program.programId, {
    decisionId: capacityRef.id, decisionType: 'capacity_plan', subjectRef: goalRef, version: 1, outcome: 'accepted',
    ruleVersion: 'capacity-planner/1.0.0', inputRefs: [goalRef], inputFingerprint: 'capacity-fp', evidence: [], blockers: [],
    output: { status: 'ready', originalContentQuota: 1, adaptationQuota: 1, publicationQuota: 2,
      accountQuotas: [{ accountId: account.accountId, publicationQuota: 2 }], estimatedCostCny: 200, limitingFactors: [] },
    operator: { type: 'agent', id: 'owner' }, decidedAt: goal.createdAt,
  } as any);
  const policyRef = { type: 'automation_policy', id: 'policy-1', version: 1 };
  await repository.saveDecision('tenant-a', program.programId, {
    decisionId: policyRef.id, decisionType: 'automation_policy', subjectRef: goalRef, version: 1, outcome: 'accepted',
    ruleVersion: 'automation-policy/1.0.0', inputRefs: [goalRef], inputFingerprint: 'policy-fp', evidence: [], blockers: [],
    output: { status: 'allowed', mode: 'managed', action: 'draft', humanGate: 'none', automaticExecutionAllowed: true, authorizationIssue: null },
    operator: { type: 'agent', id: 'owner' }, decidedAt: goal.createdAt,
  } as any);
  const draft = await packages.create('tenant-a', 'owner', program.programId, {
    weekStart: '2026-10-05', objective: '获得询盘', successCriteria: ['两条发布任务完成'],
    accountPlans: [{ accountId: account.accountId, publicationCount: 2 }], originalContentTarget: 1,
    businessContentGoalRef: goalRef, capacityPlanRef: capacityRef, automationPolicyRef: policyRef,
    discoveryBudgetCny: 20, weeklyBudgetCny: 200,
    publicationTasks: [0, 1].map(index => ({
      accountId: account.accountId,
      businessProposition: `proposition-${index}`,
      cta: `cta-${index}`,
      factRefs: [fact],
      metricTargets: ['qualified_inquiry>=1'],
      publishWindow: `2026-10-0${6 + index}T10:00:00Z`,
    })),
  });
  return { dataStore, programs, packages, execution, worker, program, account, draft };
}

test('preparation can precede the operating week and publication follows its zoned release time', async () => {
  const { draft } = await fixture();
  draft.socialContentPackage.publicationTasks[0]!.publishWindow = '2026-10-05T10:00:00+08:00';
  const tasks = planWeeklyExecutionTasks('tenant-a', draft, '2026-10-01T00:00:00Z');
  const preparation = tasks.find(task => task.schedule.stepKind === 'business_outline')!;
  assert.equal(preparation.schedule.estimatedStartAt, '2026-10-01T00:00:00.000Z');
  const publicationId = draft.socialContentPackage.publicationTasks[0]!.publicationTaskId;
  const publishing = tasks.find(task => task.publicationTaskId === publicationId && task.schedule.stepKind === 'publishing')!;
  assert.equal(publishing.schedule.estimatedStartAt, '2026-10-05T02:00:00.000Z');
  const approval = tasks.find(task => task.taskId === publishing.dependsOnTaskIds[0])!;
  assert(Date.parse(approval.schedule.estimatedFinishAt) <= Date.parse(approval.schedule.latestFinishAt!));
  const late = planWeeklyExecutionTasks('tenant-a', draft, '2026-10-05T03:00:00Z');
  assert(late.find(task => task.taskId === publishing.taskId)!.schedule.planningRisks!.includes('publication_deadline_at_risk'));
});

test('weekly execution tasks freeze the full worker contract and aggregate real state', async () => {
  const { packages, execution, program, draft } = await fixture();
  assert.equal(draft.executionSummary!.total, 41);
  assert.equal(draft.executionSummary!.byStatus.pending_activation, 41);
  assert.ok(draft.executionTaskRefs!.every(ref => ref.type === 'weekly_execution_task'));
  const active = await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, {
    expectedVersion: 1, expectedProgramVersion: 1,
  });
  assert.equal(active.executionSummary!.byStatus.queued, 1);
  assert.equal(active.executionSummary!.byStatus.blocked, 40);
  const tasks = await execution.list('tenant-a', program.programId, draft.packageId, 1);
  assert.ok(tasks.every(task => task.tenantId === 'tenant-a' && task.packageVersion === 1));
  assert.ok(tasks.every(task => task.idempotencyKey && task.inputSnapshot && task.budget && task.upstreamVersionRefs.length === 3));
  assert.ok(tasks.every(task => task.schedule.responsibleActor && task.schedule.estimatedDurationMinutes > 0 && task.schedule.estimatedFinishAt >= task.schedule.estimatedStartAt));
  assert.deepEqual([...new Set(tasks.filter(task => task.workflowKind === 'content').map(task => task.schedule.stepKind))], [
    'material_preparation', 'material_readiness', 'asset_generation', 'video_generation', 'quality_check', 'user_approval',
  ]);
  assert.ok(tasks.filter(task => ['script', 'storyboard'].includes(task.schedule.stepKind)).every(task => task.schedule.responsibleActor === 'director_agent'));
  assert.ok(tasks.filter(task => task.schedule.stepKind === 'quality_check').every(task => task.schedule.responsibleActor === 'quality_agent'));
  assert.equal(tasks.filter(task => task.schedule.stepKind === 'customer_channel_readiness').length, draft.socialContentPackage.publicationTasks.length * 3);
  assert.equal(tasks.filter(task => task.schedule.stepKind === 'customer_inquiry_handoff').length, draft.socialContentPackage.publicationTasks.length * 3);
  assert.ok(tasks.filter(task => ['customer_channel_readiness','customer_inquiry_handoff'].includes(task.schedule.stepKind)).every(task => task.schedule.responsibleActor === 'customer_agent'));
  for (const publication of draft.socialContentPackage.publicationTasks) {
    const publish = tasks.find(task => task.publicationTaskId === publication.publicationTaskId && task.schedule.stepKind === 'publishing')!;
    const readiness = tasks.filter(task => task.publicationTaskId === publication.publicationTaskId && task.schedule.stepKind === 'customer_channel_readiness');
    const handoffs = tasks.filter(task => task.publicationTaskId === publication.publicationTaskId && task.schedule.stepKind === 'customer_inquiry_handoff');
    assert.deepEqual(new Set(readiness.map(task => task.inputSnapshot.customerChannel)), new Set(['whatsapp','messenger','instagram']));
    assert.ok(readiness.every(task => publish.dependsOnTaskIds.includes(task.taskId)));
    assert.ok(readiness.every(task => Date.parse(task.schedule.estimatedFinishAt) <= Date.parse(publish.schedule.estimatedStartAt)));
    assert.ok(handoffs.every(task => task.dependsOnTaskIds.includes(publish.taskId)));
  }
  const scheduleTask = tasks.find(task => task.schedule.stepKind === 'business_schedule');
  const scriptTask = tasks.find(task => task.schedule.stepKind === 'script' && task.scope === 'content');
  const storyboardTask = tasks.find(task => task.schedule.stepKind === 'storyboard' && task.publicationTaskId === scriptTask?.publicationTaskId);
  const materialTask = tasks.find(task => task.schedule.stepKind === 'material_readiness' && task.publicationTaskId === scriptTask?.publicationTaskId);
  const assetTask = tasks.find(task => task.schedule.stepKind === 'asset_generation' && task.publicationTaskId === scriptTask?.publicationTaskId);
  assert.equal(scheduleTask?.schedule.responsibleActor, 'business_agent');
  assert.ok(scriptTask && storyboardTask?.dependsOnTaskIds.includes(scriptTask.taskId));
  const preparationTask=tasks.find(task=>task.schedule.stepKind==='material_preparation'&&task.publicationTaskId===scriptTask?.publicationTaskId);
  assert.equal(draft.executionGraphVersion,3);
  assert.ok(!tasks.some(task => task.schedule.stepKind === 'rework'));
  for (const approval of tasks.filter(task => task.schedule.stepKind === 'user_approval' && task.inputSnapshot.inventoryReuseRef === undefined)) {
    assert.equal(tasks.find(task => task.taskId === approval.dependsOnTaskIds[0])?.schedule.stepKind, 'quality_check');
  }
  assert.ok(preparationTask&&scriptTask?.dependsOnTaskIds.includes(preparationTask.taskId));
  assert.ok(scheduleTask&&preparationTask?.dependsOnTaskIds.includes(scheduleTask.taskId));
  assert.ok(scheduleTask?.dependsOnTaskIds.includes(tasks.find(task => task.schedule.stepKind === 'director_analysis')!.taskId));
  assert.ok(scheduleTask && materialTask?.dependsOnTaskIds.includes(scheduleTask.taskId));
  assert.ok(materialTask && assetTask?.dependsOnTaskIds.includes(materialTask.taskId));
  assert.ok(tasks.some(task => task.scope === 'adaptation'));
  const review = tasks.find(task => task.schedule.stepKind === 'weekly_review')!;
  const extractions = tasks.filter(task => task.schedule.stepKind === 'template_extraction');
  assert.equal(extractions.length, draft.socialContentPackage.publicationTasks.length);
  for (const extraction of extractions) {
    const video = tasks.find(task => task.taskId === extraction.inputSnapshot.sourceTaskId)!;
    assert.equal(video.schedule.stepKind, 'video_generation');
    assert.equal(video.publicationTaskId, extraction.publicationTaskId);
    assert.deepEqual(extraction.dependsOnTaskIds, [video.taskId, review.taskId]);
    assert.equal(extraction.schedule.responsibleActor, 'director_agent');
    const validation = tasks.find(task => task.schedule.stepKind === 'template_performance_validation' && task.publicationTaskId === extraction.publicationTaskId)!;
    assert.deepEqual(validation.dependsOnTaskIds, [extraction.taskId]);
    assert.equal(validation.inputSnapshot.reviewTaskId, review.taskId);
    assert.equal(validation.schedule.responsibleActor, 'business_agent');
    assert.equal(validation.resultRefs.length, 0);
    assert.equal(validation.status, 'blocked');
  }
  const firstTask = (await packages.get('tenant-a', program.programId, draft.packageId)).executionSummary!;
  assert.equal(firstTask.total, 41);
});

test('cold-start Z and established H generate distinct executable chain identities, inputs and dependencies', async () => {
  const {draft}=await fixture();
  const codes=(tasks:import('../../shared/contracts/socialProgram.js').WeeklyExecutionTask[])=>new Set(tasks.flatMap(task=>[task.chainTaskCode,...(task.chainSupportTaskCodes??[])].filter(Boolean)));
  const expected=(prefix:'Z'|'H')=>new Set([
    ...Array.from({length:8},(_,index)=>`${prefix}-M${index+1}`),
    ...Array.from({length:9},(_,index)=>`${prefix}-S${index+1}`),
  ]);
  const cold=planWeeklyExecutionTasks('tenant-a',draft,'2026-10-01T00:00:00Z');
  assert.deepEqual(codes(cold),expected('Z'));
  assert.ok(cold.every(task=>task.chainProfile==='b2b_cold_start'&&task.chainTaskCode?.startsWith('Z-')));
  assert.ok(cold.every(task=>task.chainContract?.requiredInputKinds.includes('external_reference_evidence')));
  assert.ok(cold.filter(task=>task.schedule.stepKind==='benchmark_scoring').every(task=>task.dependsOnTaskIds.some(id=>cold.find(candidate=>candidate.taskId===id)?.schedule.stepKind==='benchmark_collection')));

  const established=structuredClone(draft);
  established.referenceSourcePolicy={profile:'b2b_established',ownedPercent:40,externalPercent:60,allocationUnit:'mother_content'};
  const prototype=established.socialContentPackage.publicationTasks[0]!;
  established.socialContentPackage.publicationTasks=Array.from({length:5},(_,index)=>({
    ...structuredClone(prototype),publicationTaskId:`established-publication-${index}`,motherContentId:`established-mother-${index}`,
    adaptationOfPublicationTaskId:null,publishWindow:`2026-10-${String(6+index).padStart(2,'0')}T10:00:00Z`,
  }));
  const historical=planWeeklyExecutionTasks('tenant-a',established,'2026-10-01T00:00:00Z');
  assert.deepEqual(codes(historical),expected('H'));
  assert.ok(historical.every(task=>task.chainProfile==='b2b_established'&&task.chainTaskCode?.startsWith('H-')));
  const scoring=historical.filter(task=>task.schedule.stepKind==='benchmark_scoring');
  assert.equal(scoring.filter(task=>task.inputSnapshot.referenceSource==='owned').length,2);
  assert.equal(scoring.filter(task=>task.inputSnapshot.referenceSource==='external').length,3);
  const readiness=historical.find(task=>task.schedule.stepKind==='business_outline')!;
  assert.ok(scoring.filter(task=>task.inputSnapshot.referenceSource==='owned').every(task=>task.dependsOnTaskIds.length===1&&task.dependsOnTaskIds[0]===readiness.taskId));
  assert.ok(scoring.filter(task=>task.inputSnapshot.referenceSource==='external').every(task=>task.dependsOnTaskIds.some(id=>historical.find(candidate=>candidate.taskId===id)?.schedule.stepKind==='benchmark_collection')));
  assert.ok(historical.filter(task=>task.inputSnapshot.referenceSource==='owned').every(task=>task.chainContract?.requiredInputKinds.includes('owned_video_metrics_and_tone')));
  assert.ok(historical.filter(task=>task.inputSnapshot.referenceSource==='external').every(task=>task.chainContract?.requiredInputKinds.includes('external_reference_evidence')));
  assert.equal(historical.find(task=>task.schedule.stepKind==='performance_monitoring')?.inputSnapshot.profileWork,'existing_customer_and_dual_source_attribution');
  assert.equal(cold.find(task=>task.schedule.stepKind==='performance_monitoring')?.inputSnapshot.profileWork,'new_inquiry_and_first_baseline_attribution');
  assert.equal(cold.find(task=>task.schedule.stepKind==='performance_monitoring')?.chainTaskCode,'Z-M8');
  assert.equal(historical.find(task=>task.schedule.stepKind==='performance_monitoring')?.chainTaskCode,'H-M8');
});

test('real Z and H five-day graphs fit confirmed Agent calendars and finish every video before the preceding-day cutoff',async()=>{
 const {draft}=await fixture(),prototype=draft.socialContentPackage.publicationTasks[0]!;
 const schedule=(profile:'b2b_cold_start'|'b2b_established')=>{
  const pkg=structuredClone(draft);pkg.referenceSourcePolicy=profile==='b2b_cold_start'
   ?{profile,ownedPercent:0,externalPercent:100,allocationUnit:'mother_content'}
   :{profile,ownedPercent:40,externalPercent:60,allocationUnit:'mother_content'};
  pkg.socialContentPackage.publicationTasks=Array.from({length:5},(_,index)=>({...structuredClone(prototype),publicationTaskId:`${profile}-publication-${index}`,motherContentId:`${profile}-mother-${index}`,adaptationOfPublicationTaskId:null,publishWindow:`2026-10-${String(6+index).padStart(2,'0')}T10:00:00Z`,materialRequirement:{required:true,requestIds:[`${profile}-shared-request`],bindings:[{requirementId:`${profile}-requirement-${index}`,requestId:`${profile}-shared-request`}]}}));
  const all=planWeeklyExecutionTasks('tenant-a',pkg,'2026-10-01T00:00:00Z'),byId=new Map(all.map(t=>[t.taskId,t])),needed=new Set<string>();
  const add=(id:string)=>{if(needed.has(id))return;needed.add(id);byId.get(id)!.dependsOnTaskIds.forEach(add);};all.filter(t=>t.schedule.stepKind==='publishing').forEach(t=>add(t.taskId));
  const tasks=all.filter(t=>needed.has(t.taskId)).map(t=>({...t,status:'queued' as const,ownBlockingReasons:[]}));
  const actors=[...new Set(tasks.map(t=>t.schedule.responsibleActor))];
  const workingWindows=Array.from({length:11},(_,index)=>({startAt:`2026-10-${String(index+1).padStart(2,'0')}T00:00:00Z`,finishAt:`2026-10-${String(index+1).padStart(2,'0')}T23:59:59Z`}));
  const resources=Object.fromEntries(actors.map(actor=>[actor,{concurrency:actor==='customer_agent'?3:actor==='content_agent'?2:1,workingWindows}]));
  const constraints=Object.fromEntries(tasks.map(t=>[t.taskId,{resourceKey:t.schedule.responsibleActor,remainingMinutes:t.schedule.estimatedDurationMinutes,remainingCostCny:0,bufferMinutes:t.schedule.stepKind==='publishing'?0:5,availableAt:'2026-10-01T00:00:00Z'}]));
  return {pkg,tasks,plan:planWeeklyBackwardSchedule({tasks,now:'2026-10-01T00:00:00Z',remainingBudgetCny:0,resources,constraints,frozenOperationalWeek:{weekStart:'2026-10-05',weekEnd:'2026-10-11'}})};
 };
 for(const profile of ['b2b_cold_start','b2b_established'] as const){const result=schedule(profile);assert.equal(result.plan.publicationGap,0,`${profile} ${JSON.stringify(result.plan.publications)} ${JSON.stringify(result.plan.assignments.filter(row=>row.reasons.length))}`);assert.equal(result.plan.unscheduledTaskIds.length,0,profile);const rows=new Map(result.plan.assignments.map(row=>[row.taskId,row])),preparations=result.tasks.filter(t=>t.schedule.stepKind==='material_preparation'),barriers=preparations.filter(t=>t.inputSnapshot.sharedMaterialBarrier);assert.equal(barriers.length,1,profile);assert.equal((barriers[0]!.inputSnapshot.sharedMaterialBarrier as {requestId:string}).requestId,`${profile}-shared-request`);assert.ok(preparations.every(task=>task.taskId===barriers[0]!.taskId||barriers[0]!.dependsOnTaskIds.includes(task.taskId)));assert.ok(result.tasks.filter(t=>t.schedule.stepKind==='script').every(task=>task.dependsOnTaskIds.includes(barriers[0]!.taskId)));assert.ok(new Set(result.plan.agentDailyLoads.filter(load=>load.responsibleActor==='content_agent').map(load=>load.localDate)).size>=4,`${profile} content Agent load is spread over actual confirmed days`);for(const publication of result.pkg.socialContentPackage.publicationTasks){const video=result.tasks.find(t=>t.publicationTaskId===publication.publicationTaskId&&t.schedule.stepKind==='video_generation')!;assert(Date.parse(rows.get(video.taskId)!.finishAt!)<=Date.parse(publication.publishWindow!)-86_400_000,`${profile}:${publication.publicationTaskId}`);}}
});

test('worker leases, retries, dead letters and explicit recovery are durable', async () => {
  const { dataStore, packages, execution, worker, program, draft } = await fixture();
  await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, { expectedVersion: 1, expectedProgramVersion: 1 });
  const start = new Date(Date.now() + 86_400_000);
  const readiness = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-a', now: start, leaseDurationMs: 30_000 });
  assert.ok(readiness);
  assert.equal(readiness.task.workflowKind, 'readiness');
  assert.equal(await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-b', now: new Date(start.getTime() + 1_000) }), null);
  await assert.rejects(worker.complete(readiness, [], new Date(start.getTime() + 2_000)));
  await seedCompleted(dataStore, readiness.task, new Date(start.getTime() + 2_000));

  let claim = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-a', now: new Date(start.getTime() + 3_000) });
  assert.ok(claim);
  assert.equal(claim.task.workflowKind, 'discovery');
  let failed = await worker.fail(claim, { code: 'temporary', message: '临时失败', retryable: true, retryDelayMs: 1000, now: new Date(start.getTime() + 4_000) });
  assert.equal(failed.status, 'queued');
  claim = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-a', now: new Date(start.getTime() + 5_000) });
  assert.ok(claim);
  failed = await worker.fail(claim, { code: 'temporary', message: '再次失败', retryable: true, retryDelayMs: 1000, now: new Date(start.getTime() + 6_000) });
  claim = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-a', now: new Date(start.getTime() + 7_000) });
  assert.ok(claim);
  failed = await worker.fail(claim, { code: 'exhausted', message: '超过重试上限', retryable: true, now: new Date(start.getTime() + 8_000) });
  assert.equal(failed.status, 'dead_letter');
  let tasks = await execution.recoverDeadLetter('tenant-a', program.programId, draft.packageId, failed.taskId);
  assert.equal(tasks.find(task => task.taskId === failed.taskId)!.status, 'queued');
  claim = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-b', now: new Date(start.getTime() + 9_000) });
  assert.ok(claim);
  assert.equal(claim.task.attempt, 4);
  await seedCompleted(dataStore, claim.task, new Date(start.getTime() + 10_000));
  tasks = await execution.list('tenant-a', program.programId, draft.packageId, 1);
  assert.equal(tasks.find(task => task.workflowKind === 'directing')!.status, 'queued');
});

test('expired leases are reclaimed with fencing and local blocks do not stop sibling publications', async () => {
  const { dataStore, packages, execution, worker, program, draft } = await fixture();
  await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, { expectedVersion: 1, expectedProgramVersion: 1 });
  const start = new Date(Date.now() + 86_400_000);
  const stale = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-a', now: start, leaseDurationMs: 30_000 });
  assert.ok(stale);
  const reclaimed = await worker.claimNext({
    tenantId: 'tenant-a', workerId: 'worker-b', now: new Date(start.getTime() + 36_000), leaseDurationMs: 30_000, reclaimGraceMs: 5_000,
  });
  assert.ok(reclaimed);
  assert.equal(reclaimed.task.taskId, stale.task.taskId);
  await assert.rejects(worker.complete(stale, [], new Date(start.getTime() + 37_000)), /durable_lease_lost|weekly_execution_lease_lost/);
  await assert.rejects(worker.complete(reclaimed, [], new Date(start.getTime() + 37_000)));
  await seedCompleted(dataStore, reclaimed.task, new Date(start.getTime() + 37_000));

  await applyBusinessDispatchToExecutionTasks(dataStore, 'tenant-a', program.programId, draft.packageId, 1, {
    dispatchId: 'dispatch-test', packageId: draft.packageId, packageVersion: 1, issuedBy: 'business_agent', assignedTo: 'content_agent',
    detailedScheduleRef: { type: 'weekly_detailed_content_schedule', id: 'schedule-test', version: 1 }, scheduleItemIds: ['item-1', 'item-2'],
    scheduleItems: draft.socialContentPackage.publicationTasks.map((item, index) => ({
      scheduleItemId: `item-${index + 1}`, slotId: 'slot-test', publicationTaskId: item.publicationTaskId, accountId: item.accountId, platform: item.platform,
      topic: item.businessProposition!, directorAnalysisRef: { type: 'weekly_director_analysis', id: 'analysis-test', version: 1 }, benchmarkAccountRefs: [], benchmarkVideoRefs: [],
      materialRequirements: [], materialPlan: { canStartWithExistingAssets: true, fallback: 'premium_aigc', optionalShootTaskIds: [], note: 'test' },
      publishWindow: item.publishWindow!, qualityTier: 'premium', estimatedProductionMinutes: 180,
    })),
    issuedAt: start.toISOString(),
  });

  // This test isolates lease fencing and sibling publication blocking. Model
  // the already-confirmed capacity gate explicitly; the schedule confirmation
  // integration suite verifies the real gate-removal transaction.
  for (const task of await execution.list('tenant-a', program.programId, draft.packageId, 1)) {
    if (!task.ownBlockingReasons.includes('weekly_initial_capacity_schedule_required')) continue;
    const row = await getWeeklyExecutionTaskRow(dataStore, 'tenant-a', task.taskId);
    await writeWeeklyExecutionTask(dataStore, row, {
      ...row.payload,
      ownBlockingReasons: row.payload.ownBlockingReasons.filter(reason => reason !== 'weekly_initial_capacity_schedule_required'),
    });
  }
  await recomputePackageExecution(dataStore, 'tenant-a', program.programId, draft.packageId, 1, start.toISOString(), true);

  // Drain prerequisite work until both independent publication tasks are ready.
  for (let index = 0; index < 40; index += 1) {
    const claim = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-b', kinds: ['discovery', 'directing', 'content', 'engagement'], now: new Date(start.getTime() + 38_000 + index) });
    if (claim) {
      await seedCompleted(dataStore, claim.task, new Date(start.getTime() + 38_000 + index));
      continue;
    }
    const current = await execution.list('tenant-a', program.programId, draft.packageId, 1);
    const approvals = current.filter(task => task.schedule.stepKind === 'user_approval' && task.status === 'queued');
    if (approvals.length) {
      for (const approval of approvals) await seedCompleted(dataStore, approval, new Date(start.getTime() + 38_000 + index));
      continue;
    }
    if (current.filter(task => task.workflowKind === 'publishing').every(task => task.status === 'queued')) break;
  }
  let tasks = await execution.list('tenant-a', program.programId, draft.packageId, 1);
  const publications = tasks.filter(task => task.workflowKind === 'publishing');
  assert.equal(publications.length, 2);
  assert.ok(publications.every(task => task.status === 'queued'), JSON.stringify(tasks.filter(task => task.status !== 'succeeded').map(task => ({ taskId: task.taskId, workflowKind: task.workflowKind, stepKind: task.schedule.stepKind, status: task.status, ownBlockingReasons: task.ownBlockingReasons, inheritedBlockingTaskIds: task.inheritedBlockingTaskIds }))));
  tasks = await execution.block('tenant-a', program.programId, draft.packageId, publications[0]!.taskId, 'account_review_required');
  assert.equal(tasks.find(task => task.taskId === publications[0]!.taskId)!.status, 'blocked');
  assert.equal(tasks.find(task => task.taskId === publications[1]!.taskId)!.status, 'queued');
  const packageView = await packages.get('tenant-a', program.programId, draft.packageId);
  assert.equal(packageView.executionSummary!.byWorkflow.publishing, 'blocked');
  assert.ok(packageView.workflows.find(item => item.kind === 'publishing')!.blockingReasons.includes('account_review_required'));
});

test('unverified completion preserves lease and durable polling does not consume retry budget', async () => {
  const { dataStore, packages, worker, program, draft } = await fixture();
  await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, { expectedVersion: 1, expectedProgramVersion: 1 });
  const now = new Date(Date.now() + 86_400_000);
  const claim = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker', now });
  assert.ok(claim);
  await assert.rejects(worker.complete(claim, [{ type: 'fake', id: 'fake', version: 1 }], now));
  const unchanged = await getWeeklyExecutionTaskRow(dataStore, 'tenant-a', claim.task.taskId);
  assert.equal(unchanged.payload.status, 'leased');
  assert.equal(unchanged.payload.lease!.token, claim.lease.token);
  const deferred = await worker.defer(claim, { code: 'receipt_pending', message: '等待对账', retryDelayMs: 1_000, now });
  assert.equal(deferred.status, 'queued');
  assert.equal(deferred.attempt, 0);
  assert.equal(await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker', now }), null);
  const recovered = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker', now: new Date(now.getTime() + 1_000) });
  assert.ok(recovered);
  const blocked = await worker.defer(recovered, { code: 'credentials_expired', message: '凭据失效', blockingReason: 'credentials_expired', now: new Date(now.getTime() + 1_000) });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.ownBlockingReasons.includes('credentials_expired'));
  assert.equal(blocked.lease, null);
});

test('weekly user approval rejects missing binding/media and accepts an actual reviewed artifact', async context => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { createHash, randomUUID } = await import('node:crypto');
  const { defaultBrief } = await import('../starter198/socialContentTaskSupport.js');
  const { SOCIAL_WORK_PACKAGE_KINDS } = await import('../../shared/contracts/socialContentReplication.js');
  const { dataStore, packages, execution, program, draft } = await fixture();
  await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, { expectedVersion: 1, expectedProgramVersion: 1 });
  const tasks = await execution.list('tenant-a', program.programId, draft.packageId, 1);
  const approval = tasks.find(task => task.schedule.stepKind === 'user_approval')!;
  // Isolate approval from predecessor scheduling; this fixture does not execute production.
  for (const task of tasks.filter(task => task.workflowKind !== 'publishing' && task.schedule.stepKind !== 'user_approval' && !['review', 'engagement'].includes(task.workflowKind))) await seedCompleted(dataStore, task, new Date());
  const approve = () => execution.approve('tenant-a', program.programId, draft.packageId, approval.taskId, 'owner');
  await assert.rejects(approve(), /真实生产身份/);
  const timestamp = new Date().toISOString();
  await dataStore.create('workflow_runs', { id: 'approval-production-run', tenant_id: 'tenant-a', status: 'succeeded' });
  await dataStore.create('starter_social_content_tasks', {
    tenant_id: 'tenant-a', task_id: 'approval-production-task', weekly_plan_id: draft.packageId,
    create_idempotency_key: `weekly-production:${draft.packageId}:1:${approval.publicationTaskId}`,
    run_id: 'approval-production-run', status: 'asset_review', version: '1', task_mode: 'weekly',
    brief: defaultBrief({ title: 'Actual production fixture', objective: 'Verified product', platforms: ['youtube'], languages: ['zh'], formats: ['short_video'], programRef: { objectType: 'social_program', id: program.programId, version: '1' } }),
    package_selection: SOCIAL_WORK_PACKAGE_KINDS.map(kind => ({ kind, packageKey: `fixture-${kind}`, version: '1', name: 'fixture' })),
    source_count: 0, knowledge_source_count: 0, material_source_count: 0, artifact_count: 1, approved_artifact_count: 0, delivery_package_count: 0, publication_count: 0, metric_submission_count: 0,
    created_at: timestamp, updated_at: timestamp,
  });
  const bytes = Buffer.from('isolated weekly approval artifact');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const folder = path.resolve('data/social-content-sources', `weekly-approval-test-${randomUUID()}`);
  const filePath = path.join(folder, `${hash}.mp4`);
  await fs.mkdir(folder, { recursive: true });
  context.after(() => fs.rm(folder, { recursive: true, force: true }));
  await dataStore.create('starter_social_content_artifacts', {
    tenant_id: 'tenant-a', task_id: 'approval-production-task', artifact_id: 'approval-artifact', artifact_kind: 'short_video', origin: 'agent', status: 'review_required', version: '1', resource_ref: 'socialfile:approval-media',
    content: { render: { completed: true }, mediaStorage: { video: { fileId: 'approval-media', sha256: hash, url: '/fixture.mp4' } }, productionResult: { productionResultId: 'approval-production-result', technicalReview: { approved: true }, creativeReview: { approved: true } } },
    created_at: timestamp, updated_at: timestamp,
  });
  const reworkRow = await getWeeklyExecutionTaskRow(dataStore, 'tenant-a', approval.dependsOnTaskIds[0]!);
  await writeWeeklyExecutionTask(dataStore, reworkRow, { ...reworkRow.payload, resultRefs: [{ type: 'starter_social_content_artifact', id: 'approval-artifact', version: 1 }] });
  await assert.rejects(approve());
  await dataStore.create('starter_social_content_files', {
    tenant_id: 'tenant-a', task_id: 'approval-production-task', file_id: 'approval-media', usage: 'artifact_media', name: 'video.mp4', mime_type: 'video/mp4', byte_size: bytes.length, content_sha256: hash,
    storage_kind: 'local', storage_key: path.relative(path.resolve('data/social-content-sources'), filePath), created_at: timestamp,
  });
  await assert.rejects(approve());
  await fs.writeFile(filePath, bytes);
  const accepted = await approve();
  const approved = accepted.find(task => task.taskId === approval.taskId)!;
  assert.equal(approved.status, 'succeeded');
  assert.ok(approved.resultRefs.some(ref => ref.type === 'user_content_approval'));
  const artifactRef = approved.resultRefs.find(ref => ref.type === 'starter_social_content_artifact')!;
  assert.equal(artifactRef.id, 'approval-artifact');
  assert.equal(artifactRef.version, 2);
  const artifact = (await dataStore.list<Record_>('starter_social_content_artifacts', { where: { tenant_id: 'tenant-a', artifact_id: 'approval-artifact' } })).items[0]!;
  assert.equal(artifact.status, 'approved');
  assert.deepEqual((await approve()).find(task => task.taskId === approval.taskId)!.resultRefs, approved.resultRefs);
});

test('weekly user approval is pinned to the artifact completed by the rework dependency', async () => {
  const { dataStore, packages, execution, program, draft } = await fixture();
  await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, { expectedVersion: 1, expectedProgramVersion: 1 });
  const tasks = await execution.list('tenant-a', program.programId, draft.packageId, 1);
  const approval = tasks.find(task => task.schedule.stepKind === 'user_approval')!;
  for (const task of tasks.filter(task => task.workflowKind !== 'publishing' && task.schedule.stepKind !== 'user_approval' && !['review', 'engagement'].includes(task.workflowKind))) await seedCompleted(dataStore, task, new Date());
  const dependency = await getWeeklyExecutionTaskRow(dataStore, 'tenant-a', approval.dependsOnTaskIds[0]!);
  await writeWeeklyExecutionTask(dataStore, dependency, { ...dependency.payload, resultRefs: [{ type: 'starter_social_content_artifact', id: 'expected-child', version: 1 }] });
  await dataStore.create('starter_social_content_tasks', {
    tenant_id: 'tenant-a', task_id: 'approval-bound-task', weekly_plan_id: draft.packageId,
    create_idempotency_key: `weekly-production:${draft.packageId}:1:${approval.publicationTaskId}`,
    status: 'asset_review', version: '1', brief: { programRef: { id: program.programId } },
  });
  const content = { render: { completed: true }, mediaStorage: { video: { fileId: 'other-video' } }, productionResult: { productionResultId: 'other-result' } };
  await dataStore.create('starter_social_content_artifacts', {
    tenant_id: 'tenant-a', task_id: 'approval-bound-task', artifact_id: 'newer-unrelated', artifact_kind: 'short_video', origin: 'agent', status: 'review_required', version: '1', resource_ref: 'socialfile:other', content,
    created_at: '2026-10-10T12:00:00Z', updated_at: '2026-10-10T12:00:00Z',
  });
  await assert.rejects(
    execution.approve('tenant-a', program.programId, draft.packageId, approval.taskId, 'owner'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'weekly_production_artifact_not_reviewable',
  );
});

test('inventory reuse graph creates independent approval and publishing without new production or template extraction',async()=>{const {draft}=await fixture();const inventory={...draft,referenceSourcePolicy:{profile:'b2b_established' as const,ownedPercent:20 as const,externalPercent:80 as const,allocationUnit:'mother_content' as const},socialContentPackage:{...draft.socialContentPackage,publicationTasks:draft.socialContentPackage.publicationTasks.map(p=>({...p,inventoryReuseRef:{type:'weekly_inventory_binding',id:'actualbinding',version:1}}))}};const tasks=planWeeklyExecutionTasks('tenant-a',inventory);assert.ok(!tasks.some(t=>['script','storyboard','material_readiness','asset_generation','video_generation','quality_check','rework','template_extraction','template_performance_validation','benchmark_collection','benchmark_scoring','director_analysis'].includes(t.schedule.stepKind)));for(const pub of inventory.socialContentPackage.publicationTasks){const approval=tasks.find(t=>t.publicationTaskId===pub.publicationTaskId&&t.schedule.stepKind==='user_approval');const publishing=tasks.find(t=>t.publicationTaskId===pub.publicationTaskId&&t.schedule.stepKind==='publishing');const readiness=tasks.filter(t=>t.publicationTaskId===pub.publicationTaskId&&t.schedule.stepKind==='customer_channel_readiness');assert.ok(approval&&publishing);assert.deepEqual(new Set(publishing.dependsOnTaskIds),new Set([approval.taskId,...readiness.map(task=>task.taskId)]));assert.equal(approval.inputSnapshot.startsProduction,false);assert.equal(approval.inputSnapshot.countsAsNewMotherContent,false);assert.deepEqual(approval.inputSnapshot.inventoryReuseRef,pub.inventoryReuseRef);}assert.throws(()=>planWeeklyExecutionTasks('tenant-a',{...inventory,referenceSourcePolicy:draft.referenceSourcePolicy}),/库存任务/);});

test('inventory refs cannot be injected into a new package or revised without the real confirmation record',async()=>{const {dataStore,packages,program,draft}=await fixture();await dataStore.create('users',{id:'owner',tenantId:'tenant-a',role:'admin',active:true});const publications=draft.socialContentPackage.publicationTasks.map(p=>({...p,inventoryReuseRef:{type:'weekly_inventory_binding',id:'a'.repeat(15),version:1}}));await assert.rejects(()=>packages.create('tenant-a','owner',program.programId,{weekStart:'2026-10-12',publicationTasks:publications}),{code:'inventory_create_not_revision'});await assert.rejects(()=>packages.revise('tenant-a','owner',program.programId,draft.packageId,{expectedVersion:1,publicationTasks:publications}),{code:'inventory_binding_integrity_invalid'});const actual=await packages.get('tenant-a',program.programId,draft.packageId);assert.equal(actual.version,1);assert.ok(actual.socialContentPackage.publicationTasks.every(p=>!p.inventoryReuseRef));});

test('legacy graph has no synthetic preparation and current immutable graph cannot be silently replaced',async()=>{
 const {draft,execution,dataStore:store}=await fixture();const legacy=structuredClone(draft);delete legacy.executionGraphVersion;
 const prototype=legacy.socialContentPackage.publicationTasks[0]!;
 legacy.socialContentPackage.publicationTasks=Array.from({length:2},(_,index)=>({...structuredClone(prototype),publicationTaskId:`legacy-shared-${index}`,motherContentId:`legacy-mother-${index}`,adaptationOfPublicationTaskId:null,materialRequirement:{required:true,requestIds:['legacy-shared-request'],bindings:[{requirementId:`legacy-requirement-${index}`,requestId:'legacy-shared-request'}]}}));
 const old=planWeeklyExecutionTasks('tenant-a',legacy);assert.ok(!old.some(t=>t.schedule.stepKind==='material_preparation'));
 for(const script of old.filter(t=>t.schedule.stepKind==='script'))assert.ok(old.find(t=>t.taskId===script.dependsOnTaskIds[0])?.schedule.stepKind==='business_schedule');
 const before=await execution.list('tenant-a',draft.programId,draft.packageId,draft.version);
 const {materializeWeeklyExecutionTasks}=await import('./executionTasks.js');
 await assert.rejects(materializeWeeklyExecutionTasks(store,'tenant-a',legacy),{code:'weekly_execution_task_integrity_violation'});
 const after=await execution.list('tenant-a',draft.programId,draft.packageId,draft.version);assert.deepEqual(after,before);
});


test('revision preview builds the exact new graph without storing tasks or revoking old authority',async()=>{
 const {dataStore,packages,execution,program,draft}=await fixture();const before=await execution.list('tenant-a',program.programId,draft.packageId,draft.version);const fixed='2026-10-01T12:00:00.000Z';const input={expectedVersion:1,changeReason:'制作前先准备实物素材'};
 const preview=await packages.previewRevision('tenant-a','owner',program.programId,draft.packageId,input,{createdAt:fixed});assert.equal(preview.version,2);assert.equal(preview.executionGraphVersion,3);assert.equal(preview.createdAt,fixed);assert.equal((await packages.get('tenant-a',program.programId,draft.packageId)).version,1);assert.deepEqual(await execution.list('tenant-a',program.programId,draft.packageId,draft.version),before);
 const actual=await packages.revise('tenant-a','owner',program.programId,draft.packageId,input,{createdAt:fixed});assert.deepEqual(planWeeklyExecutionTasks('tenant-a',preview).map(t=>({id:t.taskId,dep:t.dependsOnTaskIds,input:t.inputSnapshot})),planWeeklyExecutionTasks('tenant-a',actual).map(t=>({id:t.taskId,dep:t.dependsOnTaskIds,input:t.inputSnapshot})));assert.equal(actual.createdAt,fixed);
});
test('five mother graph preserves every shared preparation request and distinct executable script/storyboard inputs',async()=>{const {draft}=await fixture(),prototype=draft.socialContentPackage.publicationTasks[0]!,pkg=structuredClone(draft);pkg.executionGraphVersion=3;pkg.socialContentPackage.publicationTasks=Array.from({length:5},(_,i)=>({...structuredClone(prototype),publicationTaskId:`mother-publication-${i}`,motherContentId:`mother-${i}`,adaptationOfPublicationTaskId:null,businessProposition:`Actual product purpose ${i}`,cta:`Ask specification ${i}`,publishWindow:`2026-10-${String(6+i).padStart(2,'0')}T10:00:00Z`,materialRequirement:{required:true,requestIds:['shared-factory','shared-person'],bindings:[{requirementId:`factory-${i}`,requestId:'shared-factory'},{requirementId:`person-${i}`,requestId:'shared-person'}]}}));const tasks=planWeeklyExecutionTasks('tenant-a',pkg,'2026-10-01T00:00:00Z'),barriers=tasks.filter(t=>t.inputSnapshot.sharedMaterialBarriers),canonical=barriers[0]!;assert.equal(barriers.length,1);assert.deepEqual((canonical.inputSnapshot.sharedMaterialBarriers as {requestId:string}[]).map(b=>b.requestId),['shared-factory','shared-person']);assert.equal(canonical.publicationTaskId,'mother-publication-0');for(const step of ['script','storyboard'] as const){const items=tasks.filter(t=>t.schedule.stepKind===step);assert.equal(items.length,5);assert.equal(new Set(items.map(t=>t.taskId)).size,5);assert.equal(new Set(items.map(t=>JSON.stringify(t.inputSnapshot))).size,5);for(const item of items){assert.equal(item.packageVersion,pkg.version);assert.equal((item.inputSnapshot.publicationTask as {publicationTaskId:string}).publicationTaskId,item.publicationTaskId);if(step==='script')assert.ok(item.dependsOnTaskIds.includes(canonical.taskId));else{const parent=tasks.find(t=>t.taskId===item.dependsOnTaskIds[0])!;assert.equal(parent.schedule.stepKind,'script');assert.equal(parent.publicationTaskId,item.publicationTaskId);}}}});
