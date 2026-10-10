/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const bool = (name) => ({ name, type: "bool", required: false });
  const json = (name, required = false, maxSize = 2097152) => ({ name, type: "json", required, maxSize });

  const specs = [
    {
      name: "quote_rule_sets",
      fields: [
        text("tenant_id", true), text("rule_set_key", true), text("version", true), text("product_id", true),
        text("status", true), text("rule_hash", true), json("rule_set", true), text("idempotency_key", true),
        text("request_hash", true), text("created_by", true), text("created_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_quote_rule_version ON quote_rule_sets (tenant_id, rule_set_key, version)",
        "CREATE UNIQUE INDEX idx_quote_rule_idempotency ON quote_rule_sets (tenant_id, idempotency_key)",
        "CREATE INDEX idx_quote_rule_product ON quote_rule_sets (tenant_id, product_id)"
      ]
    },
    {
      name: "quote_drafts",
      fields: [
        text("tenant_id", true), text("inquiry_id", true), text("inquiry_version", true),
        text("rule_set_key", true), text("rule_set_version", true), text("rule_hash", true),
        text("input_hash", true), text("calculation_hash", true), json("input", true), json("calculation", true),
        json("exceptions", true), text("status", true), bool("approval_valid"), text("approval_evidence_id"),
        text("exception_request_id"), text("decided_at"),
        text("invalidation_reason"), text("superseded_by_id"), text("superseded_by_rule_version"), text("invalidated_at"),
        text("idempotency_key", true), text("request_hash", true), text("created_by", true),
        text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_quote_draft_idempotency ON quote_drafts (tenant_id, idempotency_key)",
        "CREATE INDEX idx_quote_draft_inquiry ON quote_drafts (tenant_id, inquiry_id, created_at)"
      ]
    },
    {
      name: "quote_exception_requests",
      fields: [
        text("tenant_id", true), text("draft_id", true), text("inquiry_id", true), text("status", true),
        json("exceptions", true), text("input_hash", true), text("rule_hash", true), text("calculation_hash", true),
        text("idempotency_key", true), text("request_hash", true), text("requested_by", true), text("created_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_quote_exception_draft ON quote_exception_requests (tenant_id, draft_id)",
        "CREATE UNIQUE INDEX idx_quote_exception_idempotency ON quote_exception_requests (tenant_id, idempotency_key)"
      ]
    },
    {
      name: "quote_approval_evidence",
      fields: [
        text("tenant_id", true), text("draft_id", true), text("input_hash", true), text("rule_hash", true),
        text("calculation_hash", true), text("decision", true), text("status", true), json("envelope", true), text("envelope_hash", true),
        text("idempotency_key", true), text("request_hash", true), text("recorded_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_quote_approval_draft ON quote_approval_evidence (tenant_id, draft_id)",
        "CREATE UNIQUE INDEX idx_quote_approval_idempotency ON quote_approval_evidence (tenant_id, idempotency_key)"
      ]
    },
    {
      name: "quote_external_send_evidence",
      fields: [
        text("tenant_id", true), text("draft_id", true), text("artifact_hash", true), text("status", true),
        json("envelope", true), text("envelope_hash", true), text("idempotency_key", true),
        text("request_hash", true), text("recorded_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_quote_send_evidence_artifact ON quote_external_send_evidence (tenant_id, draft_id, artifact_hash)",
        "CREATE UNIQUE INDEX idx_quote_send_evidence_idempotency ON quote_external_send_evidence (tenant_id, idempotency_key)"
      ]
    }
  ];

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const result = app.save(new Collection({
      name: spec.name,
      type: "base",
      system: false,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [id(), ...spec.fields],
      indexes: spec.indexes
    }));
    if (index === specs.length - 1) return result;
  }
}, (app) => {
  const names = [
    "quote_external_send_evidence", "quote_approval_evidence", "quote_exception_requests",
    "quote_drafts", "quote_rule_sets"
  ];
  for (let index = 0; index < names.length; index += 1) {
    const result = app.delete(app.findCollectionByNameOrId(names[index]));
    if (index === names.length - 1) return result;
  }
});
