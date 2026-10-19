/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = new Collection({
    name: "weekly_candidate_exact_dynamic_heads", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true, min: 1, max: 256, pattern: "^[A-Za-z0-9._:-]+$" },
      { name: "operation_id", type: "text", required: true, min: 1, max: 256, pattern: "^[A-Za-z0-9._:-]+$" },
      { name: "authorization_hash", type: "text", required: true, min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
      { name: "plan_hash", type: "text", required: true, min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
      { name: "head_schema", type: "text", required: true, min: 38, max: 38, pattern: "^weekly-candidate-dynamic-exact-head\\.v2$" },
      { name: "generation", type: "number", required: true, onlyInt: true, min: 0 },
      { name: "ledger_hash", type: "text", required: true, min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
      { name: "created_at", type: "text", required: true, min: 20, max: 40 },
      { name: "updated_at", type: "text", required: true, min: 20, max: 40 }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_weekly_candidate_exact_dynamic_head_identity ON weekly_candidate_exact_dynamic_heads (tenant_id, operation_id, authorization_hash, plan_hash)",
      "CREATE INDEX idx_weekly_candidate_exact_dynamic_head_operation ON weekly_candidate_exact_dynamic_heads (tenant_id, operation_id)"
    ]
  });
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId("weekly_candidate_exact_dynamic_heads")));
