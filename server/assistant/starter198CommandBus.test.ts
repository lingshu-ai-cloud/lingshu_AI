import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARTER_198_CAPABILITIES,
  type Starter198ResourceLimits,
} from '../../shared/contracts/starter198.js';
import type { Starter198AccessSnapshot } from '../starter198/profile.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterRecord,
} from '../starter198/repository.js';
import { AssistantActionError } from './actionRouting.js';
import {
  actionsForMutationTarget,
  createStarter198AssistantCommandBus,
  toStarterCommand,
} from './starter198CommandBus.js';

const context = {
  tenantId: 'tenant-current',
  userId: 'user-current',
  authorization: 'Bearer current',
  page: 'digitalEmployees',
};

const limits: Starter198ResourceLimits = {
  workspaceCount: 1,
  brandCount: 1,
  memberCount: 3,
  agentTeamCount: 1,
  productCount: 1,
  marketCount: 1,
  buyerPersonaCount: 2,
  languageCount: 2,
  primaryPlatformCount: 2,
  concurrentRunCount: 1,
  contentArtifactCountPerCycle: 20,
  contentRevisionCountPerCycle: 3,
  publicationPackageCountPerContent: 2,
  assistedSessionCount: 5,
  inquiryAiCountPerCycle: 100,
  quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0,
  budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

function workspaceRepository(input: {
  runStatus: string;
  approval?: boolean;
}): Starter198Repository {
  const run: StarterRecord = {
    id: 'run-current',
    tenant_id: context.tenantId,
    product_profile: 'starter_198',
    status: input.runStatus,
    started_at: '2026-10-10T00:00:00.000Z',
    updated_at: '2026-10-10T00:01:00.000Z',
  };
  const task: StarterRecord = {
    id: 'task-approval',
    tenant_id: context.tenantId,
    run_id: run.id,
    task_key: 'starter_content_release_approval',
    policy_source: 'starter_198.v1',
    agent_role: 'content',
    business_domain: 'content',
    status: 'waiting_approval',
    sequence: 1,
  };
  const approval: StarterRecord = {
    id: 'approval-current',
    tenant_id: context.tenantId,
    run_id: run.id,
    task_id: task.id,
    status: 'pending',
    subject_version: 'approval-v1',
    risk_level: 'L1',
    created_at: '2026-10-10T00:02:00.000Z',
  };
  const rows = new Map<string, StarterRecord[]>([
    [STARTER_COLLECTIONS.runs, [run]],
    [STARTER_COLLECTIONS.tasks, input.approval ? [task] : []],
    [STARTER_COLLECTIONS.approvals, input.approval ? [approval] : []],
  ]);
  const access: Starter198AccessSnapshot = {
    recordId: 'access-current',
    tenantId: context.tenantId,
    productProfile: 'starter_198',
    profileVersion: 'starter_198.v1',
    entitlementSnapshotId: 'snapshot-current',
    entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
    resourceLimits: limits,
    status: 'active',
    cycleStartedAt: '2026-01-01T00:00:00.000Z',
    cycleEndsAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  };
  return {
    async list(collection, _tenantId, query = {}) {
      const items = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
      return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage ?? 500 };
    },
    async get(collection, _tenantId, id) {
      return rows.get(collection)?.find(row => row.id === id) ?? null;
    },
    async create() { throw new Error('unexpected create'); },
    async update() { throw new Error('unexpected update'); },
    async access() { return access; },
  };
}

