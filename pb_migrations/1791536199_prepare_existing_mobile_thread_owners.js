/// <reference path="../pb_data/types.d.ts" />
// A mobile installation may apply the older desktop owner index for the first time.
// Give existing mobile sessions distinct temporary agent keys until source-scoped uniqueness is installed.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  if (!collection.fields.getByName('source')) return;
  app.db().newQuery("UPDATE assistant_threads SET agentId = 'mobile_workbench:' || id WHERE source = 'mobile_workbench'").execute();
}, (app) => {
  // The final isolation migration restores the standard mobile agent key;
  // retaining distinct keys here is safe while older unique indexes remain.
});
