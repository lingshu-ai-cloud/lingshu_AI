import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import {
  commitWeeklyGoalFactRebuildReplacement,
  hasWeeklyGoalFactRebuildMarker,
  hasWeeklyGoalFactRebuildPlanFence,
  weeklyGoalFactRebuildRecordId,
  weeklyGoalFactRebuildSourcePlanDigest,
  weeklyGoalFactRebuildSnapshotMatches,
  weeklyGoalSourcePlanDigest,
  WeeklyGoalFactRebuildCommitError,
  type WeeklyGoalFactRebuildReplacement,
} from './goalFactRebuild.js';

assert.notEqual(
  weeklyGoalFactRebuildRecordId('goal', 'tenant-1', 'source-goal', 3, 'facts-v2', 7, 'policy-v7'),
  weeklyGoalFactRebuildRecordId('goal', 'tenant-1', 'source-goal', 3, 'facts-v2', 8, 'policy-v7'),
  'a new configuration version must use a different deterministic target',
);
assert.notEqual(
  weeklyGoalFactRebuildRecordId('plan', 'tenant-1', 'source-goal', 3, 'facts-v2', 7, 'policy-v7'),
  weeklyGoalFactRebuildRecordId('plan', 'tenant-1', 'source-goal', 3, 'facts-v2', 7, 'policy-v8'),
  'a new policy version must use a different deterministic target',
);
assert.notEqual(
  weeklyGoalFactRebuildRecordId('goal', 'tenant-1', 'source-goal', 3, 'facts-v2', 7, 'policy-v7', 'a'.repeat(64)),
  weeklyGoalFactRebuildRecordId('goal', 'tenant-1', 'source-goal', 3, 'facts-v2', 7, 'policy-v7', 'b'.repeat(64)),
  'a changed source plan must use a different deterministic target',
);

type Row = Record_ & Record<string, unknown>;

const sourcePlanRecord = {
  id: 'source-plan',
  tenant_id: 'tenant-1',
  goal_id: 'source-goal',
  status: 'draft',
  plan: { configVersion: 6, policyVersion: 'policy-v6', knowledgeBinding: { factsVersion: 'facts-v1' }, businessPackage: { revision: 2 } },
};
const sourcePlanDigest = weeklyGoalSourcePlanDigest(sourcePlanRecord);

function memoryStore(seed: Record<string, Row[]>): DataStore & {
  rows: Map<string, Row[]>;
  writes: Array<{ kind: string; collection: string; id: string }>;
} {
  const rows = new Map(Object.entries(seed).map(([collection, items]) => [collection, structuredClone(items)]));
  const writes: Array<{ kind: string; collection: string; id: string }> = [];
  const matches = (row: Row, query?: ListQuery) => Object.entries(query?.where || {}).every(([key, value]) => row[key] === value);
  return {
    rows,
    writes,
    async getById<T = Record_>(collection: string, id: string) {
      return (rows.get(collection) || []).find(row => row.id === id) as T | undefined || null;
    },
    async create<T = Record_>(collection: string, data: Record<string, unknown>) {
      const id = String(data.id || `created-${(rows.get(collection) || []).length + 1}`);
      const row = { ...structuredClone(data), id } as Row;
      rows.set(collection, [...(rows.get(collection) || []), row]);
      writes.push({ kind: 'create', collection, id });
      return row as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const row = (rows.get(collection) || []).find(item => item.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data));
      writes.push({ kind: 'update', collection, id });
      return true;
    },
    async compareAndSwap(collection: string, id: string, expected: Record<string, unknown>, data: Record<string, unknown>) {
      const row = (rows.get(collection) || []).find(item => item.id === id);
      if (!row || Object.entries(expected).some(([key, value]) => !isDeepStrictEqual(row[key], value))) return false;
      Object.assign(row, structuredClone(data));
      writes.push({ kind: 'compareAndSwap', collection, id });
      return true;
    },
    async delete(collection: string, id: string) {
      const current = rows.get(collection) || [];
      const next = current.filter(row => row.id !== id);
      rows.set(collection, next);
      if (next.length === current.length) return false;
      writes.push({ kind: 'delete', collection, id });
      return true;
    },
    async list<T = Record_>(collection: string, query?: ListQuery) {
      const items = (rows.get(collection) || []).filter(row => matches(row, query)) as T[];
      return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query?.perPage || 20 };
    },
  };
}

const replacement: WeeklyGoalFactRebuildReplacement = {
  sourceGoalId: 'source-goal',
  sourceGoalVersion: 3,
  sourcePlanId: 'source-plan',
  sourcePlanDigest,
  fromFactsVersion: 'facts-v1',
  toFactsVersion: 'facts-v2',
  configVersion: 7,
  policyVersion: 'policy-v7',
  requestId: 'rebuild-request-001',
  rebuiltBy: 'user-1',
  rebuiltAt: '2026-10-11T08:00:00.000Z',
  targetGoalId: 'target-goal',
  targetPlanId: 'target-plan',
};

