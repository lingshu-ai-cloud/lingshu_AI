import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import { STARTER_198_DEFAULT_LIMITS } from './provisioning.js';
import { createSocialContentTask, startSocialContentTask } from './socialContentTasks.js';
import { parseCreateSocialTask, socialJson, socialObject } from './socialContentValidation.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { parseStoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { admitContentExecutionJob } from '../contentExecution/durableQueue.js';
import { prepareSocialContentProductionBudget } from './socialContentProductionBudgetPreflight.js';
async function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'real-budget-preflight-')), store = new LangGraphTestStore(path.join(root, 'business.json')), repository = createStarter198Repository(store), tenantId = 'budget-tenant', userId = 'owner', now = new Date(); await store.create(STARTER_COLLECTIONS.access, { tenant_id: tenantId, product_profile: 'starter_198', profile_version: 'starter_198.v1', entitlement_snapshot_id: 'test', feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })), resource_limits: STARTER_198_DEFAULT_LIMITS, status: 'active', cycle_started_at: new Date(now.getTime() - 86400000).toISOString(), cycle_ends_at: new Date(now.getTime() + 86400000).toISOString() }); const value = parseCreateSocialTask({ title: 'Budget entry contract', objective: 'Actual production preflight', mode: 'instant', themeId: 'customization_process', productionApproach: 'material_polish', perItemBudgetCny: 10 }); delete value.materialRoutingPolicyVersion; const task = await createSocialContentTask({ repository, tenantId, userId, idempotencyKey: 'create-budget-test', value }); const started = await startSocialContentTask({ repository, tenantId, userId, taskId: task.taskId, expectedVersion: task.version, idempotencyKey: 'start-budget-test', orchestratorQueue: { enqueue: async () => ({ queueItemId: 'queue-test', runId: 'run-test' }) } }); assert.ok(started.runId); const runId = started.runId!; const job = await admitContentExecutionJob({ dataStore: store, tenantId, userId, taskId: task.taskId, runId, taskType: 'social_content_test' }); const row = await requireSocialTask({ repository, tenantId, taskId: task.taskId }); const baseline = parseStoredSocialScriptBaseline(row!.script_baseline)!; assert.ok(baseline); const detail = await readSocialTaskDetail({ repository, tenantId, taskId: task.taskId }); return { root, store, repository, tenantId, taskId: task.taskId, runId, job, baseline, supplyPlan: detail!.assetSupplyPlan!, clean: () => fs.rmSync(root, { recursive: true, force: true }), enable: async () => { const fresh = await requireSocialTask({ repository, tenantId, taskId: task.taskId }); await store.update(STARTER_COLLECTIONS.socialContentTasks, fresh.id, { brief: { ...socialObject(socialJson(fresh!.brief)), materialRoutingPolicyVersion: 'type-aware.v1' } }); } }; }
test('historical admission remains read only and does not suddenly provision a new budget', async () => { const f = await fixture(); try {
    const result = await prepareSocialContentProductionBudget({ ...f, assets: [] });
    assert.equal(result.status, 'legacy');
    assert.equal(fs.existsSync(path.join(f.root, 'task-budget')), false);
}
finally {
    f.clean();
} });
test('normal marked task stops before paid analysis when actual voice or supplier route data is missing', async () => { const f = await fixture(); try {
    await f.enable();
    let quotes = 0;
    await assert.rejects(prepareSocialContentProductionBudget({ ...f, assets: [], ports: { ledgerRoot: path.join(f.root, 'task-budget'), readTariff: async () => { quotes++; return null; } } }), /selected_voice_runtime_route_missing/);
    assert.equal(quotes, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'task-budget')), false);
    const job = await f.store.getById<Record<string, any>>('content_execution_jobs', f.job.id);
    assert.equal(Boolean(job!.checkpoints?.['social.whole_film_budget']), false);
}
finally {
    f.clean();
} });
test('recovery cannot reset costs or freshly quote without original same-job whole film reservation', async () => { const f = await fixture(); try {
    await f.enable();
    let quote = 0;
    await assert.rejects(prepareSocialContentProductionBudget({ ...f, assets: [], recoveryOnly: true, ports: { readTariff: async () => { quote++; return null; }, ledgerRoot: path.join(f.root, 'task-budget') } }), /existing_whole_film_reservation_missing/);
    assert.equal(quote, 0);
}
finally {
    f.clean();
} });
test('superseded task run is rejected before any provider or quote', async () => { const f = await fixture(); try {
    await f.enable();
    await f.store.update(STARTER_COLLECTIONS.socialContentTasks, (await requireSocialTask(f)).id, { run_id: 'different-run' });
    await assert.rejects(prepareSocialContentProductionBudget({ ...f, assets: [] }), /run_superseded/);
}
finally {
    f.clean();
} });
