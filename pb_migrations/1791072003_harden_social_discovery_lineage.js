/// <reference path="../pb_data/types.d.ts" />

// R4 forward-only hardening: crawler imports are separated from qualified
// evidence, production-gap recovery is durable, and rework always points back
// to the exact weekly task/lineage that created the production attempt.
migrate((app) => {
  const runs = app.findCollectionByNameOrId("social_discovery_runs")
  runs.fields.add(new Field({ name: "evidenceOutcomes", type: "json", maxSize: 2097152 }))
  app.save(runs)

  const gaps = app.findCollectionByNameOrId("social_discovery_gap_tasks")
  gaps.fields.add(new Field({ name: "taskGap", type: "json", maxSize: 1048576 }))
  gaps.fields.add(new Field({ name: "budget", type: "json", maxSize: 262144 }))
  gaps.fields.add(new Field({ name: "attemptCount", type: "number", onlyInt: true, min: 0 }))
  gaps.fields.add(new Field({ name: "lastError", type: "text", max: 2000000 }))
  gaps.fields.add(new Field({ name: "lastAttemptAt", type: "text" }))
  gaps.fields.add(new Field({ name: "referenceSelectionRef", type: "json", maxSize: 262144 }))
  app.save(gaps)

  const returns = app.findCollectionByNameOrId("starter_social_content_rework_queue")
  returns.fields.add(new Field({ name: "weekly_task_version", type: "number", onlyInt: true, min: 1 }))
  returns.fields.add(new Field({ name: "lineage_id", type: "text" }))
  returns.fields.add(new Field({ name: "lineage_version", type: "text" }))
  returns.fields.add(new Field({ name: "production_result_id", type: "text" }))
  returns.fields.add(new Field({ name: "scene_id", type: "text" }))
  returns.fields.add(new Field({ name: "action", type: "text" }))
  returns.fields.add(new Field({ name: "failure_scope", type: "text" }))
  returns.indexes = [
    ...returns.indexes,
    "CREATE INDEX idx_social_content_return_lineage ON starter_social_content_rework_queue (tenant_id, lineage_id, lineage_version)",
    "CREATE INDEX idx_social_content_return_result ON starter_social_content_rework_queue (tenant_id, production_result_id, status)"
  ]
  return app.save(returns)
}, (app) => {
  const returns = app.findCollectionByNameOrId("starter_social_content_rework_queue")
  returns.indexes = returns.indexes.filter((value) => !value.includes("idx_social_content_return_lineage") && !value.includes("idx_social_content_return_result"))
  for (const name of ["weekly_task_version", "lineage_id", "lineage_version", "production_result_id", "scene_id", "action", "failure_scope"]) returns.fields.removeByName(name)
  app.save(returns)

  const gaps = app.findCollectionByNameOrId("social_discovery_gap_tasks")
  for (const name of ["taskGap", "budget", "attemptCount", "lastError", "lastAttemptAt", "referenceSelectionRef"]) gaps.fields.removeByName(name)
  app.save(gaps)

  const runs = app.findCollectionByNameOrId("social_discovery_runs")
  runs.fields.removeByName("evidenceOutcomes")
  return app.save(runs)
})
