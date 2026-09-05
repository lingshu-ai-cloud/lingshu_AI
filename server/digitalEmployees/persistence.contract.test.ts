import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'pb_migrations/1788393600_expand_digital_employee_business_workflows.js';
const migration = fs.readFileSync(migrationPath, 'utf8');
const workerMigration = fs.readFileSync('pb_migrations/1788480000_connect_followup_dispatch_worker.js', 'utf8');
const configMigration = fs.readFileSync('pb_migrations/1788825600_version_digital_employee_configuration.js', 'utf8');
const bootstrap = fs.readFileSync('scripts/setup-pb.ts', 'utf8');

const canonicalCollections = [
  'workflow_corrections',
  'customer_segments',
  'customer_segment_members',
  'followup_batches',
  'followup_batch_items',
] as const;

for (const collection of canonicalCollections) {
  assert.match(migration, new RegExp(`name:\\s*["']${collection}["']`), `${migrationPath} must create ${collection}`);
  assert.match(bootstrap, new RegExp(`name:\\s*['"]${collection}['"]`), `setup-pb must bootstrap ${collection}`);
}

assert.doesNotMatch(migration, /name:\s*["']outreach_(?:batches|recipients)["']/, 'migration must not create legacy outreach aliases');
assert.doesNotMatch(bootstrap, /name:\s*['"]outreach_(?:batches|recipients)['"]/, 'bootstrap must not create legacy outreach aliases');

const taskMetadata = [
  'business_domain', 'capability_key', 'destination', 'destination_view', 'status_source',
  'execution_mode', 'external_effect', 'business_refs', 'task_version', 'correction_version',
];
for (const field of taskMetadata) {
  assert.match(migration, new RegExp(`["']${field}["']`), `workflow_tasks migration must include ${field}`);
  assert.match(bootstrap, new RegExp(`name:\\s*['"]${field}['"]`), `workflow_tasks bootstrap must include ${field}`);
}

assert.match(configMigration, /digital_employee_config_versions/, 'configuration versions need an immutable collection');
assert.match(bootstrap, /name:\s*['"]digital_employee_config_versions['"]/, 'setup-pb must bootstrap immutable configuration versions');
for (const field of ['config_version', 'policy_version', 'facts_version', 'effective_config', 'activated_at']) {
  assert.match(configMigration, new RegExp(`["']${field}["']`), `configuration migration must include ${field}`);
  assert.match(bootstrap, new RegExp(`name:\\s*['"]${field}['"]`), `configuration bootstrap must include ${field}`);
}
for (const field of ['automatic_execution_allowed', 'policy_source']) {
  assert.match(configMigration, new RegExp(`["']${field}["']`), `workflow task policy metadata must include ${field}`);
  assert.match(bootstrap, new RegExp(`name:\\s*['"]${field}['"]`), `workflow task bootstrap must include ${field}`);
}

for (const field of ['instruction', 'scope', 'rerun_downstream', 'before_state', 'after_state', 'affected_task_ids', 'created_by']) {
  assert.match(migration, new RegExp(`["']${field}["']`), `corrections must persist ${field}`);
  assert.match(bootstrap, new RegExp(`name:\\s*['"]${field}['"]`), `bootstrap corrections must persist ${field}`);
}

for (const field of ['criteria_hash', 'member_count', 'excluded_count', 'customer_snapshot', 'inclusion_reasons', 'exclusion_reasons']) {
  assert.match(migration, new RegExp(`["']${field}["']`), `customer segment snapshots must persist ${field}`);
  assert.match(bootstrap, new RegExp(`name:\\s*['"]${field}['"]`), `bootstrap customer segments must persist ${field}`);
}

for (const field of [
  'approved_version', 'content_hash', 'delivery_policy', 'safety_summary', 'outside_24h', 'send_mode',
  'template_status', 'draft_version', 'idempotency_key', 'provider_message_id', 'provider_receipt', 'scheduled_at',
]) {
  assert.match(migration, new RegExp(`["']${field}["']`), `follow-up persistence must include ${field}`);
  assert.match(bootstrap, new RegExp(`name:\\s*['"]${field}['"]`), `bootstrap follow-up persistence must include ${field}`);
}
for (const field of ['template_language', 'template_variables']) {
  assert.match(workerMigration, new RegExp(`["']${field}["']`), `worker migration must include ${field}`);
  assert.match(bootstrap, new RegExp(`name:\\s*['"]${field}['"]`), `bootstrap follow-up persistence must include ${field}`);
}

assert.match(
  migration,
  /CREATE UNIQUE INDEX idx_followup_batch_items_idempotency[\s\S]*?tenant_id, idempotency_key/,
  'send idempotency must be unique within a tenant',
);
assert.match(
  migration,
  /CREATE UNIQUE INDEX idx_workflow_corrections_task_version[\s\S]*?tenant_id, task_id, version/,
  'corrections must be append-only versions per tenant and task',
);
assert.match(bootstrap, /async function ensureIndexes[\s\S]*?method:\s*'PATCH'/, 'bootstrap must add missing safety indexes to existing collections');
assert.match(bootstrap, /await ensureFields\(token, name, fields\)/, 'bootstrap must expand existing collections without recreating them');
assert.match(bootstrap, /await ensureIndexes\(token, name, indexes/, 'bootstrap must reconcile indexes for existing collections');
for (const index of [
  'idx_digital_employee_config_tenant', 'idx_workflow_tasks_run_key', 'idx_run_events_sequence',
  'idx_approval_requests_task', 'idx_weekly_reviews_run',
]) {
  assert.match(bootstrap, new RegExp(index), `bootstrap must preserve the base Digital Employee invariant ${index}`);
}

console.log('digital employee persistence contract tests passed');
