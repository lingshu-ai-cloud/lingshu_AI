import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { WEEKLY_OPERATING_WORKFLOW_KINDS } from '../../shared/contracts/socialProgram.js';
import { createSocialProgramService, SocialProgramError } from './service.js';
import { createWeeklyOperatingPackageService } from './weeklyOperatingPackages.js';
import { createSocialOperatingRepository } from '../socialOperating/repository.js';

function memoryStore(): DataStore {
  const rows = new Map<string, Array<Record_>>();
  let counter = 0;
  return {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
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
      let items = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const field = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((left, right) => {
          const a = left[field];
          const b = right[field];
          const comparison = typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a ?? '').localeCompare(String(b ?? ''));
          return comparison * (descending ? -1 : 1);
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      const start = (page - 1) * perPage;
      return {
        items: structuredClone(items.slice(start, start + perPage)) as T[],
        totalItems: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / perPage)),
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
  const program = await programs.createProgram('tenant-a', 'owner', {
    brandName: 'Factory A', market: '北美', targetAudience: '品牌采购',
    candidatePlatforms: ['tiktok', 'facebook', 'instagram', 'youtube'], route: 'cold_start',
  });
  const accountIds: Record<string, string[]> = { tiktok: [], facebook: [], instagram: [], youtube: [] };
  for (const [platform, count] of [['tiktok', 2], ['facebook', 2], ['instagram', 1], ['youtube', 1]] as const) {
    for (let index = 0; index < count; index += 1) {
      const account = await programs.createAccount('tenant-a', 'owner', program.programId, {
        platform, displayName: `${platform}-${index + 1}`, businessRole: index === 0 ? '核心账号' : '协同账号',
        audiencePromise: '服务目标采购', contentPromise: '可验证的产品与工厂内容',
      });
      accountIds[platform]!.push(account.accountId);
    }
  }
  return { dataStore, programs, packages, program, accountIds };
}

async function authoritativeInput(
  dataStore: DataStore,
  programId: string,
  accountIds: Record<string, string[]>,
): Promise<Record<string, unknown>> {
  const repository = createSocialOperatingRepository(dataStore);
  const goalRef = { type: 'business_content_goal', id: `goal-${programId}`, version: 1 };
  const goal = {
    goalId: goalRef.id, programId, version: 1, status: 'ready', objective: '获取可资格确认的采购咨询',
    products: ['精华'], markets: ['北美'], audiences: ['品牌采购'], languages: ['en'],
    accountBoundaries: [], conversionRouteIds: ['route-1'], publicFactRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 1 }],
    prohibitedClaims: [], weeklyBudgetCny: 2600, evidence: [], blockers: [], inputRefs: [], inputFingerprint: `goal-fp-${programId}`,
    ruleVersion: 'business-content-goal/1.0.0', decisionRecordRef: { type: 'decision_record', id: `goal-decision-${programId}`, version: 1 },
    createdBy: 'operating-agent', createdAt: '2026-10-01T00:00:00.000Z',
  } as any;
  const goalDecision = {
    decisionId: `goal-decision-${programId}`, decisionType: 'business_content_goal', subjectRef: goalRef, version: 1,
    outcome: 'accepted', ruleVersion: 'business-content-goal/1.0.0', inputRefs: [], inputFingerprint: goal.inputFingerprint,
    evidence: [], blockers: [], impacts: [], output: goalRef, operator: { type: 'agent', id: 'operating-agent' }, decidedAt: goal.createdAt,
  } as any;
  await repository.save('tenant-a', goal, goalDecision);
  const quotas = [
    ...accountIds.tiktok!.map(accountId => ({ accountId, publicationQuota: 5 })),
    ...accountIds.facebook!.map(accountId => ({ accountId, publicationQuota: 5 })),
    ...accountIds.instagram!.map(accountId => ({ accountId, publicationQuota: 3 })),
    ...accountIds.youtube!.map(accountId => ({ accountId, publicationQuota: 3 })),
  ];
  const capacityRef = { type: 'capacity_plan', id: `capacity-${programId}`, version: 1 };
  await repository.saveDecision('tenant-a', programId, {
    decisionId: capacityRef.id, decisionType: 'capacity_plan', subjectRef: goalRef, version: 1, outcome: 'accepted',
    ruleVersion: 'capacity-planner/1.0.0', inputRefs: [goalRef], inputFingerprint: `capacity-fp-${programId}`,
    evidence: [], blockers: [], output: { status: 'ready', originalContentQuota: 10, adaptationQuota: 16, publicationQuota: 26, accountQuotas: quotas, estimatedCostCny: 2600, limitingFactors: [] },
    operator: { type: 'agent', id: 'capacity-agent' }, decidedAt: '2026-10-01T00:01:00.000Z',
  });
  const policyRef = { type: 'automation_policy', id: `policy-${programId}`, version: 1 };
  await repository.saveDecision('tenant-a', programId, {
    decisionId: policyRef.id, decisionType: 'automation_policy', subjectRef: goalRef, version: 1, outcome: 'accepted',
    ruleVersion: 'automation-policy/1.0.0', inputRefs: [goalRef], inputFingerprint: `policy-fp-${programId}`,
    evidence: [], blockers: [], output: { status: 'allowed', mode: 'managed', action: 'draft', humanGate: 'none', automaticExecutionAllowed: true, authorizationIssue: null },
    operator: { type: 'agent', id: 'policy-agent' }, decidedAt: '2026-10-01T00:02:00.000Z',
  });
  return {
    businessContentGoalRef: goalRef,
    capacityPlanRef: capacityRef,
    automationPolicyRef: policyRef,
    publicationTasks: Array.from({ length: 26 }, (_, index) => ({
      businessProposition: `业务主张-${index + 1}`, cta: '查看产品页',
      factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 1 }],
      metricTargets: ['qualified_inquiry'], publishWindow: '2026-10-05/2026-10-11',
    })),
  };
}

