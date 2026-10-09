/// <reference path="../pb_data/types.d.ts" />

// PocketBase's public Records API does not expose conditional PATCH/If-Match.
// A unique target key provides an atomic cross-process mutex shared by guarded
// and ordinary DataStore updates. Per-owner record ids and conservative leases
// permit only an exact operation replay to recover an indeterminate claim while
// fencing an old owner from deleting its replacement.
migrate((app) => app.save(new Collection({
  name: "datastore_cas_claims", type: "base", system: false,
  listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  fields: [
    { name: "id", type: "text", system: true, required: true, primaryKey: true,
      autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
    { name: "target_key", type: "text", required: true, max: 1000 },
    { name: "expected_fingerprint", type: "text", required: true, min: 64, max: 64 },
    { name: "operation_fingerprint", type: "text", required: true, min: 64, max: 64 },
    { name: "owner_token", type: "text", required: true, max: 64 },
    { name: "created_at", type: "text", required: true },
    { name: "lease_expires_at", type: "text", required: true }
  ],
  indexes: [
    "CREATE UNIQUE INDEX idx_datastore_cas_claim_target ON datastore_cas_claims (target_key)"
  ]
})), (app) => app.delete(app.findCollectionByNameOrId("datastore_cas_claims")));
