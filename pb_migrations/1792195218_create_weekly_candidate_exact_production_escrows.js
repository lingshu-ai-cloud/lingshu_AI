/// <reference path="../pb_data/types.d.ts" />
// Immutable package-derived pre-production holds. They are carried into the
// original per-mother content ledger after planning; they are not a new budget.
migrate(app => {
  const collection = new Collection({
    name: 'social_weekly_candidate_exact_production_escrows', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      {name: 'id', type: 'text', system: true, required: true, primaryKey: true,
        autogeneratePattern: '[a-z0-9]{15}', min: 1, max: 64, pattern: '^[A-Za-z0-9_-]+$'},
      ...['tenant_id','program_id','package_id','package_version','job_id','run_id','record_hash']
        .map(name => ({name, type: 'text', required: true})),
      {name: 'payload', type: 'json', required: true, maxSize: 1048576},
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_weekly_exact_production_escrow_scope ON social_weekly_candidate_exact_production_escrows (tenant_id,program_id,package_id,package_version,job_id,run_id)',
    ],
  });
  return app.save(collection);
}, app => app.delete(app.findCollectionByNameOrId('social_weekly_candidate_exact_production_escrows')));
