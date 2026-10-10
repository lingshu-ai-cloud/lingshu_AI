import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';

const tenant = 'operating-conflicts-isolated';
const current = { id: 'current', tenant_id: tenant, title: 'Current weekly plan', status: 'draft', starts_at: '2026-09-27', ends_at: '2026-10-03', metric: 'approved_content_packages', scope: {} };
const bridge = { ...current, id: 'bridge', title: 'Independent video', status: 'active', metric: 'approved_social_content_artifacts', scope: { socialTaskId: 'social-task' } };
const bridgeRun = { id: 'bridge-run', tenant_id: tenant, goal_id: bridge.id, status: 'waiting_external', product_profile: 'starter_social_content' };
const rows = new Map<string, any[]>([
  ['weekly_goals', [current, bridge]], ['workflow_runs', [bridgeRun]],
]);
const original = { ...store };
const originalFetch = globalThis.fetch;
let hideBridgeFromList = false;
let brokenGoalPage: 'empty' | 'duplicate' | 'changed_total' | null = null;
const conflictPages: Array<{ collection: string; page: number }> = [];
let mutationCalls = 0;
let networkCalls = 0;
const forbidMutation = async () => { mutationCalls++; throw new Error('isolated conflict check must not modify business records'); };
Object.assign(store, {
  async getById(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(row => row.id === id) || null); },
  async list(collection: string, query: any = {}) {
    let items = (rows.get(collection) || []).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value))
      .filter(row => !(hideBridgeFromList && collection === 'weekly_goals' && row.id === bridge.id));
    if (query.sort) {
      const field = query.sort.replace(/^-/, '');
      const direction = query.sort.startsWith('-') ? -1 : 1;
      items = [...items].sort((left, right) => String(left[field] || '').localeCompare(String(right[field] || '')) * direction);
    }
    const page = query.page || 1;
    const perPage = query.perPage || 500;
    if (query.sort === 'id' && perPage === 500) {
      assert.equal(query.where?.tenant_id, tenant, 'every conflict page must remain tenant-scoped');
      conflictPages.push({ collection, page });
    }
    let selected = items.slice((page - 1) * perPage, page * perPage);
    let totalItems = items.length;
    if (collection === 'weekly_goals' && page === 2 && brokenGoalPage) {
      if (brokenGoalPage === 'empty') selected = [];
      if (brokenGoalPage === 'duplicate') selected = items.slice(0, perPage);
      if (brokenGoalPage === 'changed_total') totalItems++;
    }
    return { items: structuredClone(selected), page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) };
  },
  create: forbidMutation, update: forbidMutation, delete: forbidMutation, compareAndSwap: forbidMutation,
} satisfies DataStore);
globalThis.fetch = async () => { networkCalls++; throw new Error('isolated conflict check forbids network requests'); };

