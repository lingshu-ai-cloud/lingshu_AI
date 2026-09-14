/// <reference path="../pb_data/types.d.ts" />

// Minimal, structured inquiry provenance for the starter quotation path.
// Raw customer messages and contact details are deliberately not stored here;
// source_reference_hash binds the external evidence without leaking it into UI.
migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name) => ({ name, type: "number", required: true, min: 1, onlyInt: true });
  const bool = (name) => ({ name, type: "bool", required: false });
  return app.save(new Collection({
    name: "starter_quote_inquiries",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      id(), text("tenant_id", true), text("inquiry_id", true), text("inquiry_version", true),
      text("source_channel", true), text("source_reference_hash", true), text("source_reference_hint", true),
      text("source_type", true), text("sku", true), number("quantity"), text("destination_country", true),
      bool("test_record"), text("status", true), text("idempotency_key", true), text("request_hash", true),
      text("created_by", true), text("created_at", true)
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_starter_quote_inquiry_id ON starter_quote_inquiries (tenant_id, inquiry_id, inquiry_version)",
      "CREATE UNIQUE INDEX idx_starter_quote_inquiry_source ON starter_quote_inquiries (tenant_id, source_channel, source_reference_hash, inquiry_version)",
      "CREATE UNIQUE INDEX idx_starter_quote_inquiry_idempotency ON starter_quote_inquiries (tenant_id, idempotency_key)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("starter_quote_inquiries")));
