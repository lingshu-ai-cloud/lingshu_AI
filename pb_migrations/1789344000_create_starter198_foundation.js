/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required });
  const json = (name, required = false, maxSize = 2097152) => ({ name, type: "json", required, maxSize });
  const collection = (name, fields, indexes) => new Collection({
    name, type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  });

  app.save(collection("starter_198_access", [
    text("tenant_id", true), text("product_profile", true), text("profile_version", true),
    text("entitlement_snapshot_id", true), json("feature_entitlements", true),
    json("resource_limits", true), text("status", true), text("provisioning_idempotency_key", true),
    text("provisioning_request_hash", true), text("created_by", true), text("updated_by", true),
    text("cycle_started_at", true), text("cycle_ends_at", true),
    text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_starter_198_access_tenant ON starter_198_access (tenant_id)",
    "CREATE INDEX idx_starter_198_access_status ON starter_198_access (status)"
  ]));

  app.save(collection("starter_usage_ledger", [
    text("tenant_id", true), text("schema_version", true), text("run_id", true),
    text("task_id", true), text("agent_role", true), text("capability", true),
    text("reservation_id", true), text("idempotency_key", true), text("request_hash", true),
    text("cycle_id", true), text("event_type", true), text("state", true),
    json("usage", true), text("occurred_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_starter_usage_idempotency ON starter_usage_ledger (tenant_id, idempotency_key)",
    "CREATE UNIQUE INDEX idx_starter_usage_lifecycle ON starter_usage_ledger (tenant_id, reservation_id, event_type)",
    "CREATE INDEX idx_starter_usage_cycle ON starter_usage_ledger (tenant_id, cycle_id, occurred_at)",
    "CREATE INDEX idx_starter_usage_run ON starter_usage_ledger (tenant_id, run_id, occurred_at)",
    "CREATE INDEX idx_starter_usage_task ON starter_usage_ledger (tenant_id, task_id)"
  ]));

  app.save(collection("starter_commands", [
    text("tenant_id", true), text("command_id", true), text("idempotency_key", true),
    text("request_hash", true), text("command", true), text("target_id"), text("expected_version"),
    json("payload", true), text("status", true), number("http_status"), json("result", true), json("operation_result"),
    text("error_code"), text("created_by", true), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_starter_command_idempotency ON starter_commands (tenant_id, idempotency_key)",
    "CREATE UNIQUE INDEX idx_starter_command_id ON starter_commands (tenant_id, command_id)",
    "CREATE INDEX idx_starter_command_status ON starter_commands (tenant_id, status, created_at)"
  ]));

  app.save(collection("starter_agent_tasks", [
    text("tenant_id", true), text("run_id", true), text("task_id", true),
    text("correlation_id", true), text("idempotency_key", true), text("source_agent", true),
    text("target_agent", true), json("envelope", true), text("envelope_hash", true),
    text("budget_reservation_id"), text("metered_capability"),
    text("status", true), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_starter_agent_task_idempotency ON starter_agent_tasks (tenant_id, idempotency_key)",
    "CREATE UNIQUE INDEX idx_starter_agent_task_id ON starter_agent_tasks (tenant_id, task_id)",
    "CREATE INDEX idx_starter_agent_task_run ON starter_agent_tasks (tenant_id, run_id, status)"
  ]));

  app.save(collection("starter_agent_handoffs", [
    text("tenant_id", true), text("run_id", true), text("task_id", true),
    text("handoff_id", true), text("correlation_id", true), text("source_agent", true),
    text("target_agent", true), json("result", true), text("result_hash", true),
    text("status", true), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_starter_handoff_id ON starter_agent_handoffs (tenant_id, handoff_id)",
    "CREATE INDEX idx_starter_handoff_task ON starter_agent_handoffs (tenant_id, task_id, created_at)"
  ]));

  return app.save(collection("starter_publication_packages", [
    text("tenant_id", true), text("package_id", true), text("idempotency_key", true),
    text("content_id", true), text("content_version", true), text("content_hash", true),
    text("platform", true), json("manifest", true), text("status", true), json("evidence"),
    text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_starter_publication_package_id ON starter_publication_packages (tenant_id, package_id)",
    "CREATE UNIQUE INDEX idx_starter_publication_idempotency ON starter_publication_packages (tenant_id, idempotency_key)",
    "CREATE UNIQUE INDEX idx_starter_publication_content_limit ON starter_publication_packages (tenant_id, content_id)"
  ]));
}, (app) => {
  const names = [
    "starter_publication_packages", "starter_agent_handoffs", "starter_agent_tasks",
    "starter_commands", "starter_usage_ledger", "starter_198_access"
  ];
  for (let index = 0; index < names.length; index += 1) {
    const result = app.delete(app.findCollectionByNameOrId(names[index]));
    if (index === names.length - 1) return result;
  }
});
