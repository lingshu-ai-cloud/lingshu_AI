/// <reference path="../pb_data/types.d.ts" />

// Fine-grained, immutable-input execution units for one exact weekly package
// version. Runtime ownership uses durable_operation_leases; the lease snapshot
// in payload is fencing metadata for workers and operators.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  return app.save(new Collection({
    name: "social_weekly_execution_tasks",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "id", type: "text", system: true, required: true, primaryKey: true,
        autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
      },
      text("tenant_id", true),
      text("program_id", true),
      text("package_id", true),
      { name: "package_version", type: "number", required: true, onlyInt: true, min: 1 },
      text("task_id", true),
      text("workflow_kind", true),
      text("status", true),
      text("idempotency_key", true),
      text("next_attempt_at"),
      { name: "payload", type: "json", required: true, maxSize: 4194304 },
      text("created_at", true),
      text("updated_at", true)
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_weekly_execution_task_id ON social_weekly_execution_tasks (tenant_id, task_id)",
      "CREATE UNIQUE INDEX idx_social_weekly_execution_idempotency ON social_weekly_execution_tasks (tenant_id, idempotency_key)",
      "CREATE INDEX idx_social_weekly_execution_package ON social_weekly_execution_tasks (tenant_id, program_id, package_id, package_version)",
      "CREATE INDEX idx_social_weekly_execution_claim ON social_weekly_execution_tasks (tenant_id, status, next_attempt_at, created_at)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("social_weekly_execution_tasks")));
