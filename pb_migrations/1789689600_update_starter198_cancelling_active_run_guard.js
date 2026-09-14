/// <reference path="../pb_data/types.d.ts" />

// A run remains active while cancellation is being coordinated. Keep the
// database guard aligned with quota admission and orchestrator intake so a
// second starter_198 run cannot race in before cancellation becomes terminal.
migrate((app) => {
  const runs = app.findCollectionByNameOrId("workflow_runs");
  const guard = "CREATE UNIQUE INDEX idx_starter198_single_active_run ON workflow_runs (tenant_id) WHERE product_profile = 'starter_198' AND status = 'initializing' OR product_profile = 'starter_198' AND status = 'queued' OR product_profile = 'starter_198' AND status = 'planning' OR product_profile = 'starter_198' AND status = 'running' OR product_profile = 'starter_198' AND status = 'waiting_external' OR product_profile = 'starter_198' AND status = 'waiting_approval' OR product_profile = 'starter_198' AND status = 'waiting_human' OR product_profile = 'starter_198' AND status = 'paused' OR product_profile = 'starter_198' AND status = 'cancelling'";
  runs.indexes = [
    ...runs.indexes.filter(index => !index.includes("idx_starter198_single_active_run")),
    guard,
  ];
  return app.save(runs);
}, (app) => {
  const runs = app.findCollectionByNameOrId("workflow_runs");
  const previousGuard = "CREATE UNIQUE INDEX idx_starter198_single_active_run ON workflow_runs (tenant_id) WHERE product_profile = 'starter_198' AND status = 'initializing' OR product_profile = 'starter_198' AND status = 'queued' OR product_profile = 'starter_198' AND status = 'planning' OR product_profile = 'starter_198' AND status = 'running' OR product_profile = 'starter_198' AND status = 'waiting_external' OR product_profile = 'starter_198' AND status = 'waiting_approval' OR product_profile = 'starter_198' AND status = 'waiting_human' OR product_profile = 'starter_198' AND status = 'paused'";
  runs.indexes = [
    ...runs.indexes.filter(index => !index.includes("idx_starter198_single_active_run")),
    previousGuard,
  ];
  return app.save(runs);
});
