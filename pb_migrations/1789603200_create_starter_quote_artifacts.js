/// <reference path="../pb_data/types.d.ts" />

// Immutable customer-downloadable bytes for an approved deterministic quote.
// The SHA-256 is calculated from body_base64 after decoding; customers never
// need to type or copy this implementation detail when recording a manual send.
migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  return app.save(new Collection({
    name: "starter_quote_artifacts",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      id(), text("tenant_id", true), text("artifact_id", true), text("draft_id", true),
      text("input_hash", true), text("rule_hash", true), text("calculation_hash", true),
      text("approval_evidence_id", true), text("sha256", true), text("media_type", true),
      text("file_name", true), text("body_base64", true), text("status", true),
      text("idempotency_key", true), text("created_at", true)
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_starter_quote_artifact_id ON starter_quote_artifacts (tenant_id, artifact_id)",
      "CREATE UNIQUE INDEX idx_starter_quote_artifact_draft ON starter_quote_artifacts (tenant_id, draft_id)",
      "CREATE UNIQUE INDEX idx_starter_quote_artifact_idempotency ON starter_quote_artifacts (tenant_id, idempotency_key)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("starter_quote_artifacts")));
