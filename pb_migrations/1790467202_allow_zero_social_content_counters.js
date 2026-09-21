/// <reference path="../pb_data/types.d.ts" />

// PocketBase treats numeric zero as blank when a number field is marked
// required. Social-content counters legitimately start at zero, so requiring
// them prevents every new task from being created on the real database.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_tasks")
  for (const name of [
    "source_count",
    "knowledge_source_count",
    "material_source_count",
    "artifact_count",
    "approved_artifact_count",
    "delivery_package_count",
    "publication_count",
    "metric_submission_count",
  ]) {
    const field = collection.fields.getByName(name)
    if (field) field.required = false
  }
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_tasks")
  for (const name of [
    "source_count",
    "knowledge_source_count",
    "material_source_count",
    "artifact_count",
    "approved_artifact_count",
    "delivery_package_count",
    "publication_count",
    "metric_submission_count",
  ]) {
    const field = collection.fields.getByName(name)
    if (field) field.required = true
  }
  return app.save(collection)
})
