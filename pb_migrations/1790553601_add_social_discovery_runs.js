/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const accounts = app.findCollectionByNameOrId("social_tracked_accounts")
  accounts.fields.add(new Field({ name: "recommendedBy", type: "text" }))
  accounts.fields.add(new Field({ name: "businessConfirmation", type: "json", maxSize: 65536 }))
  app.save(accounts)

  const runs = new Collection({
    name: "social_discovery_runs",
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
      { name: "runId", type: "text", required: true },
      { name: "planId", type: "text", required: true },
      { name: "keywordSetId", type: "text", required: true },
      { name: "keywordSetVersion", type: "number", required: true, min: 1, onlyInt: true },
      { name: "discoveryScopeId", type: "text", required: true },
      { name: "discoveryScopeVersion", type: "number", required: true, min: 1, onlyInt: true },
      { name: "status", type: "text", required: true },
      { name: "triggerType", type: "text", required: true },
      { name: "scopeSnapshot", type: "json", required: true, maxSize: 2097152 },
      { name: "modeStats", type: "json", required: true, maxSize: 1048576 },
      { name: "sourceRunRefs", type: "json", maxSize: 262144 },
      { name: "queryBasis", type: "json", required: true, maxSize: 1048576 },
      { name: "market", type: "text" },
      { name: "language", type: "text" },
      { name: "stopReason", type: "text" },
      { name: "startedAt", type: "text", required: true },
      { name: "finishedAt", type: "text" },
      { name: "error", type: "text", max: 2000000 }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_discovery_run ON social_discovery_runs (tenant_id, runId)",
      "CREATE INDEX idx_social_discovery_run_scope ON social_discovery_runs (tenant_id, keywordSetId, startedAt)"
    ]
  })
  return app.save(runs)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("social_discovery_runs"))
  const accounts = app.findCollectionByNameOrId("social_tracked_accounts")
  accounts.fields.removeByName("recommendedBy")
  accounts.fields.removeByName("businessConfirmation")
  return app.save(accounts)
})
