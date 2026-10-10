/// <reference path="../pb_data/types.d.ts" />

migrate((app) => app.save(new Collection({
  name: "assistant_schedule_changes", type: "base", system: false,
  listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  fields: [
    { name: "id", type: "text", system: true, required: true, primaryKey: true,
      autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
    { name: "tenant_id", type: "text", required: true },
    { name: "created_by", type: "text", required: true },
    { name: "idempotency_key", type: "text", required: true },
    { name: "status", type: "text", required: true },
    { name: "platform", type: "text", required: true },
    { name: "source_weekday", type: "number", required: true, onlyInt: true, min: 0, max: 6 },
    { name: "target_weekday", type: "number", required: true, onlyInt: true, min: 0, max: 6 },
    { name: "item_count", type: "number", required: true, onlyInt: true, min: 1, max: 20 },
    { name: "items", type: "json", required: true, maxSize: 131072 },
    { name: "version", type: "text", required: true },
    { name: "confirmation_version", type: "text", required: true },
    { name: "created_at", type: "text", required: true },
    { name: "updated_at", type: "text", required: true },
    { name: "error_code", type: "text" }
  ],
  indexes: [
    "CREATE UNIQUE INDEX idx_assistant_schedule_change_request ON assistant_schedule_changes (tenant_id, idempotency_key)",
    "CREATE INDEX idx_assistant_schedule_change_pending ON assistant_schedule_changes (tenant_id, created_by, status, updated_at)"
  ]
})), (app) => app.delete(app.findCollectionByNameOrId("assistant_schedule_changes")));
