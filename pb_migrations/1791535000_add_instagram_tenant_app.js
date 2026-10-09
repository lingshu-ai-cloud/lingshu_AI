migrate((app) => {
  const collection = app.findCollectionByNameOrId('tenant_platform_apps');
  collection.fields.getByName('platform').pattern = '^(meta|instagram|google|tiktok|wecom)$';
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('tenant_platform_apps');
  collection.fields.getByName('platform').pattern = '^(meta|google|tiktok|wecom)$';
  app.save(collection);
});
