/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true, min: 0 });
  const json = (name, required = false, maxSize = 2097152) => ({ name, type: "json", required, maxSize });
  const collection = (name, fields, indexes) => new Collection({
    name, type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  });

  app.save(collection("customer_points_wallets", [
    text("tenant_id", true), text("schema_version", true), number("revision", true),
    json("wallet", true, 4194304), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_customer_points_wallet_tenant ON customer_points_wallets (tenant_id)",
    "CREATE INDEX idx_customer_points_wallet_updated ON customer_points_wallets (updated_at)"
  ]));

  app.save(collection("customer_points_events", [
    text("tenant_id", true), text("event_id", true), text("operation_id", true),
    text("event_type", true), text("section"), text("feature_rate_id"), number("points", true),
    json("payload", true, 1048576), text("occurred_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_customer_points_event_identity ON customer_points_events (tenant_id, event_id)",
    "CREATE INDEX idx_customer_points_event_operation ON customer_points_events (tenant_id, operation_id)",
    "CREATE INDEX idx_customer_points_event_time ON customer_points_events (tenant_id, occurred_at)"
  ]));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("customer_points_events"));
  return app.delete(app.findCollectionByNameOrId("customer_points_wallets"));
});
