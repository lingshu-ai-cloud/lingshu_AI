/// <reference path="../pb_data/types.d.ts" />
// Intentionally fail if historical duplicate tenant profiles exist. They must
// be reviewed rather than silently choosing one as the enterprise fact source.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('tenant_profiles');
  collection.indexes = [
    ...(collection.indexes || []),
    'CREATE UNIQUE INDEX idx_tenant_profile_owner ON tenant_profiles (tenant_id)',
  ];
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('tenant_profiles');
  collection.indexes = (collection.indexes || []).filter(index => !index.includes('idx_tenant_profile_owner'));
  return app.save(collection);
});
