/// <reference path="../pb_data/types.d.ts" />

// Tenant-scoped discovery scope and benchmark-account decisions. Raw query
// strings are only an execution projection inside the versioned scope payload.
migrate((app) => {
  const scopes = new Collection({
    name: "social_discovery_scopes",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true },
      { name: "keyword_set_id", type: "text", required: true },
      { name: "version", type: "number", required: true, min: 1, onlyInt: true },
      { name: "status", type: "text", required: true },
      { name: "payload", type: "json", required: true, maxSize: 2097152 },
      { name: "created_by", type: "text", required: true },
      { name: "created_at", type: "text", required: true },
      { name: "updated_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_discovery_active_scope ON social_discovery_scopes (tenant_id) WHERE status = 'active'",
      "CREATE INDEX idx_social_discovery_version ON social_discovery_scopes (tenant_id, keyword_set_id, version)"
    ]
  })
  app.save(scopes)

  const accounts = new Collection({
    name: "social_tracked_accounts",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true },
      { name: "accountId", type: "text", required: true },
      { name: "decision", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "accountRole", type: "text", required: true },
      { name: "reasons", type: "json", maxSize: 262144 },
      { name: "evidenceVideoIds", type: "json", maxSize: 262144 },
      { name: "relatedSceneIds", type: "json", maxSize: 262144 },
      { name: "missingEvidence", type: "json", maxSize: 262144 },
      { name: "nextReviewAt", type: "text" },
      { name: "recommendedCadence", type: "text" },
      { name: "confidence", type: "number", min: 0, max: 1 },
      { name: "updated_by", type: "text", required: true },
      { name: "updated_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_tracked_account ON social_tracked_accounts (tenant_id, accountId)",
      "CREATE INDEX idx_social_tracked_status ON social_tracked_accounts (tenant_id, status, updated_at)"
    ]
  })
  return app.save(accounts)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("social_tracked_accounts"))
  return app.delete(app.findCollectionByNameOrId("social_discovery_scopes"))
})
