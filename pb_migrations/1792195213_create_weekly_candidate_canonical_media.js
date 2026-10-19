/// <reference path="../pb_data/types.d.ts" />
// Immutable same-run canonical video claim, verified GET return, and CAS result.
migrate(app => {
  for (const name of [
    'social_weekly_candidate_canonical_media_operations',
    'social_weekly_candidate_canonical_media_read_receipts',
    'social_weekly_candidate_canonical_media_receipts',
  ]) {
    app.save(new Collection({
      name, type: 'base', system: false,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        {name: 'id', type: 'text', system: true, required: true, primaryKey: true,
          autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$'},
        {name: 'tenant_id', type: 'text', required: true},
        {name: 'record_hash', type: 'text', required: true},
        {name: 'payload', type: 'json', required: true, maxSize: 1048576},
      ],
      indexes: [`CREATE INDEX idx_${name}_tenant ON ${name} (tenant_id)`],
    }));
  }
}, app => {
  for (const name of [
    'social_weekly_candidate_canonical_media_receipts',
    'social_weekly_candidate_canonical_media_read_receipts',
    'social_weekly_candidate_canonical_media_operations',
  ]) app.delete(app.findCollectionByNameOrId(name));
});