function seededStore(includeTargetPlan = true) {
  return memoryStore({
    weekly_goals: [
      { id: 'source-goal', tenant_id: 'tenant-1', status: 'draft', version: 3, scope: { description: '原目标' } },
      { id: 'target-goal', tenant_id: 'tenant-1', status: 'draft', version: 1, scope: { description: '新目标', factRebuild: replacement } },
    ],
    weekly_plans: [
      sourcePlanRecord,
      ...(includeTargetPlan ? [
        { id: 'target-plan', tenant_id: 'tenant-1', goal_id: 'target-goal', status: 'draft', plan: { configVersion: 7, policyVersion: 'policy-v7', knowledgeBinding: { factsVersion: 'facts-v2' }, factRebuild: replacement } },
      ] : []),
    ],
    workflow_runs: [],
  });
}

const store = seededStore();
const input = {
  dataStore: store,
  tenantId: 'tenant-1',
  sourceGoalId: 'source-goal',
  sourceGoalVersion: 3,
  sourceDescription: '原目标',
  replacement,
};
assert.equal(await commitWeeklyGoalFactRebuildReplacement(input), 'committed');
const source = await store.getById<Row>('weekly_goals', 'source-goal');
assert.equal(source?.status, 'cancelled');
assert.deepEqual((source?.scope as Record<string, unknown>).factRebuildReplacement, replacement);
assert.deepEqual(store.writes, [
  { kind: 'compareAndSwap', collection: 'weekly_plans', id: 'source-plan' },
  { kind: 'compareAndSwap', collection: 'weekly_goals', id: 'source-goal' },
  { kind: 'compareAndSwap', collection: 'weekly_plans', id: 'source-plan' },
]);
assert.equal((await store.getById<Row>('weekly_plans', 'source-plan'))?.status, 'superseded');
assert.equal(hasWeeklyGoalFactRebuildPlanFence((await store.getById<Row>('weekly_plans', 'source-plan'))?.plan), true);
assert.equal((store.rows.get('workflow_runs') || []).length, 0, 'committing a replacement must never start a workflow run');

const target = await store.getById<Row>('weekly_goals', 'target-goal');
const targetPlan = await store.getById<Row>('weekly_plans', 'target-plan');
target!.status = 'active';
targetPlan!.status = 'approved';
store.rows.set('workflow_runs', [{ id: 'target-run', tenant_id: 'tenant-1', goal_id: 'target-goal' }]);
assert.equal(await commitWeeklyGoalFactRebuildReplacement(input), 'replayed');
assert.equal(store.writes.length, 3, 'an idempotent replay must not write again');
assert.equal((store.rows.get('workflow_runs') || []).length, 1, 'an idempotent replay must preserve the existing target run without creating another');

const incomplete = seededStore(false);
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: incomplete }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_fact_rebuild_replacement_incomplete',
);
assert.equal((await incomplete.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'an incomplete replacement must leave the source draft untouched');
assert.equal(incomplete.writes.length, 0);

const alreadyStarted = seededStore();
(await alreadyStarted.getById<Row>('weekly_goals', 'target-goal'))!.status = 'active';
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: alreadyStarted }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_fact_rebuild_target_not_pristine',
);
assert.equal((await alreadyStarted.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'an already-started replacement must not cancel the source draft');

const targetHasRun = seededStore();
targetHasRun.rows.set('workflow_runs', [{ id: 'unexpected-target-run', tenant_id: 'tenant-1', goal_id: 'target-goal' }]);
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: targetHasRun }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_fact_rebuild_target_not_pristine',
);
assert.equal((await targetHasRun.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'a replacement with a run must not cancel the source draft');

const editedTarget = seededStore();
(await editedTarget.getById<Row>('weekly_goals', 'target-goal'))!.version = 2;
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: editedTarget }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_fact_rebuild_target_not_pristine',
);
assert.equal((await editedTarget.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'an edited replacement goal must not cancel the source draft');

const staleConfiguration = seededStore();
((await staleConfiguration.getById<Row>('weekly_plans', 'target-plan'))!.plan as Record<string, unknown>).configVersion = 6;
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: staleConfiguration }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_fact_rebuild_replacement_incomplete',
);
assert.equal((await staleConfiguration.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'a replacement built with stale configuration must not cancel the source draft');

const otherTenantTarget = seededStore();
(await otherTenantTarget.getById<Row>('weekly_goals', 'target-goal'))!.tenant_id = 'tenant-2';
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: otherTenantTarget }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_fact_rebuild_replacement_incomplete',
);
assert.equal((await otherTenantTarget.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'a replacement from another tenant must not cancel the source draft');

const changedSourcePlan = seededStore();
(((await changedSourcePlan.getById<Row>('weekly_plans', 'source-plan'))!.plan as Record<string, unknown>).businessPackage as Record<string, unknown>).revision = 3;
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: changedSourcePlan }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_source_plan_changed',
);
assert.equal((await changedSourcePlan.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'a concurrently edited source plan must not be cancelled');

const failedCas = seededStore();
const failedCasPort = failedCas.compareAndSwap!.bind(failedCas);
failedCas.compareAndSwap = async (collection, id, expected, data) => collection === 'weekly_goals'
  ? false
  : failedCasPort(collection, id, expected, data);
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: failedCas }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_changed',
);
assert.equal((await failedCas.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'a failed atomic commit must leave the source draft untouched');
assert.equal(hasWeeklyGoalFactRebuildPlanFence((await failedCas.getById<Row>('weekly_plans', 'source-plan'))?.plan), false, 'a failed goal CAS must release its exact source-plan fence');

const fenceWins = seededStore();
const fenceWinsCas = fenceWins.compareAndSwap!.bind(fenceWins);
let latePackageSaveWon = true;
fenceWins.compareAndSwap = async (collection, id, expected, data) => {
  const won = await fenceWinsCas(collection, id, expected, data);
  if (won && collection === 'weekly_plans' && id === 'source-plan' && hasWeeklyGoalFactRebuildPlanFence(data.plan)) {
    latePackageSaveWon = await fenceWinsCas('weekly_plans', 'source-plan', {
      tenant_id: 'tenant-1', goal_id: 'source-goal', status: 'draft', plan: sourcePlanRecord.plan,
    }, { plan: { ...sourcePlanRecord.plan, businessPackage: { revision: 99 } } });
  }
  return won;
};
assert.equal(await commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: fenceWins }), 'committed');
assert.equal(latePackageSaveWon, false, 'a package save that observed the unfenced plan must lose after the rebuild fence wins');

