/// <reference path="../pb_data/types.d.ts" />

// Cross-process ownership for deterministic Starter workers. Leases are short
// lived and contain no customer payload, credentials, or model output.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  return app.save(new Collection({
    name: "starter_worker_leases",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      id(), text("tenant_id", true), text("task_id", true), text("lease_token", true),
      text("worker_id", true), text("acquired_at", true), text("expires_at", true)
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_starter_worker_lease_task ON starter_worker_leases (tenant_id, task_id)",
      "CREATE INDEX idx_starter_worker_lease_expiry ON starter_worker_leases (expires_at)"
    ]
  }));
}, (app) => app.delete(app.findCollectionByNameOrId("starter_worker_leases")));
