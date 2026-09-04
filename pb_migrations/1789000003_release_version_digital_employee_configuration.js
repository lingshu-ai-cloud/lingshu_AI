/// <reference path="../pb_data/types.d.ts" />

// Immutable configuration versions and effective-policy fields. Enterprise
// facts remain in tenant_profiles; a version records references plus the
// exact fact/policy snapshot used to build a weekly plan.
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
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true });
  const json = (name, required = false, maxSize = 524288) => ({ name, type: "json", required, maxSize });
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const config = app.findCollectionByNameOrId("digital_employee_configs");
  const addField = (collection, definition) => {
    try { if (collection.fields.getByName(definition.name)) return; } catch {}
    collection.fields.addAt(collection.fields.length, buildField(definition));
  };
  addField(config, { id: "number_dec_config_version", ...number("config_version") });
  addField(config, { id: "text_dec_policy_version", ...text("policy_version") });
  addField(config, { id: "text_dec_facts_version", ...text("facts_version") });
  addField(config, { id: "json_dec_effective_config", ...json("effective_config", false, 1048576) });
  addField(config, { id: "text_dec_activated_at", ...text("activated_at") });
  saveForward(config);

  let versions = null;
  try { versions = app.findCollectionByNameOrId("digital_employee_config_versions"); } catch {}
  {
    saveForward(new Collection({
      name: "digital_employee_config_versions",
      type: "base",
      system: false,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        idField(),
        text("tenant_id", true),
        number("config_version", true),
        text("policy_version", true),
        text("facts_version", true),
        json("config", true, 1048576),
        json("knowledge_binding", true, 1048576),
        json("runtime_policy", true, 1048576),
        text("status", true),
        text("created_by", true),
        text("created_at", true),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_de_config_versions_tenant_version ON digital_employee_config_versions (tenant_id, config_version)",
        "CREATE INDEX idx_de_config_versions_tenant_created ON digital_employee_config_versions (tenant_id, created_at)"
      ]
    }));
  }

  const tasks = app.findCollectionByNameOrId("workflow_tasks");
  addField(tasks, { id: "bool_wft_automatic_execution_allowed", name: "automatic_execution_allowed", type: "bool", required: false });
  addField(tasks, { id: "text_wft_policy_source", ...text("policy_source") });
  saveForward(tasks);
}, () => { throw new Error("Forward-only release migration; rollback the application image, never delete business records."); });
