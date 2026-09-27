import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { DURABLE_OPERATION_LEASE_COLLECTION } from '../runtime/durableLease.js';
import { createSocialWeeklyExecutionWorker } from '../runtime/socialWeeklyExecutionWorker.js';
import { createSocialProgramService } from './service.js';
import { createWeeklyExecutionTaskService, WEEKLY_EXECUTION_TASKS } from './executionTasks.js';
import { createWeeklyOperatingPackageService } from './weeklyOperatingPackages.js';
import { createSocialOperatingRepository } from '../socialOperating/repository.js';

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

test('weekly execution tasks freeze the full worker contract and aggregate real state', async () => {
  const { packages, execution, program, draft } = await fixture();
  assert.equal(draft.executionSummary!.total, 9);
  assert.equal(draft.executionSummary!.byStatus.pending_activation, 9);
  assert.ok(draft.executionTaskRefs!.every(ref => ref.type === 'weekly_execution_task'));
  const active = await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, {
    expectedVersion: 1, expectedProgramVersion: 1,
  });
  assert.equal(active.executionSummary!.byStatus.queued, 1);
  assert.equal(active.executionSummary!.byStatus.blocked, 8);
  const tasks = await execution.list('tenant-a', program.programId, draft.packageId, 1);
  assert.ok(tasks.every(task => task.tenantId === 'tenant-a' && task.packageVersion === 1));
  assert.ok(tasks.every(task => task.idempotencyKey && task.inputSnapshot && task.budget && task.upstreamVersionRefs.length === 3));
  assert.ok(tasks.some(task => task.scope === 'adaptation'));
  const firstTask = (await packages.get('tenant-a', program.programId, draft.packageId)).executionSummary!;
  assert.equal(firstTask.total, 9);
});

test('worker leases, retries, dead letters and explicit recovery are durable', async () => {
  const { packages, execution, worker, program, draft } = await fixture();
  await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, { expectedVersion: 1, expectedProgramVersion: 1 });
  const start = new Date('2026-10-05T00:00:00.000Z');
  const readiness = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-a', now: start, leaseDurationMs: 30_000 });
  assert.ok(readiness);
  assert.equal(readiness.task.workflowKind, 'readiness');
  assert.equal(await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-b', now: new Date(start.getTime() + 1_000) }), null);
  await worker.complete(readiness, [{ type: 'readiness_result', id: 'ready-1', version: 1 }], new Date(start.getTime() + 2_000));

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
  await worker.complete(claim, [{ type: 'discovery_result', id: 'discovery-1', version: 2 }], new Date(start.getTime() + 10_000));
  tasks = await execution.list('tenant-a', program.programId, draft.packageId, 1);
  assert.equal(tasks.find(task => task.workflowKind === 'directing')!.status, 'queued');
});

test('expired leases are reclaimed with fencing and local blocks do not stop sibling publications', async () => {
  const { packages, execution, worker, program, draft } = await fixture();
  await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, { expectedVersion: 1, expectedProgramVersion: 1 });
  const start = new Date('2026-10-05T00:00:00.000Z');
  const stale = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-a', now: start, leaseDurationMs: 30_000 });
  assert.ok(stale);
  const reclaimed = await worker.claimNext({
    tenantId: 'tenant-a', workerId: 'worker-b', now: new Date(start.getTime() + 36_000), leaseDurationMs: 30_000, reclaimGraceMs: 5_000,
  });
  assert.ok(reclaimed);
  assert.equal(reclaimed.task.taskId, stale.task.taskId);
  await assert.rejects(worker.complete(stale, [], new Date(start.getTime() + 37_000)), /durable_lease_lost|weekly_execution_lease_lost/);
  await worker.complete(reclaimed, [], new Date(start.getTime() + 37_000));

  // Drain prerequisite work until both independent publication tasks are ready.
  for (let index = 0; index < 4; index += 1) {
    const claim = await worker.claimNext({ tenantId: 'tenant-a', workerId: 'worker-b', now: new Date(start.getTime() + 38_000 + index) });
    assert.ok(claim);
    await worker.complete(claim, [], new Date(start.getTime() + 38_000 + index));
  }
  let tasks = await execution.list('tenant-a', program.programId, draft.packageId, 1);
  const publications = tasks.filter(task => task.workflowKind === 'publishing');
  assert.equal(publications.length, 2);
  assert.ok(publications.every(task => task.status === 'queued'));
  tasks = await execution.block('tenant-a', program.programId, draft.packageId, publications[0]!.taskId, 'account_review_required');
  assert.equal(tasks.find(task => task.taskId === publications[0]!.taskId)!.status, 'blocked');
  assert.equal(tasks.find(task => task.taskId === publications[1]!.taskId)!.status, 'queued');
  const packageView = await packages.get('tenant-a', program.programId, draft.packageId);
  assert.equal(packageView.executionSummary!.byWorkflow.publishing, 'blocked');
  assert.ok(packageView.workflows.find(item => item.kind === 'publishing')!.blockingReasons.includes('account_review_required'));
});
