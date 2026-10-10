/// <reference path="../pb_data/types.d.ts" />
// Development schema only; no production migration is run by this change.
migrate(app => {
  const common = [
    { name: 'id', type: 'text', system: true, required: true, primaryKey: true, autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' },
    { name: 'tenant_id', type: 'text', required: true },
    { name: 'program_id', type: 'text', required: true },
    { name: 'package_id', type: 'text', required: true },
    { name: 'package_version', type: 'number', required: true, onlyInt: true, min: 1 },
    { name: 'task_id', type: 'text', required: true },
    { name: 'account_id', type: 'text', required: false },
    { name: 'status', type: 'text', required: true },
    { name: 'payload', type: 'json', required: true, maxSize: 1048576 },
    { name: 'record_hash', type: 'text', required: true }
  ];
  app.save(new Collection({ name: 'social_weekly_preproduction_jobs', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [...common, { name: 'kind', type: 'text', required: true }, { name: 'input_hash', type: 'text', required: true }, { name: 'original_run_key', type: 'text', required: false }],
    indexes: ['CREATE UNIQUE INDEX idx_weekly_preproduction_intent ON social_weekly_preproduction_jobs (tenant_id,task_id,kind,input_hash)'] }));
  app.save(new Collection({ name: 'weekly_metric_collection_jobs', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: common, indexes: ['CREATE UNIQUE INDEX idx_weekly_metric_collection_task ON weekly_metric_collection_jobs (tenant_id,program_id,package_id,package_version,task_id)'] }));
  app.save(new Collection({ name: 'social_weekly_template_extractions', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [...common, { name: 'input_hash', type: 'text', required: true }, { name: 'code', type: 'text', required: true }],
    indexes: ['CREATE UNIQUE INDEX idx_weekly_template_extraction_assessment ON social_weekly_template_extractions (tenant_id,task_id,input_hash,status,code)'] }));
}, app => {
  for (const name of ['social_weekly_template_extractions', 'weekly_metric_collection_jobs', 'social_weekly_preproduction_jobs']) app.delete(app.findCollectionByNameOrId(name));
});
