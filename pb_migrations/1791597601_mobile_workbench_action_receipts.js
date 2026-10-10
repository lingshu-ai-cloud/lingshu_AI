/// <reference path="../pb_data/types.d.ts" />
// Server-owned journal for authenticated mobile actions. A receipt status is not the subject's business status.
migrate((app) => {
  return app.save(new Collection({
    name: 'mobile_workbench_action_receipts', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'id', type: 'text', system: true, primaryKey: true, required: true, min: 24, max: 24, pattern: '^[a-f0-9]{24}$' },
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['approval_decision', 'retry_task', 'starter_command'] },
      { name: 'target_id', type: 'text', required: true, max: 200 },
      { name: 'expected_version', type: 'text', required: true, max: 128 },
      { name: 'idempotency_key', type: 'text', required: true, max: 128 },
      { name: 'request_hash', type: 'text', required: true, min: 64, max: 64, pattern: '^[a-f0-9]{64}$' },
      { name: 'payload', type: 'json', required: true, maxSize: 65536 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['accepted', 'running', 'succeeded', 'failed'] },
      { name: 'accepted_at', type: 'text', required: true },
      { name: 'started_at', type: 'text' },
      { name: 'finished_at', type: 'text' },
      { name: 'result', type: 'json', maxSize: 65536 },
      { name: 'error', type: 'json', maxSize: 8192 },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_mobile_action_idempotency ON mobile_workbench_action_receipts (tenant_id, user_id, idempotency_key)',
      'CREATE INDEX idx_mobile_action_receipt_status ON mobile_workbench_action_receipts (tenant_id, user_id, status, accepted_at)',
    ],
  }));
}, (app) => app.delete(app.findCollectionByNameOrId('mobile_workbench_action_receipts')));
