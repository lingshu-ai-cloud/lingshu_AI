/// <reference path="../pb_data/types.d.ts" />

// Workflow progress is an independent append-only stream. The unique state
// version is the persistent compare-and-swap boundary; event_id supplies
// request idempotency across retries and process restarts.
migrate((app) => {
  const collection = new Collection({
    name: "social_weekly_workflow_events",
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
      { name: "tenant_id", type: "text", required: true },
      { name: "program_id", type: "text", required: true },
      { name: "package_id", type: "text", required: true },
      { name: "package_version", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "event_id", type: "text", required: true },
      { name: "state_version", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "event_digest", type: "text", required: true },
      { name: "event", type: "json", required: true, maxSize: 1048576 },
      { name: "created_by", type: "text", required: true },
      { name: "created_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_weekly_workflow_event_id ON social_weekly_workflow_events (tenant_id, package_id, package_version, event_id)",
      "CREATE UNIQUE INDEX idx_social_weekly_workflow_state_version ON social_weekly_workflow_events (tenant_id, package_id, package_version, state_version)",
      "CREATE INDEX idx_social_weekly_workflow_stream ON social_weekly_workflow_events (tenant_id, program_id, package_id, package_version, state_version)"
    ]
  })
  return app.save(collection)
}, (app) => {
  return app.delete(app.findCollectionByNameOrId("social_weekly_workflow_events"))
})
