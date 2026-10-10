/// <reference path="../pb_data/types.d.ts" />
// Preserve existing owned desktop conversations and permit multiple mobile sessions per user.
migrate((app) => {
  app.db().newQuery("UPDATE assistant_threads SET source = 'desktop' WHERE source = '' AND userId != ''").execute();
  const collection = app.findCollectionByNameOrId('assistant_threads');
  collection.indexes = (collection.indexes || []).filter(index => !index.includes('idx_assistant_desktop_owner'));
  collection.indexes.push("CREATE UNIQUE INDEX idx_assistant_desktop_owner ON assistant_threads (tenantId, userId, agentId) WHERE userId != '' AND source = 'desktop'");
  collection.indexes = collection.indexes.filter(index => !index.includes('idx_assistant_thread_scope'));
  if (!collection.indexes.some(index => index.includes('idx_assistant_thread_owner')))
    collection.indexes.push('CREATE INDEX idx_assistant_thread_scope ON assistant_threads (tenantId, userId, source, createdAt)');
  app.save(collection);
  app.db().newQuery("UPDATE assistant_threads SET agentId = 'mobile_workbench' WHERE source = 'mobile_workbench'").execute();
}, (app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  collection.indexes = (collection.indexes || []).filter(index => !index.includes('idx_assistant_desktop_owner'));
  collection.indexes.push("CREATE UNIQUE INDEX idx_assistant_desktop_owner ON assistant_threads (tenantId, userId, agentId) WHERE userId != '' AND source != 'mobile_workbench'");
  app.save(collection);
});
