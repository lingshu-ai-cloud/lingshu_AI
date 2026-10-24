/// <reference path="../pb_data/types.d.ts" />
// Ads-only additive migration. Never run against historical enterprise source stores.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('platform_ad_connections');
  try { collection.fields.getByName('defaultPage'); }
  catch { collection.fields.addAt(collection.fields.length, new Field({ id: 'pad_defaultpage', name: 'defaultPage', type: 'json', required: false })); }
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('platform_ad_connections');
  try { collection.fields.removeById(collection.fields.getByName('defaultPage').id); } catch {}
  return app.save(collection);
});
