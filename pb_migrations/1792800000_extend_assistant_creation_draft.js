/// <reference path="../pb_data/types.d.ts" />
// Presentation-only selection in the existing owner/version-scoped assistant thread.
// This field is never a production authorization; strategy re-reads every selected ID.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads')
  let field
  try { field = collection.fields.getByName('creationDraft') } catch {}
  if (!field) collection.fields.addAt(collection.fields.length, new Field({
    name: 'creationDraft', type: 'json', required: false, maxSize: 16384,
  }))
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads')
  let field
  try { field = collection.fields.getByName('creationDraft') } catch {}
  if (field) collection.fields.removeById(field.id)
  return app.save(collection)
})
