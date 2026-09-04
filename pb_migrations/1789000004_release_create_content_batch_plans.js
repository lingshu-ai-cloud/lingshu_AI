/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Forward-only reconciliation of prototype/setup-first schemas. Preserve IDs,
  // records, unrelated fields and historical migration bytes. Conflicts fail.
  const buildField = (definition) => {
    const constructors = { text: TextField, number: NumberField, json: JSONField, bool: BoolField };
    const Constructor = constructors[definition.type];
    if (!Constructor) throw new Error("unsupported field type: " + definition.type);
    return new Constructor(definition);
  };
  const saveForward = (proposed) => {
    let current = null;
    try { current = app.findCollectionByNameOrId(proposed.name); } catch {}
    if (!current) return app.save(proposed);
    if (current.type !== proposed.type) throw new Error("incompatible collection: " + proposed.name);
    for (const field of proposed.fields) {
      const definition = { ...JSON.parse(JSON.stringify(field)), type: field.type() };
      let existing = null;
      try { existing = current.fields.getByName(definition.name); } catch {}
      if (!existing) {
        current.fields.addAt(current.fields.length, buildField(definition));
      } else {
        const existingDefinition = { ...JSON.parse(JSON.stringify(existing)), type: existing.type() };
        if (existingDefinition.type !== definition.type) throw new Error("incompatible field: " + proposed.name + "." + definition.name);
        if (definition.type === "json" && existing.maxSize < definition.maxSize) {
          current.fields.add(buildField({ ...existingDefinition, maxSize: definition.maxSize }));
        }
      }
    }
    const indexes = Array.from(current.indexes || []);
    for (const index of proposed.indexes || []) {
      const indexName = /INDEX\s+(\S+)\s+ON/i.exec(index);
      const existing = indexes.find(value => {
        const name = /INDEX\s+(\S+)\s+ON/i.exec(value);
        return name && indexName && name[1] === indexName[1];
      });
      if (existing && existing.replace(/\s+/g, " ").trim() !== index.replace(/\s+/g, " ").trim()) throw new Error("incompatible index: " + indexName[1]);
      if (!existing) indexes.push(index);
    }
    current.indexes = indexes;
    for (const rule of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
      if (current[rule] !== null) throw new Error("unexpected client access rule: " + proposed.name + "." + rule);
    }
    return app.save(current);
  };

  const text = (name, required = false) => ({ name, type: "text", required });
  const json = (name, required = false, maxSize = 1048576) => ({ name, type: "json", required, maxSize });
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true });
  saveForward(new Collection({
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
}, () => { throw new Error("Forward-only release migration; rollback the application image, never delete business records."); });
