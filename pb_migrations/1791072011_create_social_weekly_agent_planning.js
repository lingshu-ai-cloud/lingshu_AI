/// <reference path="../pb_data/types.d.ts" />

// Persist the versioned planning authority before operating packages use it.
migrate((app) => {
  const text = (name) => ({ name, type: "text", required: true });
  return app.save(new Collection({
    name: "social_weekly_agent_planning", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true,
        autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      text("tenant_id"), text("program_id"), text("package_id"),
      { name: "package_version", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "planning_version", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "payload", type: "json", required: true, maxSize: 8388608 },
      text("created_at")
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_weekly_agent_planning_identity ON social_weekly_agent_planning (tenant_id, program_id, package_id, package_version, planning_version)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("social_weekly_agent_planning")));
