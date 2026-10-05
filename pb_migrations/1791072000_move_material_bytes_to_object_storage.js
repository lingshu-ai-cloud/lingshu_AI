/// <reference path="../pb_data/types.d.ts" />

// New material uploads keep only metadata in PocketBase. The immutable media
// bytes live in the configured object store; historical PocketBase file-backed
// records remain readable during migration.
const objectStorageFields = [
  { id: "text_mat_object_key", name: "objectKey", type: "text", required: false },
  { id: "text_mat_poster_object_key", name: "posterObjectKey", type: "text", required: false },
  { id: "text_mat_object_etag", name: "objectEtag", type: "text", required: false },
  { id: "text_mat_poster_object_etag", name: "posterObjectEtag", type: "text", required: false },
  { id: "text_mat_storage_backend", name: "storageBackend", type: "text", required: false },
]

migrate((app) => {
  const collection = app.findCollectionByNameOrId("materials")
  collection.fields.getByName("videoFile").required = false
  collection.fields.getByName("posterFile").required = false
  for (const definition of objectStorageFields) {
    let existing
    try { existing = collection.fields.getByName(definition.name) } catch {}
    if (!existing) collection.fields.addAt(collection.fields.length, new Field(definition))
  }
  const indexes = collection.indexes || []
  if (!indexes.some(index => index.includes("idx_materials_object_key"))) {
    collection.indexes = [...indexes, "CREATE INDEX idx_materials_object_key ON materials (objectKey)"]
  }
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("materials")
  for (const definition of objectStorageFields) {
    try {
      const field = collection.fields.getByName(definition.name)
      if (field.id === definition.id) collection.fields.removeById(field.id)
    } catch {}
  }
  collection.indexes = (collection.indexes || []).filter(index => !index.includes("idx_materials_object_key"))
  collection.fields.getByName("videoFile").required = true
  collection.fields.getByName("posterFile").required = true
  return app.save(collection)
})
