/// <reference path="../pb_data/types.d.ts" />

// Durable content-production jobs are the authority for manual content and
// weekly intelligent-operation content alike. BullMQ is only a wake-up bus;
// queue state, leases, retry class and paid-provider receipts live here.
migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true, min: 0 });
  const json = (name, required = false, maxSize = 1048576) => ({ name, type: "json", required, maxSize });
  const collection = (name, fields, indexes) => new Collection({
    name, type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  });

  app.save(collection("content_execution_jobs", [
    text("tenant_id", true), text("job_key", true), text("task_id", true), text("run_id", true),
    text("user_id", true), text("account_id", true), text("task_type", true), text("status", true),
    number("attempt", true), number("reconciliation_attempt", true), text("next_attempt_at"),
    text("worker_id"), text("lease_expires_at"), text("retry_class"), text("last_error"),
    text("provider_state", true), json("provider_receipts", true, 2097152),
    text("created_at", true), text("updated_at", true), text("last_started_at"), text("completed_at")
  ], [
    "CREATE UNIQUE INDEX idx_content_execution_job_key ON content_execution_jobs (tenant_id, job_key)",
    "CREATE UNIQUE INDEX idx_content_execution_task_run ON content_execution_jobs (tenant_id, task_id, run_id)",
    "CREATE INDEX idx_content_execution_claim ON content_execution_jobs (status, next_attempt_at, created_at)",
    "CREATE INDEX idx_content_execution_tenant_capacity ON content_execution_jobs (tenant_id, status, lease_expires_at)",
    "CREATE INDEX idx_content_execution_account_capacity ON content_execution_jobs (tenant_id, account_id, status)",
    "CREATE INDEX idx_content_execution_type_capacity ON content_execution_jobs (tenant_id, task_type, status)"
  ]));

  app.save(collection("content_execution_limits", [
    text("tenant_id", true), text("limit_scope", true), text("scope_key", true),
    number("max_running", true), text("updated_by", true), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_content_execution_limit_scope ON content_execution_limits (tenant_id, limit_scope, scope_key)",
    "CREATE INDEX idx_content_execution_limit_tenant ON content_execution_limits (tenant_id, updated_at)"
  ]));

  // The social presenter bridge previously wrote this provider ledger without
  // a formal schema. It now participates in durable receipt reconciliation.
  app.save(collection("studio_social_presenter_jobs", [
    text("tenant_id", true), text("task_id", true), text("shot_id", true), text("request_id", true),
    text("status", true), text("provider", true), text("provider_task_id"), text("presenter_asset_id", true),
    text("authorization_ref", true), text("consent_ref", true), text("social_account_id"),
    text("presenter_profile_id"), text("presenter_profile_version"), text("presenter_consistency_key"),
    json("visual_control", true, 262144), text("material_id"), text("object_key"), text("content_sha256"),
    text("error"), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_presenter_job_request ON studio_social_presenter_jobs (tenant_id, request_id)",
    "CREATE INDEX idx_social_presenter_job_provider_task ON studio_social_presenter_jobs (provider, provider_task_id)",
    "CREATE INDEX idx_social_presenter_job_status ON studio_social_presenter_jobs (tenant_id, status, updated_at)"
  ]));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("studio_social_presenter_jobs"));
  app.delete(app.findCollectionByNameOrId("content_execution_limits"));
  return app.delete(app.findCollectionByNameOrId("content_execution_jobs"));
});