test('weekly operating package: default six-account cadence creates seven workflows and 26 publication tasks', async () => {
  const { packages, program } = await fixture();
  const item = await packages.create('tenant-a', 'owner', program.programId, {
    weekStart: '2026-10-05', objective: '获取可资格确认的采购咨询', successCriteria: ['发布任务按账号完成'],
  });
  assert.equal(item.version, 1);
  assert.equal(item.status, 'draft');
  assert.equal(item.weekEnd, '2026-10-11');
  assert.deepEqual(item.workflows.map(workflow => workflow.kind), WEEKLY_OPERATING_WORKFLOW_KINDS);
  assert.equal(item.workflowTasks.length, 7);
  assert.ok(item.workflows.every(workflow => workflow.taskRefs.length === 1));
  assert.ok(item.planningBlockers.includes('capacity_plan_unavailable'));
  assert.ok(item.planningBlockers.some(reason => reason.endsWith(':cta_required')));
  assert.equal(item.workflows.find(workflow => workflow.kind === 'readiness')!.status, 'blocked');
  assert.equal(item.socialContentPackage.originalContentTarget, 10);
  assert.equal(item.socialContentPackage.adaptationVersionTarget, 16);
  assert.equal(item.socialContentPackage.publicationTaskTarget, 26);
  assert.equal(item.socialContentPackage.publicationTasks.length, 26);
  assert.equal(item.socialContentPackage.authorization.mode, 'bounded');
  assert.equal(item.socialContentPackage.authorization.maxPublishItems, 26);
  assert.equal(item.socialContentPackage.authorization.allowRealPublishing, false);
  assert.equal(item.socialContentPackage.authorization.authorizedAt, null);
  assert.equal(item.socialContentPackage.authorization.revokedAt, null);
  const counts = Object.fromEntries(['tiktok', 'facebook', 'instagram', 'youtube'].map(platform => [
    platform,
    item.socialContentPackage.publicationTasks.filter(task => task.platform === platform).length,
  ]));
  assert.deepEqual(counts, { tiktok: 10, facebook: 10, instagram: 3, youtube: 3 });
  const perAccount = new Map<string, number>();
  for (const task of item.socialContentPackage.publicationTasks) perAccount.set(task.accountId, (perAccount.get(task.accountId) ?? 0) + 1);
  assert.deepEqual([...perAccount.values()].sort((a, b) => a - b), [3, 3, 5, 5, 5, 5]);
  assert.equal(new Set(item.socialContentPackage.publicationTasks.map(task => task.publicationTaskId)).size, 26);
});

