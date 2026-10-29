import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { readLegacyWeeklyPackages } from './legacyWeeklyContext.js';
import { legacyWeeklyPlanHash } from './legacyWeeklyContentActions.js';
test('weekly context queries the persisted workflow run timestamp and propagates storage failure', async () => {
  const failure = new Error('PocketBase unavailable');
  const store = { async list(collection: string, query: any) {
    assert.equal(collection, 'workflow_runs');
    assert.deepEqual(query, { where: { tenant_id: 'tenant' }, sort: '-started_at', perPage: 500 });
    throw failure;
  } } as unknown as DataStore;
  await assert.rejects(readLegacyWeeklyPackages(store, 'tenant'), error => error === failure);
});
test('visible weekly context uses real goal, plan, run and immutable plan hash, not a parallel package', async () => {
  const body = { businessPackage: { revision: 2 } };
  const tables: Record<string, Record_[]> = {
    workflow_runs: [{ id: 'run', tenant_id: 'tenant', plan_id: 'plan', goal_id: 'goal', status: 'waiting_external' }],
    weekly_plans: [{ id: 'plan', tenant_id: 'tenant', goal_id: 'goal', status: 'approved', plan: body }],
    weekly_goals: [{ id: 'goal', tenant_id: 'tenant', title: '本周真实计划', metric: 'approved_content_packages', content_platforms: ['youtube'] }],
  };
  const store = { async list(collection: string, query: any) { const items = (tables[collection] || []).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value)); return { items, totalItems: items.length }; }, async getById(collection: string, id: string) { return tables[collection]?.find(row => row.id === id) || null; } } as unknown as DataStore;
  const [item] = await readLegacyWeeklyPackages(store, 'tenant');
  assert.equal(item.model, 'legacy'); assert.equal(item.goalId, 'goal'); assert.equal(item.packageId, 'plan'); assert.equal(item.runId, 'run'); assert.equal(item.packageVersion, 2);
  assert.equal(item.expectedPlanHash, legacyWeeklyPlanHash(body)); assert.deepEqual(item.platforms, ['youtube']);
  assert.deepEqual(await readLegacyWeeklyPackages(store, 'foreign'), []);
  tables.weekly_goals![0]!.metric = 'approved_social_content_artifacts'; tables.weekly_goals![0]!.scope = { socialTaskId: 'canonical-content' };
  assert.deepEqual(await readLegacyWeeklyPackages(store, 'tenant'), []);
});
