/// <reference path="../pb_data/types.d.ts" />

// V3 append-only Director -> Content Agent production handoff and receipt
// ledger. The handoff freezes source analysis, DirectorBrief and the exact
// execution plan. Receipts advance G4-G6 without mutating that snapshot.
migrate((app) => {
  const handoffs = new Collection({
    name: "starter_social_production_handoffs", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true },
      { name: "schema_version", type: "text", required: true },
      { name: "handoff_id", type: "text", required: true },
      { name: "task_id", type: "text", required: true },
      { name: "handoff_version", type: "text", required: true },
      { name: "director_brief_id", type: "text", required: true },
      { name: "director_brief_version", type: "text", required: true },
      { name: "execution_plan_id", type: "text", required: true },
      { name: "execution_plan_version", type: "text", required: true },
      { name: "execution_review_id", type: "text", required: true },
      { name: "execution_review_version", type: "text", required: true },
      { name: "source_analysis_id", type: "text", required: true },
      { name: "source_analysis_version", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "payload", type: "json", required: true, maxSize: 8388608 },
      { name: "record_hash", type: "text", required: true },
      { name: "created_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_production_handoff_identity ON starter_social_production_handoffs (tenant_id, handoff_id, handoff_version)",
      "CREATE UNIQUE INDEX idx_social_production_handoff_hash ON starter_social_production_handoffs (tenant_id, record_hash)",
      "CREATE INDEX idx_social_production_handoff_task ON starter_social_production_handoffs (tenant_id, task_id, created_at)"
    ]
  })
  app.save(handoffs)
  const receipts = new Collection({
    name: "starter_social_production_receipts", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true },
      { name: "schema_version", type: "text", required: true },
      { name: "receipt_id", type: "text", required: true },
      { name: "handoff_id", type: "text", required: true },
      { name: "handoff_version", type: "text", required: true },
      { name: "gate", type: "text", required: true },
      { name: "scene_id", type: "text", required: false },
      { name: "attempt", type: "number", required: true, min: 1 },
      { name: "status", type: "text", required: true },
      { name: "production_result_id", type: "text", required: true },
      { name: "production_result_version", type: "text", required: true },
      { name: "evidence_kind", type: "text", required: true },
      { name: "payload", type: "json", required: true, maxSize: 4194304 },
      { name: "record_hash", type: "text", required: true },
      { name: "created_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_production_receipt_identity ON starter_social_production_receipts (tenant_id, receipt_id)",
      "CREATE UNIQUE INDEX idx_social_production_receipt_attempt ON starter_social_production_receipts (tenant_id, handoff_id, handoff_version, gate, scene_id, attempt)",
      "CREATE UNIQUE INDEX idx_social_production_receipt_hash ON starter_social_production_receipts (tenant_id, record_hash)",
      "CREATE INDEX idx_social_production_receipt_handoff ON starter_social_production_receipts (tenant_id, handoff_id, handoff_version, gate, created_at)"
    ]
  })
  return app.save(receipts)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("starter_social_production_receipts"))
  return app.delete(app.findCollectionByNameOrId("starter_social_production_handoffs"))
})
