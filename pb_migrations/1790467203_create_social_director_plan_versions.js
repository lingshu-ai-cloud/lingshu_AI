/// <reference path="../pb_data/types.d.ts" />

// Append-only Director Agent history. `starter_social_content_tasks.director_plan`
// remains the latest-version projection for compatibility, while every locked
// or blocked version and its exact fact/material snapshots live here.
migrate((app) => {
  const collection = new Collection({
    name: "starter_social_director_plan_versions",
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
      { name: "schema_version", type: "text", required: true },
      { name: "task_id", type: "text", required: true },
      { name: "director_plan_id", type: "text", required: true },
      { name: "plan_version", type: "text", required: true },
      { name: "previous_version", type: "text", required: false },
      { name: "lineage_hash", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "lock_status", type: "text", required: true },
      { name: "plan", type: "json", required: true, maxSize: 4194304 },
      { name: "fact_snapshot", type: "json", required: true, maxSize: 524288 },
      { name: "fact_snapshot_hash", type: "text", required: true },
      { name: "material_snapshot", type: "json", required: true, maxSize: 2097152 },
      { name: "material_snapshot_hash", type: "text", required: true },
      { name: "record_hash", type: "text", required: true },
      { name: "created_by", type: "text", required: true },
      { name: "created_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_director_plan_version ON starter_social_director_plan_versions (tenant_id, director_plan_id, plan_version)",
      "CREATE UNIQUE INDEX idx_social_director_plan_lineage ON starter_social_director_plan_versions (tenant_id, lineage_hash)",
      "CREATE UNIQUE INDEX idx_social_director_plan_record_hash ON starter_social_director_plan_versions (tenant_id, record_hash)",
      "CREATE INDEX idx_social_director_plan_task ON starter_social_director_plan_versions (tenant_id, task_id, created_at)"
    ]
  })
  return app.save(collection)
}, (app) => {
  return app.delete(app.findCollectionByNameOrId("starter_social_director_plan_versions"))
})
