/// <reference path="../pb_data/types.d.ts" />

// Explicit user-selected association; customer runs are never inferred from the latest run.
migrate((app) => {
  const text = (name) => ({ name, type: "text", required: true });
  return app.save(new Collection({
    name: "social_weekly_customer_bindings", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true,
        autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      text("tenant_id"), text("program_id"), text("package_id"), text("binding_id"),
      { name: "package_version", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "version", type: "number", required: true, onlyInt: true, min: 1 },
      text("run_id"), text("goal_id"), text("plan_id"), text("bound_by"), text("bound_at")
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_weekly_customer_identity ON social_weekly_customer_bindings (tenant_id, program_id, package_id, package_version)",
      "CREATE UNIQUE INDEX idx_social_weekly_customer_run ON social_weekly_customer_bindings (tenant_id, run_id)",
      "CREATE UNIQUE INDEX idx_social_weekly_customer_binding ON social_weekly_customer_bindings (tenant_id, binding_id)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("social_weekly_customer_bindings")));
