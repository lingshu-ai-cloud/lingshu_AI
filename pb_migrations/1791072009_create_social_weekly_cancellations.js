/// <reference path="../pb_data/types.d.ts" />

// Durable, resumable compensation receipt. Existing provider effects are kept;
// cancelling a package stops future work and never claims to refund or unpublish.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  return app.save(new Collection({
    name: "social_weekly_cancellations",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true,
        autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      text("tenant_id", true),
      text("program_id", true),
      text("package_id", true),
      { name: "package_version", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "status", type: "select", required: true, maxSelect: 1,
        values: ["in_progress", "partial_failure", "completed", "completed_with_external_effects"] },
      text("reason", true),
      text("boundary", true),
      { name: "checkpoints", type: "json", maxSize: 4194304 },
      { name: "effects", type: "json", maxSize: 8388608 },
      text("last_error"),
      text("created_at", true),
      text("updated_at", true),
      text("completed_at")
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_weekly_cancellation_identity ON social_weekly_cancellations (tenant_id, program_id, package_id, package_version)",
      "CREATE INDEX idx_social_weekly_cancellation_recovery ON social_weekly_cancellations (tenant_id, status, updated_at)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("social_weekly_cancellations")));
