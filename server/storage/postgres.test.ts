import assert from 'node:assert/strict';
import { POSTGRES_CORE_SCHEMA, PostgresStore, selectedDataBackend, type SqlExecutor } from './postgres.js';

assert.equal(selectedDataBackend({}), 'pocketbase');
assert.equal(selectedDataBackend({ DATA_BACKEND: 'postgres' }), 'postgres');
assert.throws(() => selectedDataBackend({ DATA_BACKEND: 'sqlite' }), /Unsupported DATA_BACKEND/);

const calls: Array<{ text: string; values?: unknown[] }> = [];
const executor: SqlExecutor = {
  async query(text, values) {
    calls.push({ text, values });
    if (/count\(\*\)/.test(text)) return { rows: [{ count: '1' }], rowCount: 1 } as never;
    if (/SELECT data/.test(text)) return { rows: [{ data: { id: 'r1', tenantId: 'tenant-a', status: 'ready' } }], rowCount: 1 } as never;
    return { rows: [], rowCount: 1 } as never;
  },
};

const store = new PostgresStore(executor);
assert.equal(store.supportsAtomicCompareAndSwap(), true);
assert.match(POSTGRES_CORE_SCHEMA, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lingshu_tenant_profile_owner[\s\S]*WHERE collection = 'tenant_profiles'/);
assert.match(POSTGRES_CORE_SCHEMA, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lingshu_digital_employee_config_tenant[\s\S]*WHERE collection = 'digital_employee_configs'/);
assert.match(POSTGRES_CORE_SCHEMA, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lingshu_digital_employee_config_version[\s\S]*WHERE collection = 'digital_employee_config_versions'/);
assert.match(POSTGRES_CORE_SCHEMA, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lingshu_enterprise_onboarding_draft_owner[\s\S]*WHERE collection = 'enterprise_onboarding_drafts'/);
let indexRows: Array<Record<string, unknown>> = [];
const indexStore = new PostgresStore({
  async query(_text, values) {
    assert.equal(values?.[0], 'idx_lingshu_enterprise_onboarding_draft_owner');
    assert.equal(values?.[1], 2);
    return { rows: indexRows, rowCount: indexRows.length } as never;
  },
});
assert.equal(await indexStore.supportsAtomicCompareAndSwapFor('enterprise_onboarding_drafts'), false);
indexRows = [{ valid: true, key1: "data ->> 'tenant_id'::text", key2: "data ->> 'user_id'::text", predicate: "(collection = 'enterprise_onboarding_drafts'::text)" }];
assert.equal(await indexStore.supportsAtomicCompareAndSwapFor('enterprise_onboarding_drafts'), true);
indexRows = [{ ...indexRows[0], predicate: "collection = 'other_collection'" }];
assert.equal(await indexStore.supportsAtomicCompareAndSwapFor('enterprise_onboarding_drafts'), false);
const page = await store.list('workflow_runs', { where: { tenantId: 'tenant-a', status: 'ready' }, sort: '-updated', page: 1, perPage: 20 });
assert.equal(page.totalItems, 1);
assert.deepEqual(page.items[0], { id: 'r1', tenantId: 'tenant-a', status: 'ready' });
assert.match(calls[0].text, /data @>/);
assert.deepEqual(calls[0].values, ['workflow_runs', '{"tenantId":"tenant-a"}', '{"status":"ready"}']);
await assert.rejects(() => store.list('workflow-runs'), /Invalid collection name/);
await store.list('workflow_runs', { sort: 'created_at,id', page: 1, perPage: 20 });
assert.match(calls.at(-1)?.text || '', /created_at ASC, id ASC/);
await assert.rejects(() => store.list('workflow_runs', { sort: 'created_at,invalid-field' }), /Invalid sort field/);

console.log('PostgreSQL datastore contract passed');
