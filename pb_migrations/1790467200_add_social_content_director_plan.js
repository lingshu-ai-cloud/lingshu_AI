/// <reference path="../pb_data/types.d.ts" />

// Versioned Director Agent handoff. The complete plan remains server-side;
// customer APIs expose only a safe summary without formula identifiers or
// internal templates.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_tasks")
  if (!collection.fields.getByName("director_plan")) {
    collection.fields.addAt(collection.fields.length, new Field({
      id: "json1790467200",
      name: "director_plan",
      type: "json",
      required: false,
      maxSize: 2097152
    }))
  }
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_tasks")
  try {
    collection.fields.removeById(collection.fields.getByName("director_plan").id)
  } catch {}
  return app.save(collection)
})
