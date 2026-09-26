/// <reference path="../pb_data/types.d.ts" />

// Forward-only R6 wiring. Review lineage fields are optional so historic
// frozen snapshots stay readable; every new worker write supplies them.
migrate((app) => {
  const addText = (collection, name, id) => {
    try { collection.fields.getByName(name) } catch {
      collection.fields.addAt(collection.fields.length, new Field({ id, name, type: "text", required: false }))
    }
  }
  const addNumber = (collection, name, id) => {
    try { collection.fields.getByName(name) } catch {
      collection.fields.addAt(collection.fields.length, new Field({ id, name, type: "number", required: false, onlyInt: true, min: 0 }))
    }
  }
  const review = app.findCollectionByNameOrId("social_weekly_review_snapshots")
  addText(review, "program_id", "text1791072000a")
  addText(review, "package_id", "text1791072000b")
  addNumber(review, "package_version", "num1791072000a")
  review.indexes = [
    ...(review.indexes || []).filter(index => !index.includes("idx_social_weekly_review_week") && !index.includes("idx_social_weekly_review_package")),
    "CREATE INDEX idx_social_weekly_review_week ON social_weekly_review_snapshots (tenant_id, program_id, week_ref)",
    "CREATE UNIQUE INDEX idx_social_weekly_review_package ON social_weekly_review_snapshots (tenant_id, package_id, package_version) WHERE package_id <> ''",
  ]
  app.save(review)

  const decisions = app.findCollectionByNameOrId("social_weekly_promotion_decisions")
  addText(decisions, "program_id", "text1791072000c")
  app.save(decisions)
  const quotas = app.findCollectionByNameOrId("social_weekly_quota_references")
  addText(quotas, "program_id", "text1791072000d")
  quotas.indexes = [
    ...(quotas.indexes || []).filter(index => !index.includes("idx_social_weekly_quota_program")),
    "CREATE INDEX idx_social_weekly_quota_program ON social_weekly_quota_references (tenant_id, program_id, version)",
  ]
  app.save(quotas)

  return app.save(new Collection({
    name: "agent_notification_outbox", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true },
      { name: "event_id", type: "text", required: true },
      { name: "event_kind", type: "text", required: true },
      { name: "payload_digest", type: "text", required: true },
      { name: "payload", type: "json", required: true, maxSize: 1048576 },
      { name: "status", type: "text", required: true },
      { name: "attempts", type: "number", required: true, onlyInt: true, min: 0 },
      { name: "available_at", type: "text", required: true },
      { name: "claim_token", type: "text" },
      { name: "claimed_until", type: "text" },
      { name: "delivered_notification_id", type: "text" },
      { name: "delivered_at", type: "text" },
      { name: "last_error", type: "text" },
      { name: "created_at", type: "text", required: true },
      { name: "updated_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_agent_notification_outbox_event ON agent_notification_outbox (tenant_id, event_id)",
      "CREATE INDEX idx_agent_notification_outbox_delivery ON agent_notification_outbox (status, available_at)",
      "CREATE INDEX idx_agent_notification_outbox_claim ON agent_notification_outbox (status, claimed_until)"
    ]
  }))
}, (app) => {
  app.delete(app.findCollectionByNameOrId("agent_notification_outbox"))
  const quotas = app.findCollectionByNameOrId("social_weekly_quota_references")
  quotas.indexes = (quotas.indexes || []).filter(index => !index.includes("idx_social_weekly_quota_program"))
  try { quotas.fields.removeById(quotas.fields.getByName("program_id").id) } catch {}
  app.save(quotas)
  const decisions = app.findCollectionByNameOrId("social_weekly_promotion_decisions")
  try { decisions.fields.removeById(decisions.fields.getByName("program_id").id) } catch {}
  app.save(decisions)
  const review = app.findCollectionByNameOrId("social_weekly_review_snapshots")
  review.indexes = [
    ...(review.indexes || []).filter(index => !index.includes("idx_social_weekly_review_week") && !index.includes("idx_social_weekly_review_package")),
    "CREATE UNIQUE INDEX idx_social_weekly_review_week ON social_weekly_review_snapshots (tenant_id, week_ref)",
  ]
  for (const name of ["program_id", "package_id", "package_version"]) {
    try { review.fields.removeById(review.fields.getByName(name).id) } catch {}
  }
  return app.save(review)
})
