/// <reference path="../pb_data/types.d.ts" />

migrate(app => app.save(new Collection({
  name: 'social_weekly_delivery_acceptance_receipts', type: 'base', system: false,
  listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  fields: [
    { name: 'id', type: 'text', system: true, required: true, primaryKey: true, autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' },
    ...['receipt_id','tenant_id','program_id','package_id','evidence_hash','record_hash','created_by','created_at','updated_at'].map(name => ({ name, type: 'text', required: true, max: 0 })),
    { name: 'package_version', type: 'number', required: true, min: 1, onlyInt: true },
    { name: 'receipt_version', type: 'number', required: true, min: 1, onlyInt: true },
    { name: 'payload', type: 'json', required: true, maxSize: 1048576 },
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_weekly_delivery_acceptance_scope ON social_weekly_delivery_acceptance_receipts (tenant_id, program_id, package_id, package_version)',
    'CREATE UNIQUE INDEX idx_weekly_delivery_acceptance_receipt ON social_weekly_delivery_acceptance_receipts (tenant_id, receipt_id)',
  ],
})), app => app.delete(app.findCollectionByNameOrId('social_weekly_delivery_acceptance_receipts')));
