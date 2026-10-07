/// <reference path="../pb_data/types.d.ts" />

// Browser Studio renders are durable work records. The MP4 remains in the
// tenant-scoped publishing output store; this collection owns recovery state.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  return app.save(new Collection({
    name: "studio_render_jobs", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true,
        autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      text("tenant_id", true), text("project_id", true), text("idempotency_key", true),
      text("output_key", true), text("input_signature", true), text("status", true),
      { name: "spec", type: "json", required: true, maxSize: 4194304 },
      { name: "progress", type: "number", onlyInt: true, min: 0, max: 100 },
      { name: "attempts", type: "number", onlyInt: true, min: 0 },
      text("output_path"), text("preview_url"), text("error"), text("created_at", true), text("updated_at", true)
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_studio_render_job_idempotency ON studio_render_jobs (tenant_id, project_id, idempotency_key)",
      "CREATE INDEX idx_studio_render_job_recovery ON studio_render_jobs (tenant_id, project_id, status, updated_at)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("studio_render_jobs")));
