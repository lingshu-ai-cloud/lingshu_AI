/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("assistant_threads")
  const definitions = [
    { name: "isFollowingLatest", type: "bool", required: false },
    { name: "paused", type: "bool", required: false },
    { name: "taskCards", type: "json", required: false, maxSize: 131072 },
    { name: "focusedTaskId", type: "text", required: false, max: 200 },
  ]
  for (const definition of definitions) {
    let field
    try { field = collection.fields.getByName(definition.name) } catch {}
    if (!field) collection.fields.addAt(collection.fields.length, new Field(definition))
  }
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("assistant_threads")
  for (const name of ["isFollowingLatest", "paused", "taskCards", "focusedTaskId"]) {
    let field
    try { field = collection.fields.getByName(name) } catch {}
    if (field) collection.fields.removeById(field.id)
  }
  return app.save(collection)
})
