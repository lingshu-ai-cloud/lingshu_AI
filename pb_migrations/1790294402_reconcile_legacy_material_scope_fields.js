/// <reference path="../pb_data/types.d.ts" />

// Some legacy installations created `materials` before the generated schema
// included tenant ownership and content identity. Repair those installations
// before the existing provenance migration creates indexes over these fields.
const legacyMaterialScopeFields = [
  { id: "text3783197223", name: "tenantId", type: "text", required: false },
  { id: "text1556616439", name: "sha256", type: "text", required: false },
  { id: "text11490771", name: "scope", type: "text", required: false },
]

migrate((app) => {
  const collection = app.findCollectionByNameOrId("materials")
  for (const definition of legacyMaterialScopeFields) {
    let existing
    try { existing = collection.fields.getByName(definition.name) } catch {}
    if (!existing) collection.fields.addAt(collection.fields.length, new Field(definition))
  }
  return app.save(collection)
}, () => {
  throw new Error("material tenant scope is durable ownership evidence; rollback requires an explicitly reviewed forward migration")
})