function mutableDecisionRepository(): {
  repository: Starter198Repository;
  decide: (input: { draftId: string; decision: 'approved' | 'rejected' }) => Promise<{
    artifactId: string | null; artifactPending: boolean;
  }>;
} {
  const run: StarterRecord = {
    id: 'run-current', tenant_id: context.tenantId, product_profile: 'starter_198', status: 'waiting_approval',
    started_at: '2026-10-10T00:00:00.000Z', updated_at: '2026-10-10T00:01:00.000Z',
  };
  const quoteDrafts = ['a', 'b'].map((suffix, index): StarterRecord => ({
    id: `quote-${suffix}`, tenant_id: context.tenantId, inquiry_id: `inquiry-${suffix}`,
    status: 'draft_ready', input_hash: `quote-${suffix}-v1`, calculation_hash: `calculation-${suffix}`,
    created_at: `2026-10-10T00:0${index + 2}:00.000Z`, updated_at: `2026-10-10T00:0${index + 2}:00.000Z`,
  }));
  const rows = new Map<string, StarterRecord[]>([
    [STARTER_COLLECTIONS.runs, [run]],
    [STARTER_COLLECTIONS.tasks, []],
    [STARTER_COLLECTIONS.approvals, []],
    [STARTER_COLLECTIONS.quoteDrafts, quoteDrafts],
  ]);
  let nextId = 1;
  const repository: Starter198Repository = {
    async list(collection, _tenantId, query = {}) {
      const items = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
      return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage ?? 500 };
    },
    async get(collection, _tenantId, id) {
      return rows.get(collection)?.find(row => row.id === id) ?? null;
    },
    async create(collection, tenantId, data) {
      const record = { id: `created-${nextId++}`, tenant_id: tenantId, ...structuredClone(data) };
      rows.set(collection, [...(rows.get(collection) ?? []), record]);
      return record;
    },
    async update(collection, _tenantId, id, data) {
      const records = rows.get(collection) ?? [];
      const index = records.findIndex(row => row.id === id);
      if (index < 0) throw new Error('record not found');
      records[index] = { ...records[index], ...structuredClone(data) };
    },
    async access() {
      return {
        recordId: 'access-current', tenantId: context.tenantId, productProfile: 'starter_198',
        profileVersion: 'starter_198.v1', entitlementSnapshotId: 'snapshot-current',
        entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
        resourceLimits: limits, status: 'active', cycleStartedAt: '2026-01-01T00:00:00.000Z',
        cycleEndsAt: '2027-01-01T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
      };
    },
  };
  return {
    repository,
    async decide(input) {
      await repository.update(STARTER_COLLECTIONS.quoteDrafts, context.tenantId, input.draftId, {
        status: input.decision === 'approved' ? 'approved' : 'rejected',
      });
      return { artifactId: null, artifactPending: input.decision === 'approved' };
    },
  };
}

test('starter assistant command bus exposes deterministic workspace and returns only provider-backed search results', async () => {
  const searchCalls: string[] = [];
  const bus = createStarter198AssistantCommandBus({
    resolveRole: async () => 'owner',
    searchProvider: {
      async search(input) {
        searchCalls.push(`${input.tenantId}:${input.query}:${input.page}`);
        return {
          domain: 'inspiration', total: 1, sourceStatus: 'ready',
          items: [{ id: 'video-real', title: '卸妆蜜工厂实拍', thumbnailUrl: '/real.jpg' }],
          workspace: { label: '查看全部视频', href: '/?page=socialInspiration&search=%E5%8D%B8%E5%A6%86%E8%9C%9C' },
        };
      },
    },
  });

  const workspace = await bus.execute({
    actionId: 'open_workspace',
    requestId: 'workspace-request-001',
    parameters: { page: 'digitalEmployees', tenantId: 'tenant-other' },
  }, context);
  assert.equal(workspace.workspace?.href, '/?page=digitalEmployees');
  assert.doesNotMatch(workspace.workspace?.href ?? '', /tenant-other/);

  const search = await bus.execute({
    actionId: 'search',
    requestId: 'search-request-001',
    parameters: { query: '卸妆蜜 爆款' },
  }, context);
  assert.equal(search.status, 'completed');
  assert.equal(search.workspace?.label, '查看全部视频');
  assert.equal(search.items?.[0]?.id, 'video-real');
  assert.deepEqual(searchCalls, ['tenant-current:卸妆蜜 爆款:digitalEmployees']);
});

test('view status does not invoke the real-search backend', async () => {
  let searchCalls = 0;
  const result = await createStarter198AssistantCommandBus({
    repository: workspaceRepository({ runStatus: 'running' }),
    resolveRole: async () => 'owner',
    searchProvider: {
      async search() {
        searchCalls += 1;
        throw new Error('unexpected search');
      },
    },
  }).execute({ actionId: 'view_status', requestId: 'status-no-search-001', parameters: {} }, context);
  assert.equal(result.status, 'accepted');
  assert.equal(searchCalls, 0);
});

test('view status reports pending decisions and keeps run control as the second secondary action', async () => {
  for (const [runStatus, controlActionId] of [
    ['waiting_approval', 'pause_task'],
    ['paused', 'resume_task'],
  ] as const) {
    const bus = createStarter198AssistantCommandBus({
      repository: workspaceRepository({ runStatus, approval: true }),
      resolveRole: async () => 'owner',
    });

    const result = await bus.execute({
      actionId: 'view_status',
      requestId: `status-decision-${runStatus}`,
      parameters: {},
    }, context);

    assert.equal(result.status, 'approval_required');
    assert.equal(result.primaryAction?.actionId, 'accept_result');
    assert.deepEqual(result.secondaryActions?.map(action => action.actionId), [
      'request_revision',
      controlActionId,
    ]);
    assert.equal(result.secondaryActions?.length, 2);
    assert.deepEqual(result.secondaryActions?.[1]?.target, {
      objectType: 'run',
      objectId: 'run-current',
      expectedVersion: '2026-10-10T00:01:00.000Z',
    });
  }
});

