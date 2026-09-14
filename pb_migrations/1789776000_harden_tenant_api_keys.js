/// <reference path="../pb_data/types.d.ts" />

// Irreversible credential hardening. Existing plaintext bearer keys are
// destroyed and marked for explicit manager rotation; they are deliberately
// not converted into reusable HMAC credentials.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("tenant_api_keys")
  const hasField = (name) => {
    try { return Boolean(collection.fields.getByName(name)) } catch { return false }
  }
  const addField = (definition) => {
    if (hasField(definition.name)) return
    collection.fields.addAt(collection.fields.length, new Field(definition))
  }

  // The old index prevents deletion of its backing plaintext field.
  try { collection.removeIndex("idx_tenant_api_keys_key") } catch {}

  addField({
    id: "text_product_key_id", name: "key_id", type: "text", required: false,
    min: 0, max: 16, pattern: "^[A-Za-z0-9_-]{16}$"
  })
  addField({
    id: "text_product_key_prefix", name: "key_prefix", type: "text", required: false,
    min: 0, max: 24, pattern: "^ls_prod_[A-Za-z0-9_-]{16}$"
  })
  addField({
    id: "text_product_key_last4", name: "key_last4", type: "text", required: false,
    min: 0, max: 4, pattern: "^[A-Za-z0-9_-]{4}$"
  })
  addField({
    id: "text_product_key_hmac", name: "key_hmac", type: "text", required: false,
    min: 0, max: 64, pattern: "^[a-f0-9]{64}$"
  })
  addField({
    id: "text_product_key_hmac_version", name: "key_hmac_version", type: "text", required: false,
    min: 0, max: 32, pattern: "^hmac-sha256-v1$"
  })
  addField({
    id: "text_product_credential_status", name: "credential_status", type: "text", required: false,
    min: 0, max: 32, pattern: "^(active|requires_rotation)$"
  })

  // Multiple disabled legacy rows may temporarily have an empty key id. Only
  // issued credentials participate in the global lookup uniqueness rule.
  collection.addIndex(
    "idx_tenant_api_keys_key_id",
    true,
    "key_id",
    "key_id != ''"
  )

  const legacyField = hasField("api_key") ? collection.fields.getByName("api_key") : null
  if (legacyField) legacyField.required = false
  app.save(collection)

  const records = app.findAllRecords("tenant_api_keys")
  for (const record of records) {
    record.set("key_id", "")
    record.set("key_prefix", "")
    record.set("key_last4", "")
    record.set("key_hmac", "")
    record.set("key_hmac_version", "")
    record.set("credential_status", "requires_rotation")
    if (legacyField) record.set("api_key", "")
    app.save(record)
  }

  // Removing the field also removes any residual column bytes. A rollback is
  // intentionally unable to recreate either the field or the old key values.
  if (legacyField) {
    collection.fields.removeById(legacyField.id)
    app.save(collection)
  }
}, (_app) => {
  // Forward-only security boundary: never recreate plaintext bearer storage.
})
