/// <reference path="../pb_data/types.d.ts" />

// Production inputs are missing source truth/material, not shooting tasks. The
// same durable record can be bound to many shots and fulfilled from inventory,
// documents, structured facts or authorization evidence.
migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, ...(max ? { max } : {}) });
  const json = (name, required = false, maxSize = 1048576) => ({ name, type: "json", required, maxSize });
  const bool = (name) => ({ name, type: "bool", required: false });
  const integer = (name, required = false, min = 0) => ({ name, type: "number", required, onlyInt: true, min });
  const decimal = (name, required = false) => ({ name, type: "number", required, onlyInt: false, min: 0 });
  const collection = (name, fields, indexes) => new Collection({
    name, type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  });

  app.save(collection("production_input_requests", [
    text("schema_version", true), text("tenant_id", true), text("dedupe_key", true), text("request_hash", true),
    text("category", true), text("kind", true), text("status", true), text("title", true, 200),
    text("instructions", false, 4000), bool("required"), bool("blocking"), text("subject_ref"),
    text("product_id"), text("product_name", false, 300), json("bindings", true, 524288),
    json("accepted_mime_types", true, 32768), json("specification", true, 262144),
    json("fulfillments", true, 2097152), integer("minimum_items", true, 1), text("created_by", true),
    text("created_at", true), text("updated_at", true), text("fulfilled_at"), text("waived_at"),
    text("waiver_reason", false, 1000)
  ], [
    "CREATE UNIQUE INDEX idx_production_input_request_dedupe ON production_input_requests (tenant_id, dedupe_key)",
    "CREATE INDEX idx_production_input_request_status ON production_input_requests (tenant_id, status, updated_at)",
    "CREATE INDEX idx_production_input_request_product ON production_input_requests (tenant_id, product_id, status)"
  ]));

  app.save(collection("production_cost_quotes", [
    text("schema_version", true), text("tenant_id", true), text("quote_key", true), text("request_hash", true),
    text("task_id", true), text("run_id", true), text("currency", true), text("pricing_version", true),
    text("status", true), decimal("expected_cost_cny", true), decimal("upper_bound_cost_cny", true),
    decimal("budget_limit_cny", true), json("lines", true, 2097152), text("reservation_id"),
    decimal("actual_cost_cny"), json("actual_lines", true, 2097152), text("created_at", true),
    text("updated_at", true), text("settled_at")
  ], [
    "CREATE UNIQUE INDEX idx_production_cost_quote_key ON production_cost_quotes (tenant_id, quote_key)",
    "CREATE INDEX idx_production_cost_quote_task ON production_cost_quotes (tenant_id, task_id, updated_at)",
    "CREATE INDEX idx_production_cost_quote_status ON production_cost_quotes (tenant_id, status, updated_at)"
  ]));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("production_cost_quotes"));
  return app.delete(app.findCollectionByNameOrId("production_input_requests"));
});
