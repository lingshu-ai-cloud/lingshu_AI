/// <reference path="../pb_data/types.d.ts" />

// A database-level idempotency boundary for every real platform-ad action.
// The task lease prevents normal overlap; this unique key remains authoritative
// if a worker loses its lease between preflight and receipt persistence.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("platform_ad_executions");
  const index = "CREATE UNIQUE INDEX idx_platform_ad_execution_request ON platform_ad_executions (tenant_id, taskId, requestId) WHERE requestId != ''";
  collection.indexes = [
    ...collection.indexes.filter(existing => !existing.includes("idx_platform_ad_execution_request")),
    index,
  ];
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("platform_ad_executions");
  collection.indexes = collection.indexes.filter(index => !index.includes("idx_platform_ad_execution_request"));
  return app.save(collection);
});