test('view status maps an active run to accepted and a terminal run to completed', async () => {
  const viewStatus = (runStatus: string, requestId: string) => createStarter198AssistantCommandBus({
    repository: workspaceRepository({ runStatus }),
    resolveRole: async () => 'owner',
  }).execute({ actionId: 'view_status', requestId, parameters: {} }, context);

  assert.equal((await viewStatus('running', 'status-running-001')).status, 'accepted');
  assert.equal((await viewStatus('completed', 'status-completed-001')).status, 'completed');
});

test('view status only requests approval when the current role has an executable decision', async () => {
  const result = await createStarter198AssistantCommandBus({
    repository: workspaceRepository({ runStatus: 'waiting_approval', approval: true }),
    resolveRole: async () => 'operator',
  }).execute({ actionId: 'view_status', requestId: 'status-operator-001', parameters: {} }, context);

  assert.equal(result.status, 'accepted');
  assert.notEqual(result.primaryAction?.actionId, 'accept_result');
  assert.equal(result.details?.[1], '待确认 0 项');
});

test('view status exposes blocked, error and unknown runs as failures', async () => {
  for (const runStatus of ['blocked', 'failed', 'unrecognized-state']) {
    const result = await createStarter198AssistantCommandBus({
      repository: workspaceRepository({ runStatus, approval: true }),
      resolveRole: async () => 'owner',
    }).execute({ actionId: 'view_status', requestId: `status-failure-${runStatus}`, parameters: {} }, context);
    assert.equal(result.status, 'failed');
    assert.match(result.summary, /阻塞|失败|无法确认/);
    assert.equal(result.primaryAction, undefined, 'failed status must not also present an approval action');
  }
});

test('a mutation response never attaches the next decision actions to the completed decision card', async () => {
  const fixture = mutableDecisionRepository();
  const bus = createStarter198AssistantCommandBus({
    repository: fixture.repository,
    resolveRole: async () => 'owner',
    commandDependencies: {
      quoteDecision: { decide: fixture.decide },
    },
  });
  const mutation = await bus.execute({
    actionId: 'accept_result',
    requestId: 'resolve-approval-a-001',
    target: { objectType: 'approval', objectId: 'quote:quote-a', expectedVersion: 'quote-a-v1' },
    parameters: { option: 'accept_result', value: 'accepted', parameters: {} },
  }, context);

  assert.equal(mutation.status, 'completed');
  assert.equal(mutation.primaryAction, undefined);
  assert.equal(mutation.secondaryActions, undefined);

  const refreshed = await bus.execute({
    actionId: 'view_status', requestId: 'status-after-approval-a-001', parameters: {},
  }, context);
  assert.equal(refreshed.primaryAction?.target?.objectId, 'quote:quote-b');
});

test('mutation response actions match the complete target type and id', () => {
  const approvalAction = {
    id: 'approve:shared-id', label: '批准报价', actionId: 'confirm_choice' as const,
    target: { objectType: 'approval' as const, objectId: 'shared-id', expectedVersion: 'approval-v1' },
    parameters: { option: 'approve', value: 'approved', parameters: {} },
  };
  const runAction = {
    id: 'pause:shared-id', label: '暂停任务', actionId: 'pause_task' as const,
    target: { objectType: 'run' as const, objectId: 'shared-id', expectedVersion: 'run-v1' },
  };

  assert.deepEqual(actionsForMutationTarget({
    primaryAction: approvalAction,
    secondaryActions: [runAction],
  }, runAction.target), { primaryAction: runAction });
  assert.deepEqual(actionsForMutationTarget({
    primaryAction: approvalAction,
    secondaryActions: [runAction],
  }, approvalAction.target), { primaryAction: approvalAction });
});

test('assistant start commands persist only an explicit business goal', () => {
  assert.deepEqual(toStarterCommand({
    actionId: 'start_task', requestId: 'goal-command-001', parameters: { goal: '制作 5 条 TikTok 产品视频' },
  }), {
    command: 'submit_orchestrator_input',
    idempotencyKey: 'goal-command-001',
    payload: { input: '制作 5 条 TikTok 产品视频' },
  });
  assert.throws(() => toStarterCommand({
    actionId: 'start_task', requestId: 'goal-command-002', parameters: { text: '开始制作' },
  }), (error: unknown) => error instanceof AssistantActionError
    && error.code === 'assistant_action_goal_required');
});

