/// <reference path="../pb_data/types.d.ts" />

// Structured production checkpoints share the durable content job identity.
// They keep analysis, narration timing and shot/material routing recoverable
// across browser refreshes and worker restarts without persisting temp media.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("content_execution_jobs")
  if (!collection.fields.getByName("checkpoints")) {
    collection.fields.addAt(collection.fields.length, new Field({
      name: "checkpoints",
      type: "json",
      required: false,
      maxSize: 4194304
    }))
  }
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("content_execution_jobs")
  const field = collection.fields.getByName("checkpoints")
  if (field) collection.fields.removeById(field.id)
  return app.save(collection)
})
