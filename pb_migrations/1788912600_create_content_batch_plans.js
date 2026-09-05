/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  const json = (name, required = false, maxSize = 1048576) => ({ name, type: "json", required, maxSize });
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true });
  app.save(new Collection({
    name: "content_batch_plans", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      text("tenant_id", true), text("goal_id", true), text("plan_id", true), text("run_id", true), text("task_id", true),
      text("status", true), json("orders", true, 2097152), json("routing", true),
      number("config_version", true), text("policy_version", true), text("facts_version", true),
      text("created_at", true), text("updated_at", true),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_content_batch_plan_task ON content_batch_plans (tenant_id, task_id)",
      "CREATE INDEX idx_content_batch_plan_run ON content_batch_plans (tenant_id, run_id)",
    ],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("content_batch_plans")); } catch {}
});
