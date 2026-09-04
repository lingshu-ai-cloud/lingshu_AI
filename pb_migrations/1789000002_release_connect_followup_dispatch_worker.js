/// <reference path="../pb_data/types.d.ts" />

// Fields required by the real WhatsApp follow-up dispatch worker. Existing
// in-window session-message items remain valid; template fields are optional
// and must be explicitly populated before an out-of-window item can send.
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

  const collection = app.findCollectionByNameOrId("followup_batch_items");
  const addField = (definition) => {
    try { if (collection.fields.getByName(definition.name)) return; } catch {}
    collection.fields.addAt(collection.fields.length, buildField(definition));
  };
  addField({ id: "text_followup_template_language", name: "template_language", type: "text", required: false });
  addField({ id: "json_followup_template_variables", name: "template_variables", type: "json", required: false, maxSize: 65536 });
  saveForward(collection);
}, () => { throw new Error("Forward-only release migration; rollback the application image, never delete business records."); });
