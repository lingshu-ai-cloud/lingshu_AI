/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    name: "social_metric_snapshots",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true },
      { name: "platform", type: "select", required: true, maxSelect: 1, values: ["facebook", "instagram", "tiktok", "youtube"] },
      { name: "account_id", type: "text", required: true },
      { name: "content_id", type: "text", required: false },
      { name: "snapshot_date", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "captured_at", type: "date", required: true },
      { name: "value_kind", type: "select", required: true, maxSelect: 1, values: ["cumulative", "daily"] },
      { name: "metrics", type: "json", required: true, maxSize: 65536 },
      { name: "raw_metrics", type: "json", required: false, maxSize: 262144 }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_metrics_entity_day ON social_metric_snapshots (tenant_id, platform, account_id, content_id, snapshot_date)",
      "CREATE INDEX idx_social_metrics_tenant_time ON social_metric_snapshots (tenant_id, captured_at)"
    ]
  });
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("social_metric_snapshots");
  return app.delete(collection);
});
