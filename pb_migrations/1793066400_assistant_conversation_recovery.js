/// <reference path="../pb_data/types.d.ts" />
// Separate from the already deployed pending-receipt migration.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  if (!collection.fields.getByName('conversationRecovery')) {
    collection.fields.add(new JSONField({ name: 'conversationRecovery', maxSize: 2097152 }));
  }
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  collection.fields.removeByName('conversationRecovery');
  return app.save(collection);
});