try {
  const { approveGoalForReview } = await import('../routes/digitalEmployees.js');
  const before = structuredClone([...rows]);
  const bridgeActivation = await approveGoalForReview(tenant, 'actor', bridge.id, 0, []);
  assert.equal(bridgeActivation.status, 409);
  assert.deepEqual(bridgeActivation.body, {
    error: 'operating_goal_required', message: '该任务属于独立视频制作，请在对应内容任务中继续操作。',
  }, 'a bridge goal must be rejected before its existing video run can be reported as a weekly-plan activation');
  for (const hidden of [false, true]) {
    hideBridgeFromList = hidden;
    const result = await approveGoalForReview(tenant, 'actor', current.id, 0, []);
    assert.equal(result.status, 409);
    assert.equal((result.body as Record<string, unknown>).error, 'onboarding_required', 'bridge records must pass conflict detection and reach the next required validation');
  }
  assert.deepEqual([...rows], before, 'reading independent video bridge records must preserve them');

  const operating = { ...current, id: 'operating', title: 'Another weekly plan', status: 'paused' };
  const activeRun = { ...bridgeRun, id: 'operating-run', goal_id: operating.id, status: 'paused', product_profile: 'digital_employee' };
  rows.get('weekly_goals')!.push(operating);
  rows.get('workflow_runs')!.push(activeRun);
  const conflict = await approveGoalForReview(tenant, 'actor', current.id, 0, []);
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body, {
    error: 'active_goal_exists',
    message: '当前租户已有活跃周目标，请先完成、暂停后取消，或明确结束现有运行。',
    activeGoalId: operating.id, activeRunId: activeRun.id, activeGoalTitle: operating.title,
    activeGoalStatus: 'paused', activeRunStatus: 'paused', activeStartsAt: operating.starts_at, activeEndsAt: operating.ends_at,
  });

  rows.set('weekly_goals', [current, bridge, { ...operating, tenant_id: 'another-tenant' }]);
  const unknown = await approveGoalForReview(tenant, 'actor', current.id, 0, []);
  assert.equal((unknown.body as Record<string, unknown>).error, 'active_goal_exists', 'a run whose goal cannot be resolved inside the tenant must remain a conflict');
  assert.equal((unknown.body as Record<string, unknown>).activeGoalTitle, '', 'foreign tenant details must not leak through goal hydration');

  // Newer independent-video records must not hide older real operating goals or
  // live runs, even when either collection spans more than two 500-row pages.
  hideBridgeFromList = false;
  const manyBridges = Array.from({ length: 1001 }, (_, index) => ({
    ...bridge, id: `bridge-${String(index).padStart(4, '0')}`, scope: { socialTaskId: `social-${index}` },
  }));
  const manyBridgeRuns = manyBridges.map(item => ({ ...bridgeRun, id: `${item.id}-run`, goal_id: item.id }));
  rows.set('weekly_goals', [current, ...manyBridges]);
  rows.set('workflow_runs', manyBridgeRuns);
  const largeBridgeSnapshot = structuredClone([...rows]);
  conflictPages.length = 0;
  const onlyBridges = await approveGoalForReview(tenant, 'actor', current.id, 0, []);
  assert.equal((onlyBridges.body as Record<string, unknown>).error, 'onboarding_required', 'all pages of confirmed bridges still reach the required onboarding validation');
  for (const collection of ['weekly_goals', 'workflow_runs']) {
    assert.deepEqual(conflictPages.filter(item => item.collection === collection).map(item => item.page), [1, 2, 3]);
  }
  assert.deepEqual([...rows], largeBridgeSnapshot, 'scanning every bridge page must not mutate independent content records');

  const oldOperating = { ...operating, id: 'z-old-operating', status: 'paused' };
  rows.get('weekly_goals')!.push(oldOperating);
  const oldGoalConflict = await approveGoalForReview(tenant, 'actor', current.id, 0, []);
  assert.equal((oldGoalConflict.body as Record<string, unknown>).error, 'active_goal_exists');
  assert.equal((oldGoalConflict.body as Record<string, unknown>).activeGoalId, oldOperating.id, 'an operating goal beyond page 1 must block even without a run');
  assert.equal((oldGoalConflict.body as Record<string, unknown>).activeRunId, '');

  // Draft status intentionally cannot trigger the active/paused-goal fallback:
  // only reading the third page of runs can discover this actual live run.
  oldOperating.status = 'draft';
  const oldRun = { ...activeRun, id: 'z-old-run', goal_id: oldOperating.id, status: 'waiting_external' };
  rows.get('workflow_runs')!.push(oldRun);
  const oldRunConflict = await approveGoalForReview(tenant, 'actor', current.id, 0, []);
  assert.equal((oldRunConflict.body as Record<string, unknown>).error, 'active_goal_exists');
  assert.equal((oldRunConflict.body as Record<string, unknown>).activeGoalId, oldOperating.id);
  assert.equal((oldRunConflict.body as Record<string, unknown>).activeRunId, oldRun.id, 'a live operating run beyond page 1 must not be omitted');

  for (const broken of ['empty', 'duplicate', 'changed_total'] as const) {
    brokenGoalPage = broken;
    await assert.rejects(approveGoalForReview(tenant, 'actor', current.id, 0, []), /周目标互斥检查/, 'an incomplete or changing conflict scan must fail closed');
  }
  brokenGoalPage = null;
  assert.equal(mutationCalls, 0);
  assert.equal(networkCalls, 0);
  console.log('Operating-goal approval conflict checks passed (isolated store; no mutations or network)');
} finally {
  Object.assign(store, original);
  globalThis.fetch = originalFetch;
}
