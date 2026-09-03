/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 84c09d4f263f99bd307afc4ff0e6ce1bcf6817002a1892c235dd20f0bc7687c8
migrate((app) => {
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, ...(max ? { max } : {}) });
  const number = (name, required = false) => ({ name, type: "number", required });
  const fields = [
    text("tenant_id", true), text("api_key_hash", false, 64), text("key_prefix", false, 32),
    text("key_last4", false, 4), text("created_at", true), text("rotated_at"), text("revoked_at"),
    text("last_ingested_at"), text("last_product_name"), number("version", true)
  ];
  const indexes = [
    "CREATE UNIQUE INDEX idx_tenant_api_keys_tenant ON tenant_api_keys (tenant_id)",
    "CREATE UNIQUE INDEX idx_tenant_api_keys_hash ON tenant_api_keys (api_key_hash) WHERE api_key_hash != ''"
  ];

  let collection;
  try { collection = app.findCollectionByNameOrId("tenant_api_keys"); } catch {}
  if (!collection) {
    collection = new Collection({
      id: "lsapikeys000001", name: "tenant_api_keys", type: "base", system: false,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [idField(), ...fields], indexes
    });
    app.save(collection);
    return;
  }

  // Add optional fields first so legacy rows can be revoked before the
  // metadata fields become required.
  for (const wanted of fields) {
    let existing;
    try { existing = collection.fields.getByName(wanted.name); } catch {}
    if (existing) continue;
    collection.fields.addAt(collection.fields.length, new Field({ ...wanted, required: false }));
  }
  // Dropping this field irrevocably scrubs every recoverable plaintext key.
  try { collection.fields.removeById(collection.fields.getByName("api_key").id); } catch {}
  app.save(collection);

  const now = new Date().toISOString();
  const records = app.findAllRecords("tenant_api_keys");
  records.sort((left, right) => String(right.get("updated") || right.get("created_at") || "")
    .localeCompare(String(left.get("updated") || left.get("created_at") || "")));
  const keepByTenant = {};
  for (const record of records) {
    const tenantId = String(record.get("tenant_id") || "").trim();
    if (!tenantId || keepByTenant[tenantId]) {
      app.delete(record);
      continue;
    }
    keepByTenant[tenantId] = true;
    record.set("api_key_hash", "");
    record.set("key_prefix", "");
    record.set("key_last4", "");
    record.set("revoked_at", String(record.get("revoked_at") || now));
    record.set("created_at", String(record.get("created_at") || now));
    record.set("version", Math.max(1, Number(record.get("version") || 0) + 1));
    app.save(record);
  }

  // Enforce the canonical required metadata only after all retained rows have
  // been repaired, then add tenant/hash uniqueness.
  try { collection.fields.getByName("created_at").required = true; } catch {}
  try { collection.fields.getByName("version").required = true; } catch {}
  collection.indexes = (collection.indexes || [])
    .filter((index) => !index.includes("idx_tenant_api_keys_tenant") && !index.includes("idx_tenant_api_keys_hash"))
    .concat(indexes);
  app.save(collection);
}, (_app) => {
  // Intentionally irreversible: a down migration must never recreate a
  // plaintext secret column or make a previously revoked key usable again.
});
