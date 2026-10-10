/// <reference path="../pb_data/types.d.ts" />

// Security migration: remove the legacy recoverable customer-password field and
// its stored values from databases where the historical migration already ran.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("tenants")

  let legacyField = null
  try {
    legacyField = collection.fields.getByName("registeredPasswordCipher")
  } catch {
    // Some pre-baseline databases may already lack the legacy field.
    return
  }
  if (!legacyField) {
    // PocketBase 0.39 returns an empty value instead of throwing when absent.
    return
  }

  collection.fields.removeById(legacyField.id)
  return app.save(collection)
}, (_app) => {
  // Intentionally irreversible: rollback must never recreate recoverable secrets.
})
