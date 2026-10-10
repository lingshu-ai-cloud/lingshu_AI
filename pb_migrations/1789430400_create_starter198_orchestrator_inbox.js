/// <reference path="../pb_data/types.d.ts" />

// Durable customer -> Lingxiaoshu inbox and the database-level single-active-
// run guard for starter_198. The partial unique index is the cross-process
// authority; process-local queues are only a latency optimization.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true });
  const json = (name, required = false, maxSize = 524288) => ({ name, type: "json", required, maxSize });
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const addField = (collection, definition) => {
    try { if (collection.fields.getByName(definition.name)) return; } catch {}
    collection.fields.addAt(collection.fields.length, new Field(definition));
  };

  let inbox = null;
  try { inbox = app.findCollectionByNameOrId("starter_orchestrator_inbox"); } catch {}
  if (!inbox) {
    app.save(new Collection({
      name: "starter_orchestrator_inbox",
      type: "base",
      system: false,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        id(),
        text("tenant_id", true),
        text("queue_item_id", true),
        text("command_id", true),
        text("idempotency_key", true),
        text("input_text", true),
        text("input_hash", true),
        text("input_version", true),
        text("run_id"),
        text("disposition", true),
        text("status", true),
        json("missing_facts", true, 131072),
        text("error_code"),
        text("created_by", true),
        text("created_at", true),
        text("updated_at", true),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_starter_orchestrator_inbox_idempotency ON starter_orchestrator_inbox (tenant_id, idempotency_key)",
        "CREATE UNIQUE INDEX idx_starter_orchestrator_inbox_command ON starter_orchestrator_inbox (tenant_id, command_id)",
        "CREATE UNIQUE INDEX idx_starter_orchestrator_inbox_queue_item ON starter_orchestrator_inbox (tenant_id, queue_item_id)",
        "CREATE INDEX idx_starter_orchestrator_inbox_run_state ON starter_orchestrator_inbox (tenant_id, run_id, status, created_at)"
      ]
    }));
  }

  const runs = app.findCollectionByNameOrId("workflow_runs");
  addField(runs, { id: "text_wr_product_profile", ...text("product_profile") });
  addField(runs, { id: "text_wr_starter_initialization", ...text("starter_initialization_id") });
  addField(runs, { id: "text_wr_starter_input_version", ...text("starter_input_version") });
  addField(runs, { id: "number_wr_starter_plan_version", ...number("starter_plan_version") });
  addField(runs, { id: "json_wr_starter_context", ...json("starter_context", false, 1048576) });
  addField(runs, { id: "text_wr_queued_at", ...text("queued_at") });
  const guard = "CREATE UNIQUE INDEX idx_starter198_single_active_run ON workflow_runs (tenant_id) WHERE product_profile = 'starter_198' AND status = 'initializing' OR product_profile = 'starter_198' AND status = 'queued' OR product_profile = 'starter_198' AND status = 'planning' OR product_profile = 'starter_198' AND status = 'running' OR product_profile = 'starter_198' AND status = 'waiting_external' OR product_profile = 'starter_198' AND status = 'waiting_approval' OR product_profile = 'starter_198' AND status = 'waiting_human' OR product_profile = 'starter_198' AND status = 'paused'";
  if (!runs.indexes.includes(guard)) runs.indexes = [...runs.indexes, guard];
  return app.save(runs);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("starter_orchestrator_inbox")); } catch {}
  let runs = null;
  try { runs = app.findCollectionByNameOrId("workflow_runs"); } catch {}
  if (!runs) return;
  runs.indexes = runs.indexes.filter(index => !index.includes("idx_starter198_single_active_run"));
  for (const name of [
    "product_profile", "starter_initialization_id", "starter_input_version",
    "starter_plan_version", "starter_context", "queued_at"
  ]) {
    try { runs.fields.removeById(runs.fields.getByName(name).id); } catch {}
  }
  return app.save(runs);
});
