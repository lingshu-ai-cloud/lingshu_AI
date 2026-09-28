/// <reference path="../pb_data/types.d.ts" />

// Keep the publishing schedule query sortable and persist the result of the
// Messenger Page webhook subscription performed by the application.
migrate((app) => {
  const ensureField = (collection, definition) => {
    let current;
    try { current = collection.fields.getByName(definition.name); } catch {}
    if (current?.type === definition.type) return;
    collection.fields.addAt(
      collection.fields.length,
      new Field({ ...definition, ...(current?.id ? { id: current.id } : {}) }),
    );
  };

  const schedules = app.findCollectionByNameOrId("publishing_schedules");
  ensureField(schedules, {
    name: "updated",
    type: "autodate",
    required: false,
    onCreate: true,
    onUpdate: true,
  });
  app.save(schedules);

  const accounts = app.findCollectionByNameOrId("social_accounts");
  ensureField(accounts, {
    name: "messengerSubscribed",
    type: "bool",
    required: false,
  });
  ensureField(accounts, {
    name: "messengerSubscriptionError",
    type: "text",
    required: false,
    max: 2000,
  });
  app.save(accounts);
}, (app) => {
  const removeField = (collection, name) => {
    let field;
    try { field = collection.fields.getByName(name); } catch {}
    if (field) collection.fields.removeById(field.id);
  };

  const schedules = app.findCollectionByNameOrId("publishing_schedules");
  removeField(schedules, "updated");
  app.save(schedules);

  const accounts = app.findCollectionByNameOrId("social_accounts");
  removeField(accounts, "messengerSubscribed");
  removeField(accounts, "messengerSubscriptionError");
  app.save(accounts);
});
