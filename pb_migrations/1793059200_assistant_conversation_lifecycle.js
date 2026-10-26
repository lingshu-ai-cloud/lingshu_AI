/// <reference path="../pb_data/types.d.ts" />
// Conversation-only deletion fence; business tasks and assets are separate records.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  collection.fields.add(new NumberField({ name: 'conversationResetVersion', onlyInt: true, min: 0 }));
  collection.fields.add(new TextField({ name: 'deletedAt', max: 40 }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('assistant_threads');
  collection.fields.removeByName('conversationResetVersion');
  collection.fields.removeByName('deletedAt');
  return app.save(collection);
});
