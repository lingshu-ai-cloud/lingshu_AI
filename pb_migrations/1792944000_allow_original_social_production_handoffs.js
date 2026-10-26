/// <reference path="../pb_data/types.d.ts" />

// Original-scene production handoffs have no reference-video analysis.
// Their payload carries the authored source contract while these two legacy
// projection columns remain populated only for reference-video handoffs.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("starter_social_production_handoffs")
  collection.fields.getByName("source_analysis_id").required = false
  collection.fields.getByName("source_analysis_version").required = false
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("starter_social_production_handoffs")
  collection.fields.getByName("source_analysis_id").required = true
  collection.fields.getByName("source_analysis_version").required = true
  return app.save(collection)
})
