/// <reference path="../pb_data/types.d.ts" />

// Follow-up migration for installations that already applied
// 1789430400_create_starter198_orchestrator_inbox.js before waiting_human was
// classified as an active run. Editing the earlier migration only fixes fresh
// installs; this migration updates the database guard in place as well.
migrate((app) => {
  const runs = app.findCollectionByNameOrId("workflow_runs");
  const guard = "CREATE UNIQUE INDEX idx_starter198_single_active_run ON workflow_runs (tenant_id) WHERE product_profile = 'starter_198' AND status = 'initializing' OR product_profile = 'starter_198' AND status = 'queued' OR product_profile = 'starter_198' AND status = 'planning' OR product_profile = 'starter_198' AND status = 'running' OR product_profile = 'starter_198' AND status = 'waiting_external' OR product_profile = 'starter_198' AND status = 'waiting_approval' OR product_profile = 'starter_198' AND status = 'waiting_human' OR product_profile = 'starter_198' AND status = 'paused'";
  runs.indexes = [
    ...runs.indexes.filter(index => !index.includes("idx_starter198_single_active_run")),
    guard,
  ];
  return app.save(runs);
}, (app) => {
  const runs = app.findCollectionByNameOrId("workflow_runs");
  const previousGuard = "CREATE UNIQUE INDEX idx_starter198_single_active_run ON workflow_runs (tenant_id) WHERE product_profile = 'starter_198' AND status = 'initializing' OR product_profile = 'starter_198' AND status = 'queued' OR product_profile = 'starter_198' AND status = 'planning' OR product_profile = 'starter_198' AND status = 'running' OR product_profile = 'starter_198' AND status = 'waiting_external' OR product_profile = 'starter_198' AND status = 'waiting_approval' OR product_profile = 'starter_198' AND status = 'paused'";
  runs.indexes = [
    ...runs.indexes.filter(index => !index.includes("idx_starter198_single_active_run")),
    previousGuard,
  ];
  return app.save(runs);
});
