/// <reference path="../pb_data/types.d.ts" />

// Immutable configuration versions and effective-policy fields. Enterprise
// facts remain in tenant_profiles; a version records references plus the
// exact fact/policy snapshot used to build a weekly plan.
migrate((app) => {
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
    collection.fields.addAt(collection.fields.length, new Field(definition));
  };
  addField(config, { id: "number_dec_config_version", ...number("config_version") });
  addField(config, { id: "text_dec_policy_version", ...text("policy_version") });
  addField(config, { id: "text_dec_facts_version", ...text("facts_version") });
  addField(config, { id: "json_dec_effective_config", ...json("effective_config", false, 1048576) });
  addField(config, { id: "text_dec_activated_at", ...text("activated_at") });
  app.save(config);

  let versions = null;
  try { versions = app.findCollectionByNameOrId("digital_employee_config_versions"); } catch {}
  if (!versions) {
    app.save(new Collection({
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
  app.save(tasks);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("digital_employee_config_versions")); } catch {}

  const removeFields = (collectionName, names) => {
    let collection = null;
    try { collection = app.findCollectionByNameOrId(collectionName); } catch { return; }
    for (const name of names) {
      try {
        const field = collection.fields.getByName(name);
        collection.fields.removeById(field.id);
      } catch {}
    }
    app.save(collection);
  };
  removeFields("digital_employee_configs", ["config_version", "policy_version", "facts_version", "effective_config", "activated_at"]);
  removeFields("workflow_tasks", ["automatic_execution_allowed", "policy_source"]);
});
