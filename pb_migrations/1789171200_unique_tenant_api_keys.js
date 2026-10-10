/// <reference path="../pb_data/types.d.ts" />

// Intentionally do not delete or merge duplicates here. If historical data
// violates either invariant, the migration must stop so an operator can audit
// which credentials are still in use before revoking any of them.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("tenant_api_keys");
  collection.addIndex("idx_tenant_api_keys_tenant", true, "tenant_id", "");
  collection.addIndex("idx_tenant_api_keys_key", true, "api_key", "");
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("tenant_api_keys");
  collection.removeIndex("idx_tenant_api_keys_key");
  collection.removeIndex("idx_tenant_api_keys_tenant");
  return app.save(collection);
});
