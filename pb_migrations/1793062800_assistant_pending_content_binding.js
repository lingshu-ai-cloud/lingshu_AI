/// <reference path="../pb_data/types.d.ts" />
// The assistant save contract already writes this receipt fence. Without a
// JSON field PocketBase silently drops it, making CAS verification fail.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  if (!collection.fields.getByName('pendingContentTaskBinding')) {
    collection.fields.add(new JSONField({ name: 'pendingContentTaskBinding', maxSize: 16384 }));
  }
  if (!collection.fields.getByName('conversationRecovery')) {
    collection.fields.add(new JSONField({ name: 'conversationRecovery', maxSize: 2097152 }));
  }
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  collection.fields.removeByName('pendingContentTaskBinding');
  collection.fields.removeByName('conversationRecovery');
  return app.save(collection);
});
