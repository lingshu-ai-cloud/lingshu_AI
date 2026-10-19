/// <reference path="../pb_data/types.d.ts" />
// Independent, immutable full-cost evidence. This collection never grants a paid permit.
migrate(app => {
  app.save(new Collection({
    name: 'social_weekly_account_collection_cost_ceilings', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      {name: 'id', type: 'text', system: true, required: true, primaryKey: true,
        autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$'},
      ...['tenant_id', 'authorization_id', 'job_id', 'record_hash'].map(name =>
        ({name, type: 'text', required: true})),
      {name: 'payload', type: 'json', required: true, maxSize: 1048576},
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_weekly_account_cost_ceiling_job ON social_weekly_account_collection_cost_ceilings (tenant_id,authorization_id,job_id)',
    ],
  }));
}, app => {
  app.delete(app.findCollectionByNameOrId('social_weekly_account_collection_cost_ceilings'));
});
