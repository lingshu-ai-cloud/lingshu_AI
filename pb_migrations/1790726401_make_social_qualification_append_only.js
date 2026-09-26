/// <reference path="../pb_data/types.d.ts" />

// Keep every trusted sales-qualification decision as immutable history. The
// current state is derived from the newest confirmed_at value per interaction.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("social_sales_qualifications")
  collection.indexes = [
    ...(collection.indexes || []).filter(index => !index.includes("idx_social_sales_qualification")),
    "CREATE INDEX idx_social_sales_qualification ON social_sales_qualifications (tenant_id, interaction_id, confirmed_at)",
  ]
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("social_sales_qualifications")
  collection.indexes = [
    ...(collection.indexes || []).filter(index => !index.includes("idx_social_sales_qualification")),
    "CREATE UNIQUE INDEX idx_social_sales_qualification ON social_sales_qualifications (tenant_id, interaction_id)",
  ]
  return app.save(collection)
})
