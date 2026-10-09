/// <reference path="../pb_data/types.d.ts" />
// Human material requests retain one identity across consumers and weeks.
// Uploaded bytes remain in the canonical materials library, never this ledger.
migrate((app) => app.save(new Collection({
  name: "social_weekly_material_requests", type: "base", system: false,
  listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  fields: [
    { name: "id", type: "text", system: true, required: true, primaryKey: true,
      autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
    { name: "tenant_id", type: "text", required: true },
    { name: "program_id", type: "text", required: true },
    { name: "requirement_key", type: "text", required: true },
    { name: "status", type: "select", required: true, maxSelect: 1,
      values: ["missing", "pending_verification", "accepted", "rejected", "cancelled"] },
    { name: "payload", type: "json", required: true, maxSize: 8388608 },
    { name: "created_at", type: "text", required: true },
    { name: "updated_at", type: "text", required: true }
  ],
  indexes: [
    "CREATE UNIQUE INDEX idx_weekly_material_requirement ON social_weekly_material_requests (tenant_id, program_id, requirement_key)",
    "CREATE INDEX idx_weekly_material_pending ON social_weekly_material_requests (tenant_id, program_id, status, updated_at)"
  ]
})), (app) => app.delete(app.findCollectionByNameOrId("social_weekly_material_requests")));
