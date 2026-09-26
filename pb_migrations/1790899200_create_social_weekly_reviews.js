/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const id = () => ({ name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" })
  const text = (name, required = false) => ({ name, type: "text", required, max: 0 })
  const json = (name, required = false) => ({ name, type: "json", required, maxSize: 4194304 })
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true })
  const immutable = (name, fields, indexes) => new Collection({ name, type: "base", system: false, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: [id(), ...fields], indexes })
  app.save(immutable("social_weekly_review_snapshots", [text("tenant_id", true), text("week_ref", true), text("snapshot_id", true), text("window_ends_at", true), text("source_digest", true), json("snapshot", true), text("frozen_at", true), text("frozen_by", true)], [
    "CREATE UNIQUE INDEX idx_social_weekly_review_week ON social_weekly_review_snapshots (tenant_id, week_ref)",
    "CREATE UNIQUE INDEX idx_social_weekly_review_id ON social_weekly_review_snapshots (tenant_id, snapshot_id)"
  ]))
  app.save(immutable("social_weekly_promotion_decisions", [text("tenant_id", true), text("decision_id", true), text("snapshot_id", true), text("content_id", true), text("action", true), json("decision", true), text("created_at", true)], [
    "CREATE UNIQUE INDEX idx_social_weekly_promotion_decision ON social_weekly_promotion_decisions (tenant_id, decision_id)"
  ]))
  return app.save(immutable("social_weekly_quota_references", [text("tenant_id", true), text("quota_id", true), number("version", true), text("snapshot_id", true), text("payload_digest", true), json("quota", true), text("created_at", true)], [
    "CREATE UNIQUE INDEX idx_social_weekly_quota_version ON social_weekly_quota_references (tenant_id, quota_id, version)",
    "CREATE INDEX idx_social_weekly_quota_snapshot ON social_weekly_quota_references (tenant_id, snapshot_id)"
  ]))
}, (app) => {
  app.delete(app.findCollectionByNameOrId("social_weekly_quota_references"))
  app.delete(app.findCollectionByNameOrId("social_weekly_promotion_decisions"))
  return app.delete(app.findCollectionByNameOrId("social_weekly_review_snapshots"))
})
