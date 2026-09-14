import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Starter198Capability, Starter198ResourceLimits } from '../../shared/contracts/starter198.js';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import { STARTER_198_DEFAULT_LIMITS } from './provisioning.js';
import { assertOrchestratorAdmissionQuota, Starter198QuotaError } from './quota.js';
import {
  STARTER_COLLECTIONS,
  Starter198RepositoryError,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import { aggregateStarterAgentUsage } from './usage.js';
import {
  failStarterUsage,
  reserveStarterUsage,
  settleStarterUsage,
  Starter198UsageLedgerError,
  type StarterUsageResourceUnits,
} from './usageLedger.js';

const now = new Date('2026-09-12T08:00:00.000Z');
const zeroUnits: StarterUsageResourceUnits = { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 };

function memoryRepository(input: {
  tenantId: string;
  limits?: Starter198ResourceLimits;
  disabledCapability?: Starter198Capability;
}) {
  const rows = new Map<string, StarterRecord[]>();
  let serial = 0;
  const limits = input.limits ?? STARTER_198_DEFAULT_LIMITS;
  const accessWindow = {
    startedAt: '2026-09-10T00:00:00.000Z',
    endsAt: '2026-09-17T00:00:00.000Z',
  };
  const repository: Starter198Repository = {
    async list(collection, tenantId, query = {}) {
      let items = (rows.get(collection) ?? []).filter(row => row.tenant_id === tenantId
        && Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const key = query.sort.replace(/^-/, '');
        items = [...items].sort((left, right) => {
          const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
          return descending ? -compared : compared;
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 500;
      return {
        items: structuredClone(items.slice((page - 1) * perPage, page * perPage)),
        totalItems: items.length,
        totalPages: Math.ceil(items.length / perPage),
        page,
        perPage,
      };
    },
    async get(collection, tenantId, id) {
      return structuredClone((rows.get(collection) ?? []).find(row => row.id === id && row.tenant_id === tenantId) ?? null);
    },
    async create(collection, tenantId, data) {
      const collectionRows = rows.get(collection) ?? [];
      if (collection === STARTER_COLLECTIONS.usage && collectionRows.some(row => row.tenant_id === tenantId && (
        row.idempotency_key === data.idempotency_key
        || (row.reservation_id === data.reservation_id && row.event_type === data.event_type)
      ))) throw new Starter198RepositoryError('starter_198_storage_unavailable');
      const row: StarterRecord = { id: `row-${++serial}`, tenant_id: tenantId, ...structuredClone(data) };
      collectionRows.push(row);
      rows.set(collection, collectionRows);
      return structuredClone(row);
    },
    async update(collection, tenantId, id, data) {
      const row = (rows.get(collection) ?? []).find(item => item.id === id && item.tenant_id === tenantId);
      if (!row) throw new Starter198RepositoryError('starter_198_target_not_found');
      Object.assign(row, structuredClone(data));
    },
    async access(tenantId) {
      if (tenantId !== input.tenantId) throw new Starter198RepositoryError('starter_198_not_provisioned');
      return {
        recordId: `access-${tenantId}`,
        tenantId,
        productProfile: 'starter_198',
        profileVersion: 'starter_198.v1',
        entitlementSnapshotId: `ent-${tenantId}`,
        entitlements: STARTER_198_CAPABILITIES.map(capability => ({
          capability,
          enabled: capability !== input.disabledCapability,
        })),
        resourceLimits: limits,
        status: 'active',
        cycleStartedAt: accessWindow.startedAt,
        cycleEndsAt: accessWindow.endsAt,
        updatedAt: '2026-09-10T00:00:00.000Z',
      };
    },
  };
  return { repository, rows, accessWindow };
}

const main = memoryRepository({ tenantId: 'tenant-usage' });
const reserved = await reserveStarterUsage({
  tenantId: 'tenant-usage', runId: 'run-1', taskId: 'task-1', agentRole: 'content',
  capability: 'workflow.standard.run', idempotencyKey: 'reserve-content-1',
  cost: { status: 'known', estimatedCostCny: 2, reservedCostCny: 3 },
  resourceUnits: { contentArtifacts: 1, contentRevisions: 0, inquiryAi: 0 },
  repository: main.repository, now,
});
assert.equal(reserved.created, true);
assert.equal(reserved.executable, true);
assert.equal((main.rows.get(STARTER_COLLECTIONS.usage)?.[0].usage as Record<string, unknown>).output_tokens, null,
  'reservation must not invent token usage');
const replayedReserve = await reserveStarterUsage({
  tenantId: 'tenant-usage', runId: 'run-1', taskId: 'task-1', agentRole: 'content',
  capability: 'workflow.standard.run', idempotencyKey: 'reserve-content-1',
  cost: { status: 'known', estimatedCostCny: 2, reservedCostCny: 3 },
  resourceUnits: { contentArtifacts: 1, contentRevisions: 0, inquiryAi: 0 },
  repository: main.repository, now,
});
assert.equal(replayedReserve.created, false);
assert.equal(main.rows.get(STARTER_COLLECTIONS.usage)?.length, 1);
await assert.rejects(
  () => reserveStarterUsage({
    tenantId: 'tenant-usage', runId: 'run-1', taskId: 'changed-task', agentRole: 'content',
    capability: 'workflow.standard.run', idempotencyKey: 'reserve-content-1',
    cost: { status: 'known', estimatedCostCny: 2, reservedCostCny: 3 }, repository: main.repository, now,
  }),
  (error: unknown) => error instanceof Starter198UsageLedgerError && error.code === 'starter_198_usage_idempotency_conflict',
);

const settled = await settleStarterUsage({
  tenantId: 'tenant-usage', reservationId: reserved.reservationId, idempotencyKey: 'settle-content-1',
  tokens: { status: 'known', inputTokens: 100, outputTokens: 40, cacheTokens: 10 },
  cost: { status: 'known', settledCostCny: 2.5 }, outputCount: 1,
  resourceUnits: { contentArtifacts: 1, contentRevisions: 0, inquiryAi: 0 },
  repository: main.repository, now: new Date('2026-09-12T08:01:00.000Z'),
});
assert.equal(settled.created, true);
assert.equal((await settleStarterUsage({
  tenantId: 'tenant-usage', reservationId: reserved.reservationId, idempotencyKey: 'settle-content-1',
  tokens: { status: 'known', inputTokens: 100, outputTokens: 40, cacheTokens: 10 },
  cost: { status: 'known', settledCostCny: 2.5 }, outputCount: 1,
  resourceUnits: { contentArtifacts: 1, contentRevisions: 0, inquiryAi: 0 },
  repository: main.repository, now: new Date('2026-09-12T08:01:00.000Z'),
})).created, false);
await assert.rejects(
  () => failStarterUsage({
    tenantId: 'tenant-usage', reservationId: reserved.reservationId, idempotencyKey: 'fail-content-1',
    tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
    cost: { status: 'known', settledCostCny: 0 }, outputCount: 0,
    resourceUnits: zeroUnits, repository: main.repository, now,
  }),
  (error: unknown) => error instanceof Starter198UsageLedgerError && error.code === 'starter_198_usage_terminal_conflict',
);
await assert.rejects(
  () => settleStarterUsage({
    tenantId: 'tenant-other', reservationId: reserved.reservationId, idempotencyKey: 'settle-other-1',
    tokens: { status: 'known', inputTokens: 1, outputTokens: 1, cacheTokens: 0 },
    cost: { status: 'known', settledCostCny: 1 }, outputCount: 1,
    repository: main.repository, now,
  }),
  (error: unknown) => error instanceof Starter198UsageLedgerError && error.code === 'starter_198_usage_reservation_not_found',
  'a different tenant cannot settle another tenant reservation',
);

const agent = aggregateStarterAgentUsage({
  tenantId: 'tenant-usage', runStatus: 'running', resourceLimits: STARTER_198_DEFAULT_LIMITS,
  ledgerRecords: main.rows.get(STARTER_COLLECTIONS.usage) ?? [], tasks: [],
}).find(item => item.role === 'content')!;
assert.deepEqual(agent.tokens, { input: 100, output: 40, cache: 10, total: 150 });
assert.deepEqual(agent.costCny, {
  estimated: 2, reserved: 0, settled: 2.5, settlementStatus: 'settled', updatedAt: '2026-09-12T08:01:00.000Z',
});
assert.deepEqual(agent.budgetCny, { total: 25, used: 2.5, reserved: 0, remaining: 22.5, projectedOverrun: false });

const overrunLimits: Starter198ResourceLimits = {
  ...STARTER_198_DEFAULT_LIMITS,
  concurrentRunCount: 2,
  budgetCnyPerCycle: 2,
  agentBudgetCny: { orchestrator: 1, content: 1, traffic: 0, sales: 0 },
};
const overrun = memoryRepository({ tenantId: 'tenant-overrun', limits: overrunLimits });
overrun.rows.set(STARTER_COLLECTIONS.runs, [{
  id: 'run-overrun', tenant_id: 'tenant-overrun', status: 'running',
  started_at: '2026-09-12T08:00:00.000Z',
}]);
const overrunReserve = await reserveStarterUsage({
  tenantId: 'tenant-overrun', runId: 'run-overrun', taskId: 'task-overrun', agentRole: 'content',
  capability: 'workflow.standard.run', idempotencyKey: 'overrun-reserve-1',
  cost: { status: 'known', estimatedCostCny: 0.5, reservedCostCny: 0.5 },
  repository: overrun.repository, now,
});
const overrunTerminal = await settleStarterUsage({
  tenantId: 'tenant-overrun', reservationId: overrunReserve.reservationId,
  idempotencyKey: 'overrun-terminal-1',
  tokens: { status: 'known', inputTokens: 200, outputTokens: 80, cacheTokens: 20 },
  cost: { status: 'known', settledCostCny: 3 }, outputCount: 1,
  repository: overrun.repository, now: new Date('2026-09-12T08:02:00.000Z'),
});
assert.equal(overrunTerminal.created, true, 'actual cost must be recorded even when it exceeds reservation and budget');
const overrunRows = overrun.rows.get(STARTER_COLLECTIONS.usage) ?? [];
assert.equal(overrunRows.length, 2, 'terminal settlement closes the reservation instead of leaving it open');
const overrunUsage = overrunRows.find(row => row.event_type === 'terminal')?.usage as Record<string, unknown>;
assert.equal(overrunUsage.settled_cost_cny, 3);
assert.equal(overrunUsage.reserved_cost_delta_cny, -0.5);
assert.deepEqual(overrunUsage.anomaly_codes, [
  'starter_198_usage_actual_cost_exceeds_reservation',
  'starter_198_budget_exhausted',
]);
const overrunAgent = aggregateStarterAgentUsage({
  tenantId: 'tenant-overrun', runStatus: 'running', resourceLimits: overrunLimits,
  ledgerRecords: overrunRows, tasks: [],
}).find(item => item.role === 'content')!;
assert.equal(overrunAgent.costCny.settled, 3);
assert.equal(overrunAgent.costCny.reserved, 0);
assert.equal(overrunAgent.costCny.settlementStatus, 'settled');
assert.equal(overrunAgent.budgetCny.projectedOverrun, true);
assert.ok(overrunAgent.anomalies.includes('starter_198_usage_actual_cost_exceeds_reservation'));
assert.ok(overrunAgent.anomalies.includes('starter_198_budget_exhausted'));
await assert.rejects(
  () => reserveStarterUsage({
    tenantId: 'tenant-overrun', runId: 'run-overrun', taskId: 'task-after-overrun', agentRole: 'content',
    capability: 'workflow.standard.run', idempotencyKey: 'overrun-reserve-2',
    cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
    repository: overrun.repository, now,
  }),
  (error: unknown) => error instanceof Starter198UsageLedgerError && error.code === 'starter_198_budget_exhausted',
  'new execution remains fail-closed after an actual-cost overrun',
);
await assert.rejects(
  () => assertOrchestratorAdmissionQuota({
    repository: overrun.repository, tenantId: 'tenant-overrun', limits: overrunLimits,
  }),
  (error: unknown) => error instanceof Starter198QuotaError && error.code === 'starter_198_budget_exhausted',
  'admission quota must consume terminal actual cost instead of the released reservation',
);

const crossCycle = memoryRepository({ tenantId: 'tenant-cross-cycle' });
const crossCycleReserve = await reserveStarterUsage({
  tenantId: 'tenant-cross-cycle', runId: 'run-cross-cycle', taskId: 'task-cross-cycle', agentRole: 'content',
  capability: 'workflow.standard.run', idempotencyKey: 'cross-cycle-reserve-1',
  cost: { status: 'known', estimatedCostCny: 0.2, reservedCostCny: 0.3 },
  repository: crossCycle.repository, now,
});
crossCycle.accessWindow.startedAt = '2026-09-17T00:00:00.000Z';
crossCycle.accessWindow.endsAt = '2026-09-24T00:00:00.000Z';
const crossCycleTerminal = await settleStarterUsage({
  tenantId: 'tenant-cross-cycle', reservationId: crossCycleReserve.reservationId,
  idempotencyKey: 'cross-cycle-terminal-1',
  tokens: { status: 'known', inputTokens: 10, outputTokens: 4, cacheTokens: 1 },
  cost: { status: 'known', settledCostCny: 0.2 }, outputCount: 1,
  repository: crossCycle.repository, now: new Date('2026-09-18T08:00:00.000Z'),
});
assert.equal(crossCycleTerminal.created, true, 'cross-cycle terminal completion must never be rejected as stale');
const crossCycleRows = crossCycle.rows.get(STARTER_COLLECTIONS.usage) ?? [];
const crossCycleUsage = crossCycleRows.find(row => row.event_type === 'terminal')?.usage as Record<string, unknown>;
assert.deepEqual(crossCycleUsage.anomaly_codes, ['starter_198_usage_cycle_stale']);
assert.equal((await settleStarterUsage({
  tenantId: 'tenant-cross-cycle', reservationId: crossCycleReserve.reservationId,
  idempotencyKey: 'cross-cycle-terminal-1',
  tokens: { status: 'known', inputTokens: 10, outputTokens: 4, cacheTokens: 1 },
  cost: { status: 'known', settledCostCny: 0.2 }, outputCount: 1,
  repository: crossCycle.repository, now: new Date('2026-09-18T08:00:00.000Z'),
})).created, false, 'cross-cycle settlement replay remains idempotent');
const crossCycleReplay = await reserveStarterUsage({
  tenantId: 'tenant-cross-cycle', runId: 'run-cross-cycle', taskId: 'task-cross-cycle', agentRole: 'content',
  capability: 'workflow.standard.run', idempotencyKey: 'cross-cycle-reserve-1',
  cost: { status: 'known', estimatedCostCny: 0.2, reservedCostCny: 0.3 },
  repository: crossCycle.repository, now: new Date('2026-09-18T08:00:00.000Z'),
});
assert.deepEqual(
  { state: crossCycleReplay.state, executable: crossCycleReplay.executable },
  { state: 'settled', executable: false },
  'reservation replay observes the terminal row and cannot remain open',
);

const unavailableProjection = memoryRepository({ tenantId: 'tenant-projection-unavailable' });
const unavailableProjectionReserve = await reserveStarterUsage({
  tenantId: 'tenant-projection-unavailable', runId: 'run-projection', taskId: 'task-projection',
  agentRole: 'content', capability: 'workflow.standard.run', idempotencyKey: 'projection-reserve-1',
  cost: { status: 'known', estimatedCostCny: 0.1, reservedCostCny: 0.1 },
  repository: unavailableProjection.repository, now,
});
unavailableProjection.repository.access = async () => {
  throw new Starter198RepositoryError('starter_198_not_provisioned');
};
await settleStarterUsage({
  tenantId: 'tenant-projection-unavailable', reservationId: unavailableProjectionReserve.reservationId,
  idempotencyKey: 'projection-terminal-1',
  tokens: { status: 'known', inputTokens: 5, outputTokens: 2, cacheTokens: 0 },
  cost: { status: 'known', settledCostCny: 0.1 }, outputCount: 1,
  repository: unavailableProjection.repository, now,
});
const unavailableProjectionRows = unavailableProjection.rows.get(STARTER_COLLECTIONS.usage) ?? [];
assert.equal(unavailableProjectionRows.length, 2, 'access/projection failure cannot strand an otherwise valid terminal event');
assert.deepEqual(
  (unavailableProjectionRows.find(row => row.event_type === 'terminal')?.usage as Record<string, unknown>).anomaly_codes,
  ['starter_198_usage_terminal_projection_unavailable'],
);

const unknown = memoryRepository({ tenantId: 'tenant-unknown' });
const unknownReserve = await reserveStarterUsage({
  tenantId: 'tenant-unknown', runId: 'run-u', taskId: 'task-u', agentRole: 'orchestrator',
  capability: 'workflow.standard.run', idempotencyKey: 'reserve-unknown-1',
  cost: { status: 'unknown', anomalyCode: 'provider_price_missing' },
  repository: unknown.repository, now,
});
assert.equal(unknownReserve.executable, false);
const unknownUsage = unknown.rows.get(STARTER_COLLECTIONS.usage)?.[0].usage as Record<string, unknown>;
assert.equal(unknownUsage.estimated_cost_cny, null);
assert.equal(unknownUsage.reserved_cost_delta_cny, null);
assert.equal(unknownUsage.settled_cost_cny, null);
await failStarterUsage({
  tenantId: 'tenant-unknown', reservationId: unknownReserve.reservationId, idempotencyKey: 'fail-unknown-1',
  tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
  cost: { status: 'known', settledCostCny: 0 }, outputCount: 0, resourceUnits: zeroUnits,
  waitReason: '价格未知，执行前停止', anomalyCode: 'execution_not_started', repository: unknown.repository, now,
});
const unknownAgent = aggregateStarterAgentUsage({
  tenantId: 'tenant-unknown', runStatus: 'error', resourceLimits: STARTER_198_DEFAULT_LIMITS,
  ledgerRecords: unknown.rows.get(STARTER_COLLECTIONS.usage) ?? [], tasks: [],
}).find(item => item.role === 'orchestrator')!;
assert.equal(unknownAgent.costCny.estimated, null, 'an unknown estimate must never become zero');
assert.equal(unknownAgent.costCny.reserved, 0);
assert.equal(unknownAgent.costCny.settled, 0, 'zero is allowed only after an explicit known-zero terminal assertion');
assert.ok(unknownAgent.anomalies.includes('usage_anomaly_unknown'));
assert.equal(JSON.stringify(unknownAgent).includes('provider_price_missing'), false,
  'provider-specific anomaly details must stay in the internal ledger projection');
unknown.rows.set(STARTER_COLLECTIONS.runs, [{
  id: 'run-u', tenant_id: 'tenant-unknown', status: 'running', started_at: now.toISOString(),
}]);
await assertOrchestratorAdmissionQuota({
  repository: unknown.repository,
  tenantId: 'tenant-unknown',
  limits: { ...STARTER_198_DEFAULT_LIMITS, concurrentRunCount: 2 },
});

const tightLimits: Starter198ResourceLimits = {
  ...STARTER_198_DEFAULT_LIMITS,
  contentArtifactCountPerCycle: 1,
  contentRevisionCountPerCycle: 1,
  inquiryAiCountPerCycle: 1,
  budgetCnyPerCycle: 2,
  agentBudgetCny: { orchestrator: 1, content: 1, traffic: 0, sales: 0 },
};
const tight = memoryRepository({ tenantId: 'tenant-tight', limits: tightLimits });
await reserveStarterUsage({
  tenantId: 'tenant-tight', runId: 'run-t', taskId: 'task-t1', agentRole: 'content',
  capability: 'workflow.standard.run', idempotencyKey: 'tight-reserve-1',
  cost: { status: 'known', estimatedCostCny: 1, reservedCostCny: 1 },
  resourceUnits: { contentArtifacts: 1, contentRevisions: 1, inquiryAi: 0 }, repository: tight.repository, now,
});
for (const [idempotencyKey, units, code] of [
  ['tight-content-2', { contentArtifacts: 1, contentRevisions: 0, inquiryAi: 0 }, 'starter_198_content_artifact_quota_exceeded'],
  ['tight-revision-2', { contentArtifacts: 0, contentRevisions: 1, inquiryAi: 0 }, 'starter_198_content_revision_quota_exceeded'],
] as const) {
  await assert.rejects(
    () => reserveStarterUsage({
      tenantId: 'tenant-tight', runId: 'run-t', taskId: idempotencyKey, agentRole: 'content',
      capability: 'workflow.standard.run', idempotencyKey,
      cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
      resourceUnits: units, repository: tight.repository, now,
    }),
    (error: unknown) => error instanceof Starter198UsageLedgerError && error.code === code,
  );
}
await assert.rejects(
  () => reserveStarterUsage({
    tenantId: 'tenant-tight', runId: 'run-t', taskId: 'task-cost', agentRole: 'content',
    capability: 'workflow.standard.run', idempotencyKey: 'tight-budget-2',
    cost: { status: 'known', estimatedCostCny: 0.01, reservedCostCny: 0.01 }, repository: tight.repository, now,
  }),
  (error: unknown) => error instanceof Starter198UsageLedgerError && error.code === 'starter_198_budget_exhausted',
);
const inquiry = memoryRepository({ tenantId: 'tenant-inquiry', limits: tightLimits });
await reserveStarterUsage({
  tenantId: 'tenant-inquiry', runId: 'run-i', taskId: 'task-i1', agentRole: 'sales',
  capability: 'quotation.calculate', idempotencyKey: 'inquiry-reserve-1',
  cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
  resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 1 }, repository: inquiry.repository, now,
});
await assert.rejects(
  () => reserveStarterUsage({
    tenantId: 'tenant-inquiry', runId: 'run-i', taskId: 'task-i2', agentRole: 'sales',
    capability: 'quotation.calculate', idempotencyKey: 'inquiry-reserve-2',
    cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
    resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 1 }, repository: inquiry.repository, now,
  }),
  (error: unknown) => error instanceof Starter198UsageLedgerError && error.code === 'starter_198_inquiry_ai_quota_exceeded',
);

const disabled = memoryRepository({ tenantId: 'tenant-disabled', disabledCapability: 'quotation.calculate' });
await assert.rejects(
  () => reserveStarterUsage({
    tenantId: 'tenant-disabled', runId: 'run-d', taskId: 'task-d', agentRole: 'sales',
    capability: 'quotation.calculate', idempotencyKey: 'disabled-capability-1',
    cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 }, repository: disabled.repository, now,
  }),
  (error: unknown) => error instanceof Starter198UsageLedgerError && error.code === 'starter_198_usage_capability_forbidden',
);

const migration = fs.readFileSync('pb_migrations/1789344000_create_starter198_foundation.js', 'utf8');
for (const field of ['reservation_id', 'idempotency_key', 'request_hash', 'cycle_id', 'event_type', 'state']) {
  assert.match(migration, new RegExp(`text\\("${field}"`), `usage ledger migration must include ${field}`);
}
assert.match(migration, /UNIQUE INDEX idx_starter_usage_idempotency/);
assert.match(migration, /UNIQUE INDEX idx_starter_usage_lifecycle/);
assert.match(migration, /json\("usage", true\)/, 'terminal anomaly arrays fit the existing versioned JSON payload without a schema migration');

console.log('starter usage ledger passed: tenant scope, idempotency, terminal closure, overrun anomalies, budgets and output quotas');
