/// <reference path="../pb_data/types.d.ts" />
// Only the server may import independently signed, byte-bound visual findings.
migrate(app => {
  app.save(new Collection({
    name: 'social_product_footage_visual_reviews', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      {name: 'id', type: 'text', system: true, required: true, primaryKey: true,
        autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$'},
      ...['tenant_id', 'material_id', 'product_id', 'content_hash'].map(name =>
        ({name, type: 'text', required: true})),
      {name: 'payload', type: 'json', required: true, maxSize: 1048576},
    ],
    indexes: [
      'CREATE INDEX idx_product_footage_visual_scope ON social_product_footage_visual_reviews (tenant_id,material_id)',
      'CREATE INDEX idx_product_footage_visual_product ON social_product_footage_visual_reviews (tenant_id,product_id)',
    ],
  }));
}, app => {
  app.delete(app.findCollectionByNameOrId('social_product_footage_visual_reviews'));
});
