/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("assistant_threads")
  const definitions = [
    { name: "userId", type: "text", required: false, max: 200 },
    { name: "version", type: "number", required: false, onlyInt: true, min: 0 },
  ]
  for (const definition of definitions) {
    let field
    try { field = collection.fields.getByName(definition.name) } catch {}
    if (!field) collection.fields.addAt(collection.fields.length, new Field(definition))
  }
  const index = "CREATE UNIQUE INDEX idx_assistant_thread_owner ON assistant_threads (tenantId, userId, agentId) WHERE userId != ''"
  collection.indexes = [
    ...(collection.indexes || []).filter(current => !current.includes("idx_assistant_thread_owner")),
    index,
  ]
  // Existing rows deliberately remain unowned. The API never returns or
  // adopts a row without a verified userId, because a tenant-wide legacy row
  // cannot safely be attributed to one of several users.
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("assistant_threads")
  collection.indexes = (collection.indexes || []).filter(index => !index.includes("idx_assistant_thread_owner"))
  for (const name of ["userId", "version"]) {
    let field
    try { field = collection.fields.getByName(name) } catch {}
    if (field) collection.fields.removeById(field.id)
  }
  return app.save(collection)
})
