/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("social_publication_packages")
  try {
    collection.fields.getByName("evidence_history")
  } catch {
    collection.fields.addAt(collection.fields.length, new Field({
      id: "json1790294402",
      name: "evidence_history",
      type: "json",
      required: false,
      maxSize: 2097152
    }))
  }
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("social_publication_packages")
  try {
    collection.fields.removeById(collection.fields.getByName("evidence_history").id)
  } catch {}
  return app.save(collection)
})