const saveWins = seededStore();
((await saveWins.getById<Row>('weekly_plans', 'source-plan'))!.plan as Record<string, unknown>).businessPackage = { revision: 3 };
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: saveWins }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'goal_source_plan_changed',
  'a package save that wins before the fence must abort the rebuild',
);
assert.equal((await saveWins.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft');

const crashRetry = seededStore();
const crashPlan = await crashRetry.getById<Row>('weekly_plans', 'source-plan');
crashPlan!.plan = { ...(crashPlan!.plan as Record<string, unknown>), factRebuildFence: replacement };
assert.equal(weeklyGoalFactRebuildSourcePlanDigest(crashPlan as typeof sourcePlanRecord), sourcePlanDigest, 'the server-owned fence must not change the recovery token digest');
assert.equal(await commitWeeklyGoalFactRebuildReplacement({ ...input, dataStore: crashRetry }), 'committed', 'a retry must finish the same durable fence after an interrupted commit');

const changedFactsAfterFence = seededStore();
await assert.rejects(
  commitWeeklyGoalFactRebuildReplacement({
    ...input,
    dataStore: changedFactsAfterFence,
    validateAfterSourcePlanFence: async () => {
      throw new WeeklyGoalFactRebuildCommitError('enterprise_facts_changed', 'facts changed after source plan fence');
    },
  }),
  (error: unknown) => error instanceof WeeklyGoalFactRebuildCommitError && error.code === 'enterprise_facts_changed',
);
assert.equal((await changedFactsAfterFence.getById<Row>('weekly_goals', 'source-goal'))?.status, 'draft', 'a final facts change must leave the source goal draft');
assert.equal(hasWeeklyGoalFactRebuildPlanFence((await changedFactsAfterFence.getById<Row>('weekly_plans', 'source-plan'))?.plan), false, 'a final facts change must release the exact source-plan fence');

assert.equal(hasWeeklyGoalFactRebuildMarker({ factRebuild: { broken: true } }), true, 'a malformed target marker must still isolate the target');
assert.equal(hasWeeklyGoalFactRebuildMarker({}), false);

assert.equal(weeklyGoalFactRebuildSnapshotMatches({ factsVersion: 'facts-v2', configVersion: 7, policyVersion: 'policy-v7' }, replacement), true);
assert.equal(weeklyGoalFactRebuildSnapshotMatches({ factsVersion: 'facts-v3', configVersion: 7, policyVersion: 'policy-v7' }, replacement), false, 'the final fence must reject a changed facts snapshot');
assert.equal(weeklyGoalFactRebuildSnapshotMatches({ factsVersion: 'facts-v2', configVersion: 8, policyVersion: 'policy-v7' }, replacement), false, 'the final fence must reject a changed config version');
assert.equal(weeklyGoalFactRebuildSnapshotMatches({ factsVersion: 'facts-v2', configVersion: 7, policyVersion: 'policy-v8' }, replacement), false, 'the final fence must reject a changed policy version');

console.log('latest enterprise facts goal rebuild persistence tests passed');
