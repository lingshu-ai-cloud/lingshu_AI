/// <reference path="../pb_data/types.d.ts" />
// Immutable, server-only independent human review of an exact same-run mapping.
migrate(app => {
  app.save(new Collection({
    name: 'social_apify_run_kv_mapping_receipts', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      {name: 'id', type: 'text', system: true, required: true, primaryKey: true,
        autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$'},
      ...['tenant_id', 'package_id', 'job_id', 'content_hash'].map(name =>
        ({name, type: 'text', required: true})),
      {name: 'payload', type: 'json', required: true, maxSize: 1048576},
    ],
    indexes: [
      'CREATE INDEX idx_apify_run_kv_mapping_scope ON social_apify_run_kv_mapping_receipts (tenant_id,package_id,job_id)',
    ],
  }));
}, app => {
  app.delete(app.findCollectionByNameOrId('social_apify_run_kv_mapping_receipts'));
});
