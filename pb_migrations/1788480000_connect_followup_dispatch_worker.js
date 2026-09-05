/// <reference path="../pb_data/types.d.ts" />

// Fields required by the real WhatsApp follow-up dispatch worker. Existing
// in-window session-message items remain valid; template fields are optional
// and must be explicitly populated before an out-of-window item can send.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("followup_batch_items");
  const addField = (definition) => {
    try { if (collection.fields.getByName(definition.name)) return; } catch {}
    collection.fields.addAt(collection.fields.length, new Field(definition));
  };
  addField({ id: "text_followup_template_language", name: "template_language", type: "text", required: false });
  addField({ id: "json_followup_template_variables", name: "template_variables", type: "json", required: false, maxSize: 65536 });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("followup_batch_items");
  for (const name of ["template_language", "template_variables"]) {
    try {
      const field = collection.fields.getByName(name);
      collection.fields.removeById(field.id);
    } catch {}
  }
  app.save(collection);
});
