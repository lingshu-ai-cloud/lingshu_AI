/// <reference path="../pb_data/types.d.ts" />

// R5 durable publication lineage and engagement ingestion runtime. These
// server-only collections do not grant provider capability by configuration;
// availability requires a persisted provider observation.
migrate((app) => {
  const id = () => ({ name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" })
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, max })
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true })
  const json = (name, required = false, maxSize = 4194304) => ({ name, type: "json", required, maxSize })
  const collection = (name, fields, indexes) => new Collection({
    name, type: "base", system: false, listRule: null, viewRule: null,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  })

  app.save(collection("social_platform_capability_evidence", [
    text("tenant_id", true), text("account_id", true), text("platform", true), text("capability", true),
    text("status", true), text("evidence_source", true), text("evidence_ref", true),
    text("verified_at", true), text("expires_at"), text("reason_code"), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_platform_capability_evidence ON social_platform_capability_evidence (tenant_id, account_id, capability, evidence_ref)",
    "CREATE INDEX idx_platform_capability_latest ON social_platform_capability_evidence (tenant_id, platform, capability, verified_at)"
  ]))

  app.save(collection("social_publication_assignments", [
    text("tenant_id", true), text("assignment_id", true), text("package_id", true),
    text("operating_package_id", true), number("operating_package_version", true),
    text("publication_task_id", true), text("production_result_id", true), text("platform", true), text("account_id", true),
    text("status", true), json("payload", true), text("assignment_hash", true),
    text("authorization_revoked_at"), text("authorization_revoked_by"),
    { name: "receipt_recovery_required", type: "bool", required: false }, text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_publication_assignment_id ON social_publication_assignments (tenant_id, assignment_id)",
    "CREATE UNIQUE INDEX idx_publication_assignment_subject ON social_publication_assignments (tenant_id, operating_package_id, operating_package_version, publication_task_id, production_result_id)",
    "CREATE INDEX idx_publication_assignment_status ON social_publication_assignments (tenant_id, status, updated_at)"
  ]))

  app.save(collection("social_publication_attempts", [
    text("tenant_id", true), text("attempt_id", true), text("assignment_id", true), text("package_id", true),
    text("provider", true), text("status", true), text("provider_receipt_id"), text("platform_post_id"),
    text("platform_url"), text("failure_code"), text("started_at", true), text("resolved_at"), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_publication_attempt_id ON social_publication_attempts (tenant_id, attempt_id)",
    "CREATE UNIQUE INDEX idx_publication_attempt_assignment ON social_publication_attempts (tenant_id, assignment_id)",
    "CREATE INDEX idx_publication_attempt_status ON social_publication_attempts (tenant_id, status, updated_at)"
  ]))

  app.save(collection("social_engagement_cursors", [
    text("tenant_id", true), text("adapter_id", true), text("platform", true), text("surface", true),
    text("account_id", true), text("cursor"), number("version", true), number("failure_count", true),
    text("next_retry_at"), text("last_error", false, 500), text("last_synced_at"), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_engagement_cursor_binding ON social_engagement_cursors (tenant_id, adapter_id, account_id)",
    "CREATE INDEX idx_engagement_cursor_retry ON social_engagement_cursors (next_retry_at, platform)"
  ]))

  app.save(collection("social_engagement_sources", [
    text("tenant_id", true), text("source_id", true), text("platform", true), text("account_id", true),
    text("label", true), text("signing_secret"), text("status", true), text("created_by", true),
    text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_engagement_source_global ON social_engagement_sources (source_id)",
    "CREATE INDEX idx_engagement_source_tenant ON social_engagement_sources (tenant_id, platform, status)"
  ]))

  return app.save(collection("social_engagement_webhook_receipts", [
    text("tenant_id", true), text("source_id", true), text("provider_event_id", true), text("payload_hash", true),
    text("interaction_id", true), text("received_minute", true), text("received_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_engagement_webhook_event ON social_engagement_webhook_receipts (tenant_id, source_id, provider_event_id)",
    "CREATE INDEX idx_engagement_webhook_rate ON social_engagement_webhook_receipts (tenant_id, source_id, received_minute)"
  ]))
}, (app) => {
  app.delete(app.findCollectionByNameOrId("social_engagement_webhook_receipts"))
  app.delete(app.findCollectionByNameOrId("social_engagement_sources"))
  app.delete(app.findCollectionByNameOrId("social_engagement_cursors"))
  app.delete(app.findCollectionByNameOrId("social_publication_attempts"))
  app.delete(app.findCollectionByNameOrId("social_publication_assignments"))
  return app.delete(app.findCollectionByNameOrId("social_platform_capability_evidence"))
})
