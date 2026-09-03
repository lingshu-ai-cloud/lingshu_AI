/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 69541944ac6bae8e469f5d5e006cc07cfeb8497adcffac647d2517b3fd667029
//
// The legacy scheduler historically depended on setup-pb and silently fell
// back to a host-local JSON snapshot. Materialize its durable collection in
// the migration chain so a fresh or upgraded production boot can fail closed.
migrate((app) => {
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false, max = 0) => ({
    name, type: "text", required, ...(max ? { max } : {})
  });
  const json = (name, required = false, maxSize = 524288) => ({ name, type: "json", required, maxSize });
  const bool = (name) => ({ name, type: "bool", required: false });
  const fields = [
    text("task_id", true), text("tenant_id", true), text("name", true), text("category"),
    text("task_type", true), text("cron_expr", true), text("cron_label"), bool("enabled"),
    text("channel_id"), json("config"), text("last_run"), text("last_result"), text("created_at", true)
  ];
  let collection;
  try { collection = app.findCollectionByNameOrId("scheduled_tasks"); } catch {}
  if (!collection) {
    collection = new Collection({
      id: "lsscheduled0001", name: "scheduled_tasks", type: "base", system: false,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [idField(), ...fields], indexes: []
    });
    app.save(collection);
  } else {
    let changed = false;
    for (const wanted of fields) {
      if (!collection.fields.getByName(wanted.name)) {
        collection.fields.addAt(collection.fields.length, new Field(wanted));
        changed = true;
      }
    }
    if (changed) app.save(collection);
  }

  const indexNames = ["idx_scheduled_tasks_tenant_task", "idx_scheduled_tasks_tenant_created"];
  const indexes = [
    "CREATE UNIQUE INDEX idx_scheduled_tasks_tenant_task ON scheduled_tasks (tenant_id, task_id)",
    "CREATE INDEX idx_scheduled_tasks_tenant_created ON scheduled_tasks (tenant_id, created_at, id)"
  ];
  collection = app.findCollectionByNameOrId("scheduled_tasks");
  collection.indexes = (collection.indexes || [])
    .filter((value) => !indexNames.some((name) => String(value).includes(name)))
    .concat(indexes);
  app.save(collection);
}, (_app) => {
  // Intentionally irreversible: scheduler tasks are customer-owned durable
  // state and must survive an application rollback.
});
