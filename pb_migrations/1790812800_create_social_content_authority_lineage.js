/// <reference path="../pb_data/types.d.ts" />

// Append-only T3/T4 -> Starter198 authority snapshots and recoverable return queue.
migrate((app) => {
  const baseFields = (identityFields) => [
    { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
    { name: "tenant_id", type: "text", required: true },
    ...identityFields,
    { name: "payload", type: "json", required: true, maxSize: 8388608 },
    { name: "record_hash", type: "text", required: false },
    { name: "created_at", type: "text", required: true }
  ]
  const save = (name, fields, indexes) => app.save(new Collection({
    name, type: "base", system: false, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: baseFields(fields), indexes
  }))
  save("starter_social_inspiration_handoff_versions", [
    { name: "handoff_id", type: "text", required: true }, { name: "handoff_version", type: "text", required: true }
  ], ["CREATE UNIQUE INDEX idx_inspiration_handoff_version ON starter_social_inspiration_handoff_versions (tenant_id, handoff_id, handoff_version)"])
  save("starter_social_director_brief_versions", [
    { name: "director_brief_id", type: "text", required: true }, { name: "director_brief_version", type: "text", required: true }
  ], ["CREATE UNIQUE INDEX idx_director_brief_version ON starter_social_director_brief_versions (tenant_id, director_brief_id, director_brief_version)"])
  save("starter_social_content_lineage", [
    { name: "lineage_id", type: "text", required: true }, { name: "lineage_version", type: "text", required: true },
    { name: "weekly_task_id", type: "text", required: true }, { name: "production_result_id", type: "text", required: false }
  ], [
    "CREATE UNIQUE INDEX idx_social_content_lineage_version ON starter_social_content_lineage (tenant_id, lineage_id, lineage_version)",
    "CREATE INDEX idx_social_content_lineage_task ON starter_social_content_lineage (tenant_id, weekly_task_id, created_at)",
    "CREATE INDEX idx_social_content_lineage_result ON starter_social_content_lineage (tenant_id, production_result_id)"
  ])
  return save("starter_social_content_rework_queue", [
    { name: "queue_item_id", type: "text", required: true }, { name: "weekly_task_id", type: "text", required: true },
    { name: "destination", type: "text", required: true }, { name: "reason", type: "text", required: true },
    { name: "status", type: "text", required: true }
  ], [
    "CREATE UNIQUE INDEX idx_social_content_return_identity ON starter_social_content_rework_queue (tenant_id, queue_item_id)",
    "CREATE INDEX idx_social_content_return_task ON starter_social_content_rework_queue (tenant_id, weekly_task_id, status, created_at)"
  ])
}, (app) => {
  app.delete(app.findCollectionByNameOrId("starter_social_content_rework_queue"))
  app.delete(app.findCollectionByNameOrId("starter_social_content_lineage"))
  app.delete(app.findCollectionByNameOrId("starter_social_director_brief_versions"))
  return app.delete(app.findCollectionByNameOrId("starter_social_inspiration_handoff_versions"))
})