test('assistant decisions keep their concrete option/value/parameters in the Starter command', () => {
  const target = { objectType: 'approval' as const, objectId: 'approval-7', expectedVersion: 'v7' };
  assert.deepEqual(toStarterCommand({
    actionId: 'accept_result', requestId: 'choice-command-001', target,
    parameters: { option: 'accept_result', value: 'accepted', parameters: { note: '符合验收标准' } },
  }), {
    command: 'resolve_decision',
    idempotencyKey: 'choice-command-001',
    targetId: 'approval-7',
    expectedVersion: 'v7',
    payload: {
      decision: 'approved',
      note: '符合验收标准',
      selection: { option: 'accept_result', value: 'accepted', parameters: { note: '符合验收标准' } },
    },
  });
  assert.deepEqual(toStarterCommand({
    actionId: 'request_revision', requestId: 'choice-command-002', target,
    parameters: { option: 'request_revision', value: 'revision_requested', parameters: {} },
  }).payload, {
    decision: 'rejected',
    note: '用户要求修改',
    selection: { option: 'request_revision', value: 'revision_requested', parameters: {} },
  });
});

test('starter assistant command bus refuses execution without an authenticated organization role', async () => {
  const bus = createStarter198AssistantCommandBus({ resolveRole: async () => null });
  await assert.rejects(
    bus.execute({
      actionId: 'open_workspace',
      requestId: 'workspace-request-002',
      parameters: {},
    }, context),
    (error: unknown) => error instanceof AssistantActionError
      && error.status === 403
      && error.code === 'assistant_action_role_required',
  );
});

test('assistant schedule commands use one signed change-set and return a visual same-card receipt', async () => {
  const calls: string[] = [];
  const change = {
    id: 'change-current', expectedVersion: 'schedule-version-1', sourceLabel: '周五', targetLabel: '周六', platformLabel: 'TikTok',
    items: [
      { id: 'post-1', title: '视频一', thumbnailUrl: 'https://cdn.example.com/one.jpg', accountLabel: 'Aurelia', platform: 'TikTok', sourceScheduledAt: '2026-10-09T02:00:00.000Z', targetScheduledAt: '2026-10-10T02:00:00.000Z', expectedVersion: 'post-v1' },
      { id: 'post-2', title: '视频二', thumbnailUrl: 'https://cdn.example.com/two.jpg', accountLabel: 'Aurelia', platform: 'TikTok', sourceScheduledAt: '2026-10-09T03:00:00.000Z', targetScheduledAt: '2026-10-10T03:00:00.000Z', expectedVersion: 'post-v2' },
    ],
  };
  const bus = createStarter198AssistantCommandBus({
    resolveRole: async () => 'owner',
    scheduleAdjustment: {
      async prepare() { calls.push('prepare'); return change; },
      async confirm() { calls.push('confirm'); return { ...change, expectedVersion: 'schedule-version-2' }; },
      async pendingForUser() { return null; },
    },
  });

  const prepared = await bus.execute({
    actionId: 'prepare_schedule_change', requestId: 'schedule-bus-prepare-001',
    parameters: { platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2 },
  }, context);
  assert.equal(prepared.status, 'approval_required');
  assert.equal(prepared.primaryAction?.actionId, 'confirm_schedule_change');
  assert.deepEqual(prepared.primaryAction?.target, {
    objectType: 'schedule_change', objectId: 'change-current', expectedVersion: 'schedule-version-1',
  });
  assert.equal(prepared.items?.length, 2);
  assert.equal(prepared.items?.[0]?.transition, '周五 → 周六');
  assert.equal(prepared.items?.[0]?.accountLabel, 'Aurelia · TikTok');
  assert.deepEqual(prepared.secondaryActions, [{
    id: 'modify-schedule:change-current', label: '修改时间', href: '/?page=traffic#publishing-calendar',
  }]);

  const receipt = await bus.execute({
    actionId: 'confirm_schedule_change', requestId: 'schedule-bus-confirm-001',
    target: { objectType: 'schedule_change', objectId: 'change-current', expectedVersion: 'schedule-version-1' },
    parameters: {},
  }, context);
  assert.equal(receipt.title, '2 条排期已更新');
  assert.deepEqual(receipt.workspace, { label: '查看日历', href: '/?page=traffic#publishing-calendar' });
  assert.deepEqual(calls, ['prepare', 'confirm']);
});
