/// <reference path="../pb_data/types.d.ts" />
// Keep historical desktop uniqueness while freeing the index name used by mobile sessions.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  collection.indexes = (collection.indexes || []).map(index => index.includes('idx_assistant_thread_owner')
    ? index.replace('idx_assistant_thread_owner', 'idx_assistant_desktop_owner') : index);
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  collection.indexes = (collection.indexes || []).map(index => index.includes('idx_assistant_desktop_owner')
    ? index.replace('idx_assistant_desktop_owner', 'idx_assistant_thread_owner') : index);
  app.save(collection);
});