test('weekly operating package: user cadence creates an immutable revision and enforces optimistic locking', async () => {
  const { packages, program, accountIds } = await fixture();
  const first = await packages.create('tenant-a', 'owner', program.programId, {
    weekStart: '2026-10-05', objective: '首周验证', successCriteria: ['按时交付'],
  });
  const revised = await packages.revise('tenant-a', 'owner', program.programId, first.packageId, {
    expectedVersion: 1,
    changeReason: '用户调整本周发布量',
    originalContentTarget: 4,
    authorizationMode: 'bounded',
    accountPlans: [
      { accountId: accountIds.tiktok![0], publicationCount: 4 },
      { accountId: accountIds.youtube![0], publicationCount: 2 },
    ],
  });
  assert.equal(revised.version, 2);
  assert.equal(revised.previousVersion, 1);
  assert.equal(revised.socialContentPackage.publicationTaskTarget, 6);
  assert.equal(revised.socialContentPackage.adaptationVersionTarget, 2);
  assert.equal(revised.socialContentPackage.authorization.maxPublishItems, 6);
  assert.equal(revised.taskVersionMappings.length, 7);
  const history = await packages.list('tenant-a', program.programId);
  assert.deepEqual(history.map(item => item.version), [2, 1]);
  await assert.rejects(
    packages.revise('tenant-a', 'owner', program.programId, first.packageId, { expectedVersion: 1 }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'version_conflict',
  );
  await assert.rejects(packages.get('tenant-b', program.programId, first.packageId), /\u793e\u5a92\u9879\u76ee\u4e0d\u5b58\u5728/);
});

test('weekly operating package: workflow event replay is idempotent and blocking stays on dependants', async () => {
  const { dataStore, packages, program, accountIds } = await fixture();
  const authority = await authoritativeInput(dataStore, program.programId, accountIds);
  const item = await packages.create('tenant-a', 'owner', program.programId, {
    ...authority, weekStart: '2026-10-05', objective: '状态机', successCriteria: ['可重放'],
  });
  const readiness = item.workflowTasks.find(task => task.kind === 'readiness')!;
  const event = { eventId: 'evt-1', taskId: readiness.taskId, type: 'start' as const, occurredAt: '2026-10-01T00:00:00.000Z' };
  const once = await packages.applyWorkflowEvent('tenant-a', 'owner', program.programId, item.packageId, { expectedVersion: 1, expectedStateVersion: 0, event });
  const replay = await packages.applyWorkflowEvent('tenant-a', 'owner', program.programId, item.packageId, { expectedVersion: 1, expectedStateVersion: 0, event });
  assert.equal(replay.appliedWorkflowEvents.length, 1);
  assert.equal(replay.workflowStateVersion, 1);
  assert.deepEqual(replay, once);
  const completed = await packages.applyWorkflowEvent('tenant-a', 'owner', program.programId, item.packageId, {
    expectedVersion: 1, expectedStateVersion: 1,
    event: { eventId: 'evt-2', taskId: readiness.taskId, type: 'complete', occurredAt: '2026-10-01T00:00:30.000Z' },
  });
  const discovery = completed.workflowTasks.find(task => task.kind === 'discovery')!;
  const blocked = await packages.applyWorkflowEvent('tenant-a', 'owner', program.programId, item.packageId, {
    expectedVersion: 1, expectedStateVersion: 2,
    event: { eventId: 'evt-3', taskId: discovery.taskId, type: 'block', reason: 'discovery_provider_unavailable', occurredAt: '2026-10-01T00:01:00.000Z' },
  });
  assert.equal(blocked.workflowTasks.find(task => task.kind === 'readiness')!.status, 'completed');
  assert.equal(blocked.workflowTasks.find(task => task.kind === 'directing')!.status, 'blocked');
  await assert.rejects(
    packages.applyWorkflowEvent('tenant-a', 'owner', program.programId, item.packageId, {
      expectedVersion: 1, expectedStateVersion: 3,
      event: { eventId: 'evt-4', taskId: discovery.taskId, type: 'unblock', occurredAt: '2026-10-01T00:02:00.000Z' },
    }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'workflow_unblock_authority_required',
  );
});

test('weekly operating package: discovery and production budgets remain independent', async () => {
  const { packages, program } = await fixture();
  const item = await packages.create('tenant-a', 'owner', program.programId, {
    weekStart: '2026-10-05', objective: '预算隔离', successCriteria: ['预算不串用'],
    weeklyBudgetCny: 2000, discoveryBudgetCny: 300,
  });
  assert.equal(item.socialContentPackage.weeklyBudgetCny, 2000);
  assert.equal(item.discoveryBudgetCny, 300);
});

test('weekly operating package: revision preserves per-task fields for retained accounts', async () => {
  const { packages, program } = await fixture();
  const first = await packages.create('tenant-a', 'owner', program.programId, {
    weekStart: '2026-10-05', objective: '保留逐条编辑', successCriteria: ['CTA 不丢失'],
  });
  const editedTasks = structuredClone(first.socialContentPackage.publicationTasks);
  editedTasks[0]!.cta = '查看产品页';
  editedTasks[0]!.businessProposition = '七天打样';
  const withTaskEdit = await packages.revise('tenant-a', 'owner', program.programId, first.packageId, {
    expectedVersion: 1, publicationTasks: editedTasks,
  });
  const budgetRevision = await packages.revise('tenant-a', 'owner', program.programId, first.packageId, {
    expectedVersion: 2, weeklyBudgetCny: 1200,
  });
  assert.equal(budgetRevision.socialContentPackage.publicationTasks[0]!.publicationTaskId, withTaskEdit.socialContentPackage.publicationTasks[0]!.publicationTaskId);
  assert.equal(budgetRevision.socialContentPackage.publicationTasks[0]!.cta, '查看产品页');
  assert.equal(budgetRevision.socialContentPackage.publicationTasks[0]!.businessProposition, '七天打样');
});

test('weekly operating package: invalid calendar dates are rejected', async () => {
  const { packages, program } = await fixture();
  await assert.rejects(
    packages.create('tenant-a', 'owner', program.programId, {
      weekStart: '2026-02-31', objective: '无效日期', successCriteria: ['不应创建'],
    }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'week_start_invalid',
  );
});

test('weekly operating package: activation updates package status and versioned program reference', async () => {
  const { dataStore, packages, programs, program, accountIds } = await fixture();
  const authority = await authoritativeInput(dataStore, program.programId, accountIds);
  const draft = await packages.create('tenant-a', 'owner', program.programId, {
    ...authority, weekStart: '2026-10-05', objective: '活动周包', successCriteria: ['有界授权'],
    authorizationMode: 'bounded', allowRealPublishing: false,
    originalContentTarget: 1,
    weeklyBudgetCny: 1,
    accountPlans: [{ accountId: accountIds.tiktok![0], publicationCount: 1 }],
  });
  assert.equal(draft.socialContentPackage.originalContentTarget, 10, '客户端不得覆盖权威容量目标');
  assert.equal(draft.socialContentPackage.publicationTaskTarget, 26);
  assert.equal(draft.socialContentPackage.weeklyBudgetCny, 2600);
  const active = await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, {
    expectedVersion: 1, expectedProgramVersion: 1,
  });
  assert.equal(active.status, 'active');
  assert.equal(active.socialContentPackage.status, 'active');
  assert.equal(active.socialContentPackage.authorization.mode, 'bounded');
  assert.equal(active.socialContentPackage.authorization.maxPublishItems, 26);
  assert.equal(active.socialContentPackage.authorization.allowRealPublishing, false, '计划激活不得隐式授予真实发布');
  const updatedProgram = await programs.getProgram('tenant-a', program.programId);
  assert.deepEqual(updatedProgram.activeWeeklyOperatingPackageRef, {
    type: 'weekly_operating_package', id: draft.packageId, version: 1,
  });
  assert.equal(updatedProgram.version, 2);
});

test('weekly operating package: explicit activation authorizes only the frozen bounded content version', async () => {
  const { dataStore, packages, programs, program, accountIds } = await fixture();
  const authority = await authoritativeInput(dataStore, program.programId, accountIds);
  const draft = await packages.create('tenant-a', 'owner', program.programId, {
    ...authority, weekStart: '2026-10-05', objective: '包级授权', successCriteria: ['受限账号和数量'],
    allowRealPublishing: true,
  });
  assert.equal(draft.socialContentPackage.authorization.allowRealPublishing, false, '草稿输入不得隐式开启发布');
  const active = await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, {
    expectedVersion: 1, expectedProgramVersion: 1, authorizePublishing: true,
  });
  assert.equal(active.socialContentPackage.authorization.mode, 'bounded');
  assert.equal(active.socialContentPackage.authorization.maxPublishItems, 26);
  assert.equal(active.socialContentPackage.authorization.allowRealPublishing, true);
  assert.equal(active.socialContentPackage.authorization.authorizedBy, 'owner');
  assert.ok(active.socialContentPackage.authorization.authorizedAt);

  const revised = await packages.revise('tenant-a', 'owner', program.programId, draft.packageId, {
    expectedVersion: 1, weeklyBudgetCny: 2000,
  });
  assert.equal(revised.socialContentPackage.authorization.allowRealPublishing, false, '新版本必须重新授权');
  assert.equal(revised.socialContentPackage.authorization.authorizedBy, null);
  const history = await packages.list('tenant-a', program.programId);
  const invalidatedV1 = history.find(item => item.version === 1)!;
  assert.equal(invalidatedV1.socialContentPackage.authorization.allowRealPublishing, false);
  assert.equal(invalidatedV1.socialContentPackage.authorization.revokedBy, 'owner');
  assert.equal((await programs.getProgram('tenant-a', program.programId)).version, 2);
});

test('weekly operating package: retiring an active version revokes publishing and clears the program reference', async () => {
  const { dataStore, packages, programs, program, accountIds } = await fixture();
  const authority = await authoritativeInput(dataStore, program.programId, accountIds);
  const draft = await packages.create('tenant-a', 'owner', program.programId, {
    ...authority, weekStart: '2026-10-05', objective: '可撤回周包', successCriteria: ['撤回后停止发布'],
  });
  await packages.activate('tenant-a', 'owner', program.programId, draft.packageId, {
    expectedVersion: 1, expectedProgramVersion: 1, authorizePublishing: true,
  });
  await assert.rejects(
    packages.retire('tenant-a', 'owner', program.programId, draft.packageId, {
      expectedVersion: 1, expectedProgramVersion: 1,
    }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'program_version_conflict',
  );
  assert.equal((await packages.get('tenant-a', program.programId, draft.packageId)).status, 'active');

  const retired = await packages.retire('tenant-a', 'owner', program.programId, draft.packageId, {
    expectedVersion: 1, expectedProgramVersion: 2,
  });
  assert.equal(retired.status, 'retired');
  assert.equal(retired.socialContentPackage.status, 'retired');
  assert.equal(retired.socialContentPackage.authorization.allowRealPublishing, false);
  assert.equal(retired.socialContentPackage.authorization.revokedBy, 'owner');
  assert.ok(retired.socialContentPackage.authorization.revokedAt);
  const updatedProgram = await programs.getProgram('tenant-a', program.programId);
  assert.equal(updatedProgram.activeWeeklyOperatingPackageRef, null);
  assert.equal(updatedProgram.version, 3);
});

test('weekly operating package: default cadence reports a missing account matrix instead of inventing accounts', async () => {
  const dataStore = memoryStore();
  const programs = createSocialProgramService(dataStore);
  const packages = createWeeklyOperatingPackageService(dataStore);
  const program = await programs.createProgram('tenant-a', 'owner', {
    brandName: 'Incomplete', market: '欧洲', targetAudience: '采购', candidatePlatforms: ['youtube'], route: 'cold_start',
  });
  await assert.rejects(
    packages.create('tenant-a', 'owner', program.programId, {
      weekStart: '2026-10-05', objective: '不伪造账号', successCriteria: ['显示缺口'],
    }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'default_account_matrix_incomplete',
  );
});

test('weekly operating package: activation fails closed on planning and G2 blockers', async () => {
  const { packages, program } = await fixture();
  const draft = await packages.create('tenant-a', 'owner', program.programId, {
    weekStart: '2026-10-05', objective: '不完整草稿', successCriteria: ['不得激活'],
  });
  await assert.rejects(
    packages.activate('tenant-a', 'owner', program.programId, draft.packageId, {
      expectedVersion: 1, expectedProgramVersion: 1,
    }),
    (error: unknown) => error instanceof SocialProgramError
      && error.code === 'weekly_operating_package_activation_blocked'
      && /g2:/.test(error.message),
  );
});

test('weekly operating package: clients cannot inject authoritative planning objects', async () => {
  const { packages, program } = await fixture();
  await assert.rejects(
    packages.create('tenant-a', 'owner', program.programId, {
      weekStart: '2026-10-05', objective: '伪造决策', successCriteria: ['应被拒绝'],
      businessContentGoal: { status: 'ready', blockers: [] },
      capacityPlan: { status: 'ready', blockers: [], accountPlans: [] },
      automationPolicy: { status: 'ready', blockers: [] },
    }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'authoritative_object_injection_forbidden',
  );
});

test('weekly workflow event stream serializes concurrent writers and recovers after a failed append', async () => {
  const { dataStore, packages, program, accountIds } = await fixture();
  const authority = await authoritativeInput(dataStore, program.programId, accountIds);
  const draft = await packages.create('tenant-a', 'owner', program.programId, {
    ...authority, weekStart: '2026-10-05', objective: '并发状态', successCriteria: ['CAS'],
  });
  const readiness = draft.workflowTasks.find(task => task.kind === 'readiness')!;
  const results = await Promise.allSettled([
    packages.applyWorkflowEvent('tenant-a', 'owner-a', program.programId, draft.packageId, {
      expectedVersion: 1, expectedStateVersion: 0,
      event: { eventId: 'concurrent-start', taskId: readiness.taskId, type: 'start', occurredAt: '2026-10-01T00:00:00.000Z' },
    }),
    packages.applyWorkflowEvent('tenant-a', 'owner-b', program.programId, draft.packageId, {
      expectedVersion: 1, expectedStateVersion: 0,
      event: { eventId: 'concurrent-block', taskId: readiness.taskId, type: 'block', reason: 'transient', occurredAt: '2026-10-01T00:00:01.000Z' },
    }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof SocialProgramError);
  assert.equal(rejected.reason.code, 'workflow_state_version_conflict');
  const recovered = await createWeeklyOperatingPackageService(dataStore).get('tenant-a', program.programId, draft.packageId);
  assert.equal(recovered.workflowStateVersion, 1);
  assert.equal(recovered.appliedWorkflowEvents.length, 1);

  let failNextEvent = true;
  const faultStore: DataStore = {
    ...dataStore,
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (collection === 'social_weekly_workflow_events' && failNextEvent) {
        failNextEvent = false;
        return null;
      }
      return dataStore.create<T>(collection, data);
    },
  };
  const faultService = createWeeklyOperatingPackageService(faultStore);
  const current = await faultService.get('tenant-a', program.programId, draft.packageId);
  const currentReadiness = current.workflowTasks.find(task => task.kind === 'readiness')!;
  const nextType = currentReadiness.status === 'in_progress' ? 'complete' as const : 'start' as const;
  await assert.rejects(
    faultService.applyWorkflowEvent('tenant-a', 'owner', program.programId, draft.packageId, {
      expectedVersion: 1, expectedStateVersion: 1,
      event: { eventId: 'recoverable-event', taskId: readiness.taskId, type: nextType, occurredAt: '2026-10-01T00:02:00.000Z' },
    }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'workflow_event_storage_unavailable',
  );
  const retried = await faultService.applyWorkflowEvent('tenant-a', 'owner', program.programId, draft.packageId, {
    expectedVersion: 1, expectedStateVersion: 1,
    event: { eventId: 'recoverable-event', taskId: readiness.taskId, type: nextType, occurredAt: '2026-10-01T00:02:00.000Z' },
  });
  assert.equal(retried.workflowStateVersion, 2);
});

test('weekly operating package migration defines immutable versions and one active package per program week', () => {
  const migration = readFileSync('pb_migrations/1790726400_create_weekly_operating_packages.js', 'utf8');
  assert.match(migration, /idx_weekly_operating_package_version/);
  assert.match(migration, /UNIQUE INDEX idx_weekly_operating_package_active/);
  assert.match(migration, /WHERE status = 'active'/);
  assert.match(migration, /updated_by/);
  assert.match(migration, /updated_at/);
  const eventsMigration = readFileSync('pb_migrations/1791072000_create_social_weekly_workflow_events.js', 'utf8');
  assert.match(eventsMigration, /UNIQUE INDEX idx_social_weekly_workflow_event_id/);
  assert.match(eventsMigration, /UNIQUE INDEX idx_social_weekly_workflow_state_version/);
  assert.match(eventsMigration, /updateRule: "@request\.auth\.id != '' && false"/);
});
