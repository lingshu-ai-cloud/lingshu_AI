/// <reference path="../pb_data/types.d.ts" />

// Cross-process arbitration for operations that must not overlap: external
// effects, product-profile transitions and Starter run mutations. No customer
// payload, provider credential or model output is stored in this collection.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  return app.save(new Collection({
    name: "durable_operation_leases",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      id(), text("tenant_id", true), text("lease_scope", true), text("subject_id", true),
      text("lease_token", true), text("owner_id", true), text("acquired_at", true),
      text("expires_at", true)
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_durable_operation_lease_subject ON durable_operation_leases (tenant_id, lease_scope, subject_id)",
      "CREATE INDEX idx_durable_operation_lease_expiry ON durable_operation_leases (expires_at)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("durable_operation_leases")));
